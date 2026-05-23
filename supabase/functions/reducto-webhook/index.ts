import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { readSvixHeaders, verifySvixSignature } from "../_shared/svixVerify.ts";
import { processIngestCompletion } from "../_shared/ingestPipeline.ts";

// =============================================================================
// /reducto-webhook — Svix-signed callback from Reducto when an async parse
// job completes.
//
// Deploy with `--no-verify-jwt` because Svix doesn't send a Supabase JWT.
// Auth is via the Svix signature headers (svix-id, svix-timestamp,
// svix-signature) verified against SVIX_WEBHOOK_SECRET.
//
// Contract:
//   - Verify signature (reject 400 on mismatch)
//   - Idempotency check (status != 'pending' → 200 no-op)
//   - Kick off processIngestCompletion via EdgeRuntime.waitUntil
//   - Return 200 in <2s (under Svix's 15s response cap)
//
// The heavy work runs in the background. Errors there mark documents.status
// = 'failed' with an error_message; the frontend sees that via realtime.
// =============================================================================

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, svix-id, svix-timestamp, svix-signature",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

interface SvixPayload {
  status?: string;
  job_id?: string;
  metadata?: {
    document_id?: string;
    user_id?: string;
  };
}

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

  const svixSecret = Deno.env.get("SVIX_WEBHOOK_SECRET");
  if (!svixSecret) {
    console.error("[reducto-webhook] SVIX_WEBHOOK_SECRET not configured");
    return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Read raw body (signature is computed over the bytes, not parsed JSON).
  const rawBody = await req.text();

  const svixHeaders = readSvixHeaders(req.headers);
  const verifyResult = await verifySvixSignature(rawBody, svixHeaders, svixSecret);
  if (!verifyResult.ok) {
    console.warn("[reducto-webhook] signature_invalid", { reason: verifyResult.reason });
    return new Response(JSON.stringify({ error: "Invalid signature" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // Parse payload.
  let payload: SvixPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const documentId = payload.metadata?.document_id;
  const userId = payload.metadata?.user_id;
  const jobId = payload.job_id;
  const status = payload.status;

  if (!documentId || !jobId) {
    console.warn("[reducto-webhook] missing_metadata_or_job_id", { payload });
    return new Response(JSON.stringify({ error: "Missing document_id or job_id" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // Reducto webhook fires for multiple status types. We only act on
  // Completed. Failed/Cancelled get reflected on the document and acked.
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Idempotency check + status branch.
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, status, user_id, reducto_job_id")
    .eq("id", documentId)
    .maybeSingle();

  if (docError) {
    console.error("[reducto-webhook] documents_select_failed", {
      document_id: documentId,
      error: docError.message,
    });
    return new Response(JSON.stringify({ error: "DB lookup failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!doc) {
    // Unknown document — return 200 so Svix doesn't retry indefinitely.
    console.warn("[reducto-webhook] unknown_document", { document_id: documentId });
    return new Response(JSON.stringify({ ok: true, ignored: "unknown_document" }), {
      headers: jsonHeaders,
    });
  }
  if (doc.status === "ready" || doc.status === "failed") {
    // Already terminal — no-op.
    return new Response(JSON.stringify({ ok: true, ignored: "already_terminal" }), {
      headers: jsonHeaders,
    });
  }

  // Failed / Cancelled at Reducto → reflect on the document and ack.
  if (status && status !== "Completed" && status !== "completed") {
    await supabase
      .from("documents")
      .update({
        status: "failed",
        error_message: `Reducto job ended with status: ${status}`,
      })
      .eq("id", documentId);
    console.warn("[reducto-webhook] non_completed_status", {
      document_id: documentId,
      reducto_status: status,
    });
    return new Response(JSON.stringify({ ok: true, marked: "failed" }), {
      headers: jsonHeaders,
    });
  }

  // Happy path — kick off background completion.
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  const reductoKey = Deno.env.get("REDUCTO_API_KEY");
  if (!openaiKey || !reductoKey) {
    console.error("[reducto-webhook] missing_api_keys");
    await supabase
      .from("documents")
      .update({
        status: "failed",
        error_message: "Server missing API keys",
      })
      .eq("id", documentId);
    return new Response(JSON.stringify({ error: "Server configuration error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Look up user email for the B2.4 fallback. The user_id may come from the
  // metadata (set by /ingest) or from the documents row.
  const effectiveUserId = userId ?? doc.user_id;
  let userEmail: string | null = null;
  if (effectiveUserId) {
    const { data: u } = await supabase.auth.admin.getUserById(effectiveUserId);
    userEmail = u?.user?.email ?? null;
  }

  // Background completion. EdgeRuntime.waitUntil keeps the function alive
  // past the 200 we return below — total background lifetime is bounded by
  // Supabase's function execution cap (150s on Free tier), but we no longer
  // hold the request connection open, so Svix's 15s response window is
  // safely met.
  EdgeRuntime.waitUntil(
    processIngestCompletion(supabase, {
      docId: documentId,
      reductoJobId: jobId,
      userId: effectiveUserId ?? "",
      userEmail,
      openaiKey,
      reductoKey,
    }).then((result) => {
      console.log("[reducto-webhook] completion_finished", {
        document_id: documentId,
        ok: result.ok,
        protocol_id: result.protocolId,
        chunks: result.chunksInserted,
        templates: result.templatesInserted,
        error: result.error,
      });
    }),
  );

  // 200 promptly so Svix considers delivery successful.
  return new Response(JSON.stringify({ ok: true, processing: true }), {
    headers: jsonHeaders,
  });
});
