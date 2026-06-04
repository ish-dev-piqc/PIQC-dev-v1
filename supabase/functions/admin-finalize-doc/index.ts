import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchReductoJobResult,
  processIngestCompletion,
} from "../_shared/ingestPipeline.ts";

// =============================================================================
// /admin-finalize-doc — ONE-OFF, SERVICE-ROLE-ONLY operator tool.
//
// Re-runs the ingest completion pipeline on a specific document by id. Used to
// backfill an already-`ready` protocol in place after a pipeline fix (the
// completion reuses the doc's existing protocol_id, so no duplicate protocol).
//
// DELETE THIS FUNCTION once the backfill is done — it is not part of the
// product surface.
// =============================================================================

const jsonHeaders = { "Content-Type": "application/json" };

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Gate: only a service_role bearer may invoke this operator tool. Check the
  // JWT's role claim (robust — the caller's key and the injected key are
  // distinct service_role tokens that won't string-match), with exact-match fallback.
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let bearerRole: string | null = null;
  try {
    bearerRole = JSON.parse(atob(bearer.split(".")[1] ?? "")).role ?? null;
  } catch {
    bearerRole = null;
  }
  if (bearerRole !== "service_role" && bearer !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
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

  let documentId: string | null = null;
  let extractionOverride: Record<string, unknown> | null = null;
  try {
    const body = await req.json();
    documentId = typeof body.document_id === "string" ? body.document_id : null;
    if (body.extraction && typeof body.extraction === "object") {
      extractionOverride = body.extraction as Record<string, unknown>;
    }
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

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, status, reducto_job_id, protocol_id, user_id")
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
  if (!doc.reducto_job_id) {
    return new Response(JSON.stringify({ error: "No reducto_job_id on document" }), {
      status: 409,
      headers: jsonHeaders,
    });
  }

  let userEmail: string | null = null;
  try {
    const { data: u } = await supabase.auth.admin.getUserById(doc.user_id);
    userEmail = u?.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  // Recovery mode (extraction supplied) skips the Reducto status pre-check —
  // we re-persist the supplied extraction and don't depend on a fresh parse.
  if (!extractionOverride) {
    let reductoStatus: string;
    try {
      const result = await fetchReductoJobResult(doc.reducto_job_id, reductoKey);
      reductoStatus = result.status.toLowerCase();
    } catch (e) {
      return new Response(
        JSON.stringify({ error: "reducto_status_failed", detail: e instanceof Error ? e.message : String(e) }),
        { status: 502, headers: jsonHeaders },
      );
    }
    if (reductoStatus !== "completed") {
      return new Response(
        JSON.stringify({ status: reductoStatus, note: "Reducto job not completed; nothing finalized" }),
        { status: 200, headers: jsonHeaders },
      );
    }
  }

  const completion = await processIngestCompletion(supabase, {
    docId: doc.id,
    reductoJobId: doc.reducto_job_id,
    userId: doc.user_id,
    userEmail,
    openaiKey,
    reductoKey,
    extractionOverride,
  });

  return new Response(
    JSON.stringify({
      ok: completion.ok,
      document_id: doc.id,
      protocol_id: completion.ok ? completion.protocolId : doc.protocol_id,
      error: completion.ok ? null : completion.error,
    }),
    { status: completion.ok ? 200 : 500, headers: jsonHeaders },
  );
});
