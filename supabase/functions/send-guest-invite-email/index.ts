import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// send-guest-invite-email — POST endpoint that emails a protocol-guest invite
// link via Resend. Parallel to send-org-invite-email, for the guest surface.
//
// Flow:
//   1. Verify caller's JWT via anon-key client + auth.getUser.
//   2. Fetch the guest row through the RLS-enforced user client. The
//      protocol_guests_coordinator_or_self_select policy only returns the row
//      to a coordinator of the protocol (or the guest themselves), so a
//      non-empty result IS the authorization check — no manual lookup needed.
//   3. Service-role lookup of the protocol name + inviter name/email.
//   4. POST to Resend. From: hello@updates.piqclinical.com.
//      Reply-To: the inviter's auth.users.email so replies route to a human.
//
// Best-effort from the caller's perspective: if Resend fails, the guest row
// still exists and the coordinator can copy the link manually. Failure returns
// 502 with a structured error log.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RESEND_FROM = "PIQClinical <hello@updates.piqclinical.com>";

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  }));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c] ?? c));
}

interface RequestBody {
  guestId: string;
  inviteUrl: string;
}

function validate(body: unknown): { ok: true; data: RequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const guestId = typeof b.guestId === "string" ? b.guestId.trim() : "";
  const inviteUrl = typeof b.inviteUrl === "string" ? b.inviteUrl.trim() : "";
  if (!guestId) return { ok: false, error: "Missing guestId" };
  if (!inviteUrl || !/^https?:\/\//.test(inviteUrl)) return { ok: false, error: "Invalid inviteUrl" };
  return { ok: true, data: { guestId, inviteUrl } };
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

  const requestId = crypto.randomUUID();

  // ---- Parse + validate body ------------------------------------------------
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  const validated = validate(raw);
  if (!validated.ok) {
    return new Response(JSON.stringify({ error: validated.error }), {
      status: 400,
      headers: jsonHeaders,
    });
  }
  const { guestId, inviteUrl } = validated.data;

  // ---- Auth -----------------------------------------------------------------
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Missing auth" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    log("error", "send_guest_invite.missing_supabase_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Verify the caller's JWT by using an anon-key client + the user's Bearer.
  // This same client also enforces RLS on the guest lookup below.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    log("warn", "send_guest_invite.auth_failed", {
      request_id: requestId,
      error: userErr?.message,
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }

  // ---- Look up guest via RLS (authorization == row visibility) -------------
  // protocol_guests_coordinator_or_self_select only returns the row to a
  // coordinator of the protocol (or the guest). If it comes back empty, the
  // caller isn't allowed to send this invite.
  const { data: guest, error: guestErr } = await userClient
    .from("protocol_guests")
    .select("id, protocol_id, invited_email, invited_by, expires_at, accepted_at")
    .eq("id", guestId)
    .maybeSingle();
  if (guestErr) {
    log("error", "send_guest_invite.guest_lookup_failed", {
      request_id: requestId,
      error: guestErr.message,
    });
    return new Response(JSON.stringify({ error: "Guest lookup failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!guest) {
    return new Response(JSON.stringify({ error: "Guest invite not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }
  if (guest.accepted_at) {
    return new Response(JSON.stringify({ error: "Invite already accepted" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // ---- Service-role lookups for email content ------------------------------
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: protocol } = await admin
    .from("protocols")
    .select("study_number, title")
    .eq("id", guest.protocol_id)
    .maybeSingle();
  const protocolLabel = protocol?.study_number?.trim() || protocol?.title?.trim() || "a protocol";

  let inviterName = "A colleague";
  let inviterEmail: string | null = null;
  if (guest.invited_by) {
    const [profileResult, authResult] = await Promise.all([
      admin
        .from("user_profiles")
        .select("name")
        .eq("id", guest.invited_by)
        .maybeSingle(),
      admin.auth.admin.getUserById(guest.invited_by),
    ]);
    const profileName = profileResult.data?.name;
    if (profileName && typeof profileName === "string" && profileName.trim()) {
      inviterName = profileName.trim();
    }
    const authEmail = authResult.data?.user?.email;
    if (authEmail) inviterEmail = authEmail;
  }

  // ---- Compose email -------------------------------------------------------
  const expiryDate = new Date(guest.expires_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `${inviterName} invited you to ${protocolLabel} on PIQClinical`;
  const text = [
    `${inviterName} invited you to collaborate on ${protocolLabel} as a guest on PIQClinical.`,
    ``,
    `Accept the invite:`,
    inviteUrl,
    ``,
    `The link expires on ${expiryDate}.`,
    `If you don't have a PIQClinical account yet, you can create one when you click the link.`,
    ``,
    `—`,
    `The PIQClinical team`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0F172A; max-width: 560px; padding: 24px; line-height: 1.5;">
  <p style="margin: 0 0 16px 0; font-size: 15px;">
    <strong>${escapeHtml(inviterName)}</strong> invited you to collaborate on
    <strong>${escapeHtml(protocolLabel)}</strong> as a guest on PIQClinical.
  </p>
  <p style="margin: 0 0 24px 0;">
    <a href="${escapeHtml(inviteUrl)}"
       style="display: inline-block; background: #2563eb; color: #ffffff;
              padding: 10px 18px; border-radius: 6px; text-decoration: none;
              font-weight: 600; font-size: 14px;">
      Accept invite
    </a>
  </p>
  <p style="margin: 0 0 8px 0; color: #475569; font-size: 13px;">
    Or copy this link into your browser:
  </p>
  <p style="margin: 0 0 24px 0; color: #475569; font-size: 13px; word-break: break-all;">
    <a href="${escapeHtml(inviteUrl)}" style="color: #2563eb;">${escapeHtml(inviteUrl)}</a>
  </p>
  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px;">
    This invite expires on ${escapeHtml(expiryDate)}.
  </p>
  <p style="margin: 0 0 8px 0; color: #64748b; font-size: 12px;">
    If you don't have a PIQClinical account yet, you can create one when you click the link.
  </p>
  <p style="margin: 32px 0 0 0; color: #94a3b8; font-size: 12px;">
    —<br/>The PIQClinical team
  </p>
</body></html>`;

  // ---- Send via Resend -----------------------------------------------------
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    log("warn", "send_guest_invite.resend.missing_key", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Email service not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const resendBody: Record<string, unknown> = {
      from: RESEND_FROM,
      to: [guest.invited_email],
      subject,
      text,
      html,
    };
    if (inviterEmail) {
      resendBody.reply_to = inviterEmail;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(resendBody),
    });

    if (!res.ok) {
      const bodyText = await res.text();
      log("error", "send_guest_invite.resend.error", {
        request_id: requestId,
        status: res.status,
        body: bodyText.slice(0, 2000),
        guest_id: guest.id,
        to_domain: guest.invited_email.split("@")[1],
      });
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 502,
        headers: jsonHeaders,
      });
    }
  } catch (err) {
    log("error", "send_guest_invite.resend.fetch_failed", {
      request_id: requestId,
      error: String(err),
    });
    return new Response(JSON.stringify({ error: "Email send failed" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

  log("info", "send_guest_invite.sent", {
    request_id: requestId,
    guest_id: guest.id,
    to_domain: guest.invited_email.split("@")[1],
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
