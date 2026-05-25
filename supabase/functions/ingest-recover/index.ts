import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  fetchReductoJobResult,
  processIngestCompletion,
} from "../_shared/ingestPipeline.ts";

// =============================================================================
// /ingest-recover — safety net for documents stuck in `status='pending'`
// because Reducto's Svix webhook never arrived (delivery failure, network
// glitch, secret rotation race, etc.).
//
// Called from the authenticated frontend on dashboard mount. For each of
// the caller's documents in `pending` for >10 minutes:
//   - Look up the stored reducto_job_id
//   - Poll Reducto's job endpoint
//   - If completed: run processIngestCompletion to finalize
//   - If failed: mark documents.status='failed'
//   - If still running: leave alone (we'll try again on next mount)
//
// Idempotent. Returns a summary of what it did. The frontend doesn't need
// to react — the same realtime channel on documents catches the status
// flip and updates the UI.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const STALE_THRESHOLD_MINUTES = 10;
const MAX_RECOVERIES_PER_CALL = 5;

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

  // Auth — only authenticated callers (the dashboard mount path).
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

  // Find this user's stuck documents.
  const staleCutoff = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60_000,
  ).toISOString();

  const { data: stuck, error: selectErr } = await supabase
    .from("documents")
    .select("id, reducto_job_id, updated_at")
    .eq("user_id", userId)
    .eq("status", "pending")
    .not("reducto_job_id", "is", null)
    .lt("updated_at", staleCutoff)
    .order("updated_at", { ascending: true })
    .limit(MAX_RECOVERIES_PER_CALL);

  if (selectErr) {
    console.error("[ingest-recover] select_failed", { error: selectErr.message });
    return new Response(JSON.stringify({ error: "DB lookup failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  if (!stuck || stuck.length === 0) {
    return new Response(JSON.stringify({ ok: true, recovered: 0, checked: 0 }), {
      headers: jsonHeaders,
    });
  }

  let recovered = 0;
  let failedCount = 0;
  let stillRunning = 0;

  for (const row of stuck as Array<{ id: string; reducto_job_id: string }>) {
    try {
      const jobResult = await fetchReductoJobResult(row.reducto_job_id, reductoKey);
      const status = jobResult.status.toLowerCase();

      if (status === "completed") {
        const result = await processIngestCompletion(supabase, {
          docId: row.id,
          reductoJobId: row.reducto_job_id,
          userId,
          userEmail,
          openaiKey,
          reductoKey,
        });
        if (result.ok) {
          recovered += 1;
        } else {
          failedCount += 1;
        }
      } else if (status === "failed" || status === "cancelled" || status === "canceled") {
        await supabase
          .from("documents")
          .update({
            status: "failed",
            error_message: `Reducto job ended with status: ${jobResult.status}`,
          })
          .eq("id", row.id);
        failedCount += 1;
      } else {
        // Still running on Reducto's side — leave alone.
        stillRunning += 1;
      }
    } catch (e) {
      console.error("[ingest-recover] item_failed", {
        document_id: row.id,
        reducto_job_id: row.reducto_job_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      checked: stuck.length,
      recovered,
      failed: failedCount,
      still_running: stillRunning,
    }),
    { headers: jsonHeaders },
  );
});
