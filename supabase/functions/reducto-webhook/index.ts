import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { fetchReductoJobResult, processIngestCompletion } from "../_shared/ingestPipeline.ts";

// =============================================================================
// /reducto-webhook — Reducto direct-webhook finalizer (workstream D).
//
// When /ingest kicks off the parse with async_config.webhook {mode:"direct"},
// Reducto POSTs the completed job here directly (server-to-server, retried 3×).
// This decouples finalization from the browser: a long PDF that finishes parsing
// minutes after the user closed the tab still gets finalized. The pg_cron
// recover (migration 20260703000001) + the dashboard-mount recover (#255) are
// the safety nets for a missed webhook.
//
// Auth: this function is deployed with verify_jwt=false (Reducto can't mint a
// Supabase JWT), so it verifies a shared secret passed as ?token= on the URL
// /ingest registered with Reducto. Returns 200 quickly, then runs the (slow)
// completion in EdgeRuntime.waitUntil so Reducto's delivery isn't held open.
//
// Idempotent: completion only runs for documents still in status='pending'
// (the recover paths share this guard via the same status check).
// =============================================================================

const jsonHeaders = { "Content-Type": "application/json" };

function extractIds(body: unknown): { documentId: string | null; jobId: string | null; status: string | null } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const data = (b.data && typeof b.data === "object" ? b.data : b) as Record<string, unknown>;
  const meta = (data.metadata && typeof data.metadata === "object" ? data.metadata : b.metadata) as
    | Record<string, unknown>
    | undefined;
  const documentId = typeof meta?.document_id === "string" ? meta.document_id : null;
  const jobId = typeof data.job_id === "string"
    ? data.job_id
    : typeof b.job_id === "string"
      ? b.job_id
      : null;
  const status = typeof data.status === "string"
    ? data.status
    : typeof b.status === "string"
      ? b.status
      : null;
  return { documentId, jobId, status };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  // Shared-secret gate (the function runs with verify_jwt=false).
  const expected = Deno.env.get("REDUCTO_WEBHOOK_SECRET");
  const token = new URL(req.url).searchParams.get("token");
  if (!expected || token !== expected) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const reductoKey = Deno.env.get("REDUCTO_API_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!reductoKey || !openaiKey) {
    return new Response(JSON.stringify({ error: "Server configuration error" }), { status: 500, headers: jsonHeaders });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: jsonHeaders });
  }
  const { documentId, jobId } = extractIds(body);
  if (!documentId) {
    // Nothing actionable — ack so Reducto doesn't retry forever.
    console.warn("[reducto-webhook] no_document_id_in_metadata");
    return new Response(JSON.stringify({ ok: true, skipped: "no document_id" }), { headers: jsonHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: doc, error: docErr } = await supabase
    .from("documents")
    .select("id, status, reducto_job_id, user_id")
    .eq("id", documentId)
    .maybeSingle();
  if (docErr || !doc) {
    console.error("[reducto-webhook] doc_lookup_failed", { document_id: documentId, error: docErr?.message });
    return new Response(JSON.stringify({ ok: true, skipped: "doc not found" }), { headers: jsonHeaders });
  }

  // Idempotency: only finalize a still-pending doc. A duplicate webhook (Reducto
  // retries) or a doc already finalized by the recover path is a no-op.
  if (doc.status !== "pending") {
    return new Response(JSON.stringify({ ok: true, skipped: `status=${doc.status}` }), { headers: jsonHeaders });
  }

  const resolvedJobId = (typeof doc.reducto_job_id === "string" && doc.reducto_job_id) || jobId;
  if (!resolvedJobId) {
    return new Response(JSON.stringify({ ok: true, skipped: "no job id" }), { headers: jsonHeaders });
  }

  let userEmail: string | null = null;
  try {
    const { data: u } = await supabase.auth.admin.getUserById(doc.user_id);
    userEmail = u?.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  // Run the slow completion in the background so we ack Reducto immediately.
  const finalize = async () => {
    try {
      // Confirm Reducto actually has a Completed result (the webhook body may be
      // a status event; the pipeline re-fetches the parse result regardless).
      const job = await fetchReductoJobResult(resolvedJobId, reductoKey);
      const status = job.status.toLowerCase();
      if (status === "failed" || status === "cancelled" || status === "canceled") {
        await supabase
          .from("documents")
          .update({ status: "failed", error_message: `Reducto job ended with status: ${job.status}` })
          .eq("id", doc.id);
        return;
      }
      if (status !== "completed") {
        console.warn("[reducto-webhook] not_completed_yet", { document_id: doc.id, status: job.status });
        return; // a recover pass will pick it up
      }
      const result = await processIngestCompletion(supabase, {
        docId: doc.id,
        reductoJobId: resolvedJobId,
        userId: doc.user_id,
        userEmail,
        openaiKey,
        reductoKey,
      });
      console.log("[reducto-webhook] finalized", { document_id: doc.id, ok: result.ok });
    } catch (e) {
      console.error("[reducto-webhook] finalize_failed", {
        document_id: doc.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  // @ts-ignore EdgeRuntime is provided by the Supabase Edge runtime.
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(finalize());
  } else {
    await finalize();
  }

  return new Response(JSON.stringify({ ok: true, document_id: doc.id }), { headers: jsonHeaders });
});
