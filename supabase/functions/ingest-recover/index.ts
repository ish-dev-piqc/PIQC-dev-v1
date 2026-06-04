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
const MAX_RECOVERIES_PER_CALL_CRON = 20;

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

  // Auth — two modes:
  //   • user mode    (dashboard mount): a user JWT → recover only that user's docs
  //   • cron mode    (pg_cron safety net): the service_role bearer → recover ANY
  //     stuck doc, resolving each doc's owner for the completion's userEmail.
  const authHeader = req.headers.get("Authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let bearerRole: string | null = null;
  try {
    bearerRole = JSON.parse(atob((bearer ?? "").split(".")[1] ?? "")).role ?? null;
  } catch {
    bearerRole = null;
  }
  const cronMode = bearerRole === "service_role" || bearer === serviceRoleKey;

  let userId: string | null = null;
  let userEmail: string | null = null;
  if (!cronMode && bearer) {
    const { data: { user } } = await createClient(supabaseUrl, serviceRoleKey).auth.getUser(bearer);
    userId = user?.id ?? null;
    userEmail = user?.email ?? null;
  }
  if (!cronMode && !userId) {
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

  let query = supabase
    .from("documents")
    .select("id, reducto_job_id, updated_at, user_id")
    .eq("status", "pending")
    .not("reducto_job_id", "is", null)
    .lt("updated_at", staleCutoff)
    .order("updated_at", { ascending: true })
    .limit(cronMode ? MAX_RECOVERIES_PER_CALL_CRON : MAX_RECOVERIES_PER_CALL);
  if (!cronMode && userId) query = query.eq("user_id", userId);
  const { data: stuck, error: selectErr } = await query;

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

  for (const row of stuck as Array<{ id: string; reducto_job_id: string; user_id: string }>) {
    try {
      const jobResult = await fetchReductoJobResult(row.reducto_job_id, reductoKey);
      const status = jobResult.status.toLowerCase();

      if (status === "completed") {
        // In cron mode each doc has its own owner — resolve it for the
        // completion's B2.4 missing-org fallback.
        let rowUserId = userId;
        let rowUserEmail = userEmail;
        if (cronMode) {
          rowUserId = row.user_id;
          try {
            const { data: u } = await supabase.auth.admin.getUserById(row.user_id);
            rowUserEmail = u?.user?.email ?? null;
          } catch {
            rowUserEmail = null;
          }
        }
        const result = await processIngestCompletion(supabase, {
          docId: row.id,
          reductoJobId: row.reducto_job_id,
          userId: rowUserId!,
          userEmail: rowUserEmail,
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
