import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchReductoJobResult,
  processIngestCompletion,
} from "../_shared/ingestPipeline.ts";

// =============================================================================
// /ingest-status — active-polling driver for the async ingest pipeline.
//
// Called by the frontend on a timer (every 5–10s) while a document is in
// `status='pending'` after /ingest returned 202. For each call:
//
//   1. Look up the document row (must be owned by the calling user)
//   2. Bail early if status is already 'ready' or 'failed' — frontend
//      sees this and stops polling
//   3. Ask Reducto for the job status
//      ├─ Running    → return { status: 'pending' } cheaply
//      ├─ Completed  → run processIngestCompletion synchronously
//                       (~60–120s for a 150-page protocol, fits in 150s
//                       function cap; final UPDATE flips documents.status)
//      └─ Failed     → mark documents.status='failed' with the Reducto
//                       error and return
//
// Idempotent — concurrent ticks on the same document race but the second
// one finds status!=='pending' and bails. The processIngestCompletion's
// own SOTR-persist RPC is idempotent on re-ingest (per its existing
// "deletes prior evidence rows for the document_id" semantic).
//
// Differs from /ingest-recover in two ways:
//   - Targets a specific document_id (not "scan all stuck-pending")
//   - No staleness threshold — we expect to poll docs that are <10min old
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Auth — only the document's owner can poll its status.
  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (userToken) {
    const { data: { user } } = await createClient(supabaseUrl, serviceRoleKey).auth.getUser(userToken);
    userId = user?.id ?? null;
    userEmail = user?.email ?? null;
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: "Authentication required" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const reductoKey = Deno.env.get("REDUCTO_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!reductoKey || !openaiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Parse body.
  let documentId: string | null = null;
  try {
    const body = await req.json();
    documentId = typeof body.document_id === "string" ? body.document_id : null;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  if (!documentId) {
    return new Response(JSON.stringify({ error: "document_id required" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // Look up the document. Service-role bypasses RLS, so we re-check ownership
  // explicitly to prevent one user from polling another user's documents.
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, status, reducto_job_id, protocol_id, user_id, error_message")
    .eq("id", documentId)
    .maybeSingle();

  if (docError) {
    return new Response(JSON.stringify({ error: "DB lookup failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!doc) {
    return new Response(JSON.stringify({ error: "Document not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }
  if (doc.user_id !== userId) {
    // Don't leak existence — same response as not-found.
    return new Response(JSON.stringify({ error: "Document not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }

  // Already terminal — return current state, frontend stops polling.
  if (doc.status === "ready" || doc.status === "failed") {
    return new Response(
      JSON.stringify({
        status: doc.status,
        document_id: doc.id,
        protocol_id: doc.protocol_id,
        error_message: doc.error_message,
      }),
      { headers: jsonHeaders },
    );
  }

  // No job_id stamped yet means /ingest is still running. Tell the client to
  // keep polling.
  if (!doc.reducto_job_id) {
    return new Response(
      JSON.stringify({ status: "pending", document_id: doc.id, protocol_id: null }),
      { headers: jsonHeaders },
    );
  }

  // Ask Reducto for the job status.
  let reductoStatus: string;
  try {
    const result = await fetchReductoJobResult(doc.reducto_job_id, reductoKey);
    reductoStatus = result.status.toLowerCase();
  } catch (e) {
    console.error("[ingest-status] reducto_status_failed", {
      document_id: documentId,
      reducto_job_id: doc.reducto_job_id,
      error: e instanceof Error ? e.message : String(e),
    });
    // Transient — tell client to keep polling. /ingest-recover will catch
    // stuck-pending docs eventually if this keeps failing.
    return new Response(
      JSON.stringify({ status: "pending", document_id: doc.id, protocol_id: null }),
      { headers: jsonHeaders },
    );
  }

  // Failed / cancelled at Reducto — reflect on the document.
  if (reductoStatus === "failed" || reductoStatus === "cancelled" || reductoStatus === "canceled") {
    await supabase
      .from("documents")
      .update({
        status: "failed",
        error_message: `Reducto job ended with status: ${reductoStatus}`,
      })
      .eq("id", documentId);
    return new Response(
      JSON.stringify({
        status: "failed",
        document_id: doc.id,
        error_message: `Reducto job ended with status: ${reductoStatus}`,
      }),
      { headers: jsonHeaders },
    );
  }

  // Still running on Reducto's side.
  if (reductoStatus !== "completed") {
    return new Response(
      JSON.stringify({ status: "pending", document_id: doc.id, protocol_id: null }),
      { headers: jsonHeaders },
    );
  }

  // Completed — run the full completion pipeline synchronously. Fits in 150s
  // for 150-page protocols. processIngestCompletion is idempotent if the
  // same document somehow gets two concurrent /ingest-status hits.
  const completion = await processIngestCompletion(supabase, {
    docId: documentId,
    reductoJobId: doc.reducto_job_id,
    userId,
    userEmail,
    openaiKey,
    reductoKey,
  });

  if (!completion.ok) {
    return new Response(
      JSON.stringify({
        status: "failed",
        document_id: doc.id,
        error_message: completion.error,
      }),
      { headers: jsonHeaders },
    );
  }

  return new Response(
    JSON.stringify({
      status: "ready",
      document_id: doc.id,
      protocol_id: completion.protocolId,
    }),
    { headers: jsonHeaders },
  );
});
