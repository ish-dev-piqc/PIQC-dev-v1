import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// send-notification-email — POST endpoint that sends a chat-notification
// email via Resend. Called from Postgres pg_net triggers, never directly
// from the client.
//
// Authentication: service-role JWT in Authorization header. The triggers
// supply this from the Vault `service_role_key` secret.
//
// Body shape:
//   { type: 'mention' | 'decision_ack',
//     user_id: string,
//     context: { ... type-specific fields ... } }
//
// The recipient's notify_*_email preference is double-checked here even
// though the trigger already gates on it — small belt-and-suspenders
// against drift.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RESEND_FROM = "PIQClinical <hello@updates.piqclinical.com>";

interface RequestBody {
  type: "mention" | "decision_ack";
  user_id: string;
  context: Record<string, unknown>;
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ level, event, timestamp: new Date().toISOString(), ...fields }));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c),
  );
}

interface ComposedEmail {
  subject: string;
  text: string;
  html: string;
  replyTo: string | null;
}

function composeMentionEmail(
  recipientName: string,
  actorName: string,
  channelLabel: string,
  bodyPreview: string,
  appUrl: string,
): ComposedEmail {
  const subject = `${actorName} mentioned you in ${channelLabel}`;
  const text =
    `Hi ${recipientName},\n\n` +
    `${actorName} mentioned you in ${channelLabel} on PIQClinical:\n\n` +
    `"${bodyPreview}"\n\n` +
    `Open the conversation: ${appUrl}\n\n` +
    `— PIQClinical`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p><strong>${escapeHtml(actorName)}</strong> mentioned you in
         <strong>${escapeHtml(channelLabel)}</strong> on PIQClinical:</p>
      <blockquote style="border-left: 3px solid #94a3b8; padding-left: 12px; margin: 16px 0; color: #475569;">
        ${escapeHtml(bodyPreview)}
      </blockquote>
      <p>
        <a href="${appUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none;">
          Open the conversation
        </a>
      </p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 32px;">
        — PIQClinical · You can disable mention emails in Settings → Notifications.
      </p>
    </div>`;
  return { subject, text, html, replyTo: null };
}

function composeDecisionAckEmail(
  recipientName: string,
  decisionTitle: string,
  appUrl: string,
): ComposedEmail {
  const subject = `Decision needs your acknowledgment: ${decisionTitle}`;
  const text =
    `Hi ${recipientName},\n\n` +
    `A decision on PIQClinical needs your acknowledgment:\n\n` +
    `"${decisionTitle}"\n\n` +
    `Open the decisions panel: ${appUrl}\n\n` +
    `— PIQClinical`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto;">
      <p>Hi ${escapeHtml(recipientName)},</p>
      <p>A decision on PIQClinical needs your acknowledgment:</p>
      <blockquote style="border-left: 3px solid #d97706; padding-left: 12px; margin: 16px 0; color: #475569;">
        <strong>${escapeHtml(decisionTitle)}</strong>
      </blockquote>
      <p>
        <a href="${appUrl}" style="display: inline-block; background: #d97706; color: white; padding: 8px 16px; border-radius: 6px; text-decoration: none;">
          Open the decisions panel
        </a>
      </p>
      <p style="font-size: 12px; color: #94a3b8; margin-top: 32px;">
        — PIQClinical · You can disable decision emails in Settings → Notifications.
      </p>
    </div>`;
  return { subject, text, html, replyTo: null };
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

  // Service-role auth — same Vault secret the triggers use.
  const authHeader = req.headers.get("Authorization") ?? "";
  const expectedKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!expectedKey || authHeader !== `Bearer ${expectedKey}`) {
    log("warn", "auth_failed");
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  if (body.type !== "mention" && body.type !== "decision_ack") {
    return new Response(JSON.stringify({ error: "invalid_type" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  if (!body.user_id) {
    return new Response(JSON.stringify({ error: "missing_user_id" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const client = createClient(supabaseUrl, expectedKey);

  // Recipient prefs + email.
  const { data: prefs } = await client
    .from("user_notification_preferences")
    .select("notify_mentions_email, notify_decisions_email")
    .eq("user_id", body.user_id)
    .maybeSingle();
  const enabled =
    body.type === "mention"
      ? prefs?.notify_mentions_email === true
      : prefs?.notify_decisions_email === true;
  if (!enabled) {
    log("info", "skipped_pref_off", { user_id: body.user_id, type: body.type });
    return new Response(JSON.stringify({ ok: true, skipped: "pref_off" }), {
      status: 200,
      headers: jsonHeaders,
    });
  }

  const { data: authUser, error: authUserErr } = await client.auth.admin.getUserById(body.user_id);
  if (authUserErr || !authUser?.user?.email) {
    log("error", "recipient_lookup_failed", { user_id: body.user_id, error: authUserErr });
    return new Response(JSON.stringify({ error: "recipient_lookup_failed" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

  const recipientEmail = authUser.user.email;
  const { data: profile } = await client
    .from("user_profiles")
    .select("name")
    .eq("id", body.user_id)
    .maybeSingle();
  const recipientName = profile?.name?.split(/\s+/)[0] ?? "there";

  const appUrl = Deno.env.get("PIQC_APP_URL") ?? "https://app.piqclinical.com";

  let composed: ComposedEmail;
  if (body.type === "mention") {
    // Look up sender's display name (best effort).
    const senderId = body.context.mentioned_by_user_id as string | null | undefined;
    let actorName = "Someone";
    if (senderId) {
      const { data: actor } = await client
        .from("user_profiles")
        .select("name")
        .eq("id", senderId)
        .maybeSingle();
      if (actor?.name) actorName = actor.name.split(/\s+/)[0];
    }

    // Look up message body for preview.
    const orgMessageId = body.context.message_id as string | undefined;
    const orgId = body.context.org_id as string | null | undefined;
    const protocolId = body.context.protocol_id as string | null | undefined;
    let bodyPreview = "(message)";
    let channelLabel = "PIQClinical chat";
    if (orgMessageId && orgId) {
      const { data: msg } = await client
        .from("org_messages")
        .select("body")
        .eq("id", orgMessageId)
        .maybeSingle();
      if (msg?.body) bodyPreview = msg.body.slice(0, 200);
      channelLabel = "#general";
    } else if (orgMessageId && protocolId) {
      const { data: msg } = await client
        .from("protocol_messages")
        .select("body")
        .eq("id", orgMessageId)
        .maybeSingle();
      if (msg?.body) bodyPreview = msg.body.slice(0, 200);
      const { data: proto } = await client
        .from("protocols")
        .select("code")
        .eq("id", protocolId)
        .maybeSingle();
      if (proto?.code) channelLabel = `#${proto.code}`;
    }

    composed = composeMentionEmail(recipientName, actorName, channelLabel, bodyPreview, appUrl);
  } else {
    const decisionTitle = (body.context.decision_title as string) ?? "(untitled)";
    composed = composeDecisionAckEmail(recipientName, decisionTitle, appUrl);
  }

  // Send via Resend.
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!resendKey) {
    log("error", "resend_key_missing");
    return new Response(JSON.stringify({ error: "resend_key_missing" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

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
      ...(composed.replyTo ? { reply_to: composed.replyTo } : {}),
    }),
  });

  if (!resendRes.ok) {
    const errText = await resendRes.text();
    log("error", "resend_send_failed", { status: resendRes.status, error: errText });
    return new Response(JSON.stringify({ error: "resend_send_failed" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

  log("info", "sent", { user_id: body.user_id, type: body.type });
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
