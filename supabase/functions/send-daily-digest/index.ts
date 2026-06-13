import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// send-daily-digest — POST endpoint invoked by the `daily-digest-send` pg_cron
// job. Loops users where user_notification_preferences.daily_digest = TRUE,
// computes their three buckets (unread mentions, pending decision acks,
// overdue deviations), and sends one Resend email each — skipping users
// whose buckets are all empty.
//
// Authentication: service-role JWT in Authorization header. The cron entry
// supplies this from the Vault `service_role_key` secret.
//
// Body: empty JSON. No per-user payload — the function decides which users
// get an email based on the prefs table.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RESEND_FROM = "PIQClinical <hello@updates.piqclinical.com>";
const BUCKET_CAP = 20;

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields }));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}

interface DigestBuckets {
  mentions: { author: string; channel: string; preview: string }[];
  pendingAcks: { title: string; decidedAt: string }[];
  overdueDeviations: { protocolCode: string; participantId: string; date: string }[];
}

function composeDigestEmail(
  recipientName: string,
  buckets: DigestBuckets,
  appUrl: string,
): { subject: string; text: string; html: string } {
  const totalItems =
    buckets.mentions.length + buckets.pendingAcks.length + buckets.overdueDeviations.length;
  const subject = `Your PIQClinical morning digest — ${totalItems} item${totalItems === 1 ? "" : "s"}`;

  // Plain-text version
  const textParts: string[] = [`Hi ${recipientName},\n`];
  textParts.push(`Here's what's waiting in PIQClinical this morning:\n`);

  if (buckets.mentions.length > 0) {
    textParts.push(`\nUnread mentions (${buckets.mentions.length}):`);
    for (const m of buckets.mentions) {
      textParts.push(`  • ${m.author} in ${m.channel} — "${m.preview}"`);
    }
  }
  if (buckets.pendingAcks.length > 0) {
    textParts.push(`\nDecisions awaiting your ack (${buckets.pendingAcks.length}):`);
    for (const d of buckets.pendingAcks) {
      textParts.push(`  • ${d.title} (decided ${d.decidedAt})`);
    }
  }
  if (buckets.overdueDeviations.length > 0) {
    textParts.push(`\nOverdue deviation sign-offs (${buckets.overdueDeviations.length}):`);
    for (const v of buckets.overdueDeviations) {
      textParts.push(`  • ${v.protocolCode} · ${v.participantId} (${v.date})`);
    }
  }
  textParts.push(`\nOpen PIQClinical: ${appUrl}\n`);
  textParts.push(`— PIQClinical · Disable the daily digest in Settings → Notifications.`);
  const text = textParts.join("\n");

  // HTML version
  const sectionStyle =
    "margin: 16px 0; padding-left: 12px; border-left: 3px solid #cbd5e1;";
  const itemStyle = "margin: 4px 0; color: #475569;";
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto;">
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>Here's what's waiting in PIQClinical this morning:</p>
      ${
        buckets.mentions.length > 0
          ? `<div style="${sectionStyle}">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Unread mentions (${buckets.mentions.length})</p>
              ${buckets.mentions
                .map(
                  (m) =>
                    `<p style="${itemStyle}"><strong>${escapeHtml(m.author)}</strong> in ${escapeHtml(m.channel)} — "${escapeHtml(m.preview)}"</p>`,
                )
                .join("")}
            </div>`
          : ""
      }
      ${
        buckets.pendingAcks.length > 0
          ? `<div style="${sectionStyle.replace("#cbd5e1", "#d97706")}">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Decisions awaiting your ack (${buckets.pendingAcks.length})</p>
              ${buckets.pendingAcks
                .map(
                  (d) =>
                    `<p style="${itemStyle}">${escapeHtml(d.title)} <span style="color: #94a3b8;">· decided ${escapeHtml(d.decidedAt)}</span></p>`,
                )
                .join("")}
            </div>`
          : ""
      }
      ${
        buckets.overdueDeviations.length > 0
          ? `<div style="${sectionStyle.replace("#cbd5e1", "#ba7517")}">
              <p style="font-weight: 600; margin: 0 0 8px 0;">Overdue deviation sign-offs (${buckets.overdueDeviations.length})</p>
              ${buckets.overdueDeviations
                .map(
                  (v) =>
                    `<p style="${itemStyle}">${escapeHtml(v.protocolCode)} · ${escapeHtml(v.participantId)} <span style="color: #94a3b8;">(${escapeHtml(v.date)})</span></p>`,
                )
                .join("")}
            </div>`
          : ""
      }
      <p style="margin-top: 24px;">
        <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none;">
          Open PIQClinical
        </a>
      </p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 32px;">
        — PIQClinical · Disable the daily digest in Settings → Notifications.
      </p>
    </div>`;
  return { subject, text, html };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = ReturnType<typeof createClient<any, "public", any>>;

async function buildBucketsForUser(client: SbClient, userId: string): Promise<DigestBuckets> {
  // Bucket 1 — unread mentions (with sender + channel label).
  const { data: mentionsRaw } = await client
    .from("chat_mentions")
    .select(
      "id, mentioned_by_user_id, org_message_id, protocol_message_id, org_id, protocol_id, created_at",
    )
    .eq("mentioned_user_id", userId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(BUCKET_CAP);

  const mentions: DigestBuckets["mentions"] = [];
  for (const m of mentionsRaw ?? []) {
    let preview = "(message)";
    let channel = "PIQClinical";
    if (m.org_message_id) {
      const { data: msg } = await client
        .from("org_messages")
        .select("body")
        .eq("id", m.org_message_id)
        .maybeSingle();
      if (msg?.body) preview = (msg.body as string).slice(0, 120);
      channel = "#general";
    } else if (m.protocol_message_id) {
      const { data: msg } = await client
        .from("protocol_messages")
        .select("body")
        .eq("id", m.protocol_message_id)
        .maybeSingle();
      if (msg?.body) preview = (msg.body as string).slice(0, 120);
      if (m.protocol_id) {
        const { data: proto } = await client
          .from("protocols")
          .select("code")
          .eq("id", m.protocol_id)
          .maybeSingle();
        const code = (proto as { code?: string } | null)?.code;
        if (code) channel = `#${code}`;
      }
    }
    let author = "Someone";
    if (m.mentioned_by_user_id) {
      const { data: actor } = await client
        .from("user_profiles")
        .select("name")
        .eq("id", m.mentioned_by_user_id)
        .maybeSingle();
      if (actor?.name) author = (actor.name as string).split(/\s+/)[0];
    }
    mentions.push({ author, channel, preview });
  }

  // Bucket 2 — decisions awaiting this user's ack.
  const { data: acksRaw } = await client
    .from("chat_decision_acks")
    .select("decision_id, chat_decisions:decision_id(title, decided_at)")
    .eq("user_id", userId)
    .is("acked_at", null)
    .limit(BUCKET_CAP);

  const pendingAcks: DigestBuckets["pendingAcks"] = (acksRaw ?? []).map((row) => {
    const inner = row.chat_decisions as
      | { title?: string; decided_at?: string }
      | { title?: string; decided_at?: string }[]
      | null;
    const decision = Array.isArray(inner) ? inner[0] : inner;
    return {
      title: decision?.title ?? "(untitled decision)",
      decidedAt: decision?.decided_at
        ? new Date(decision.decided_at).toLocaleDateString()
        : "—",
    };
  });

  // Bucket 3 — overdue deviation sign-offs (last 30 days) on protocols
  // the user can access. RLS on site_visits gates access through the
  // existing user_can_access_protocol fn, so a plain query is correct
  // when run as the user — but this function runs as service-role, so
  // we explicitly filter by accessible protocols via org membership.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const { data: devRows } = await client
    .from("site_visits")
    .select(
      "id, date, participant_id, protocol_id, site_participants:participant_id(participant_code), protocols:protocol_id(code)",
    )
    .eq("status", "deviation")
    .is("deviation_reason", null)
    .gte("date", thirtyDaysAgo)
    .order("date", { ascending: false })
    .limit(BUCKET_CAP * 4); // overfetch then filter

  const accessibleDevs: DigestBuckets["overdueDeviations"] = [];
  for (const v of devRows ?? []) {
    if (accessibleDevs.length >= BUCKET_CAP) break;
    const { data: canAccess } = await client.rpc("user_can_access_protocol", {
      uid: userId,
      pid: v.protocol_id,
    });
    if (canAccess !== true) continue;
    const protoInner = v.protocols as { code?: string } | { code?: string }[] | null;
    const proto = Array.isArray(protoInner) ? protoInner[0] : protoInner;
    const partInner = v.site_participants as
      | { participant_code?: string }
      | { participant_code?: string }[]
      | null;
    const part = Array.isArray(partInner) ? partInner[0] : partInner;
    accessibleDevs.push({
      protocolCode: proto?.code ?? "protocol",
      participantId: part?.participant_code ?? "—",
      date: v.date as string,
    });
  }

  return {
    mentions,
    pendingAcks,
    overdueDeviations: accessibleDevs,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: jsonHeaders,
    });
  }

  // Service-role auth — same Vault secret the per-event trigger uses.
  const authHeader = req.headers.get("Authorization") ?? "";
  const expectedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    log("warn", "auth_failed");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendKey) {
    log("error", "resend_key_missing");
    return new Response(JSON.stringify({ error: "resend_key_missing" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }
  const appUrl = Deno.env.get("PIQC_APP_URL") ?? "https://app.piqclinical.com";

  const client = createClient(supabaseUrl, expectedKey);

  // Pull all opted-in users in one shot.
  const { data: optedIn, error: prefsErr } = await client
    .from("user_notification_preferences")
    .select("user_id")
    .eq("daily_digest", true);
  if (prefsErr) {
    log("error", "prefs_query_failed", { error: prefsErr.message });
    return new Response(JSON.stringify({ error: "prefs_query_failed" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

  let sent = 0;
  let skippedEmpty = 0;
  let failed = 0;

  for (const row of optedIn ?? []) {
    const userId = row.user_id as string;
    try {
      const buckets = await buildBucketsForUser(client, userId);
      const total =
        buckets.mentions.length + buckets.pendingAcks.length + buckets.overdueDeviations.length;
      if (total === 0) {
        skippedEmpty++;
        continue;
      }

      const { data: authUser } = await client.auth.admin.getUserById(userId);
      const recipientEmail = authUser?.user?.email;
      if (!recipientEmail) {
        log("warn", "no_email", { user_id: userId });
        failed++;
        continue;
      }
      const { data: profile } = await client
        .from("user_profiles")
        .select("name")
        .eq("id", userId)
        .maybeSingle();
      const recipientName = profile?.name?.split(/\s+/)[0] ?? "there";

      const composed = composeDigestEmail(recipientName, buckets, appUrl);
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: recipientEmail,
          subject: composed.subject,
          text: composed.text,
          html: composed.html,
        }),
      });
      if (!resendRes.ok) {
        const errText = await resendRes.text();
        log("error", "resend_send_failed", {
          user_id: userId,
          status: resendRes.status,
          error: errText,
        });
        failed++;
        continue;
      }
      sent++;
    } catch (e) {
      log("error", "user_digest_failed", {
        user_id: userId,
        error: e instanceof Error ? e.message : String(e),
      });
      failed++;
    }
  }

  log("info", "digest_run_complete", {
    total_opted_in: optedIn?.length ?? 0,
    sent,
    skipped_empty: skippedEmpty,
    failed,
  });
  return new Response(
    JSON.stringify({ ok: true, sent, skipped_empty: skippedEmpty, failed }),
    { status: 200, headers: jsonHeaders },
  );
});
