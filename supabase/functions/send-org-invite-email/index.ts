import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// =============================================================================
// send-org-invite-email — POST endpoint that emails an org invite link via
// Resend.
//
// Flow:
//   1. Verify caller's JWT via anon-key client + auth.getUser.
//   2. Service-role lookup of the invite + verify caller is admin of the
//      invite's org (manual check; service role bypasses RLS).
//   3. Compose subject/text/html using the org name, inviter's display name,
//      role label, expiry date.
//   4. POST to Resend. From: the canonical hello@updates.piqclinical.com.
//      Reply-To: the inviter's auth.users.email so replies route to a human.
//
// Best-effort from the caller's perspective: if Resend fails, the invite row
// still exists and the admin can copy the link manually from the pending-
// invites list. Failure returns 502 with a structured error log.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RESEND_FROM = "PIQClinical <hello@updates.piqclinical.com>";

const ROLE_LABEL: Record<string, string> = {
  admin: "Site administrator",
  member: "Site member",
};

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
  inviteId: string;
  inviteUrl: string;
}

function validate(body: unknown): { ok: true; data: RequestBody } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;
  const inviteId = typeof b.inviteId === "string" ? b.inviteId.trim() : "";
  const inviteUrl = typeof b.inviteUrl === "string" ? b.inviteUrl.trim() : "";
  if (!inviteId) return { ok: false, error: "Missing inviteId" };
  if (!inviteUrl || !/^https?:\/\//.test(inviteUrl)) return { ok: false, error: "Invalid inviteUrl" };
  return { ok: true, data: { inviteId, inviteUrl } };
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
  const { inviteId, inviteUrl } = validated.data;

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
    log("error", "send_invite.missing_supabase_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  // Verify the caller's JWT by using an anon-key client + the user's Bearer.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    log("warn", "send_invite.auth_failed", {
      request_id: requestId,
      error: userErr?.message,
    });
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders,
    });
  }
  const user = userData.user;

  // ---- Look up invite (service role; manual admin check below) -------------
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: invite, error: inviteErr } = await admin
    .from("org_invites")
    .select("id, org_id, email, role, invited_by, expires_at, used_at")
    .eq("id", inviteId)
    .maybeSingle();
  if (inviteErr) {
    log("error", "send_invite.invite_lookup_failed", {
      request_id: requestId,
      error: inviteErr.message,
    });
    return new Response(JSON.stringify({ error: "Invite lookup failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!invite) {
    return new Response(JSON.stringify({ error: "Invite not found" }), {
      status: 404,
      headers: jsonHeaders,
    });
  }
  if (invite.used_at) {
    return new Response(JSON.stringify({ error: "Invite already used" }), {
      status: 400,
      headers: jsonHeaders,
    });
  }

  // ---- Verify caller is admin of the invite's org --------------------------
  const { data: membership, error: membershipErr } = await admin
    .from("org_members")
    .select("role")
    .eq("org_id", invite.org_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipErr) {
    log("error", "send_invite.membership_lookup_failed", {
      request_id: requestId,
      error: membershipErr.message,
    });
    return new Response(JSON.stringify({ error: "Authorization check failed" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
  if (!membership || membership.role !== "admin") {
    log("warn", "send_invite.forbidden", {
      request_id: requestId,
      user_id: user.id,
      org_id: invite.org_id,
    });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: jsonHeaders,
    });
  }

  // ---- Look up org name + inviter name + inviter email ---------------------
  const { data: org } = await admin
    .from("orgs")
    .select("name")
    .eq("id", invite.org_id)
    .maybeSingle();
  const orgName = org?.name ?? "your organization";

  let inviterName = "A colleague";
  let inviterEmail: string | null = null;
  if (invite.invited_by) {
    const [profileResult, authResult] = await Promise.all([
      admin
        .from("user_profiles")
        .select("name")
        .eq("id", invite.invited_by)
        .maybeSingle(),
      admin.auth.admin.getUserById(invite.invited_by),
    ]);
    const profileName = profileResult.data?.name;
    if (profileName && typeof profileName === "string" && profileName.trim()) {
      inviterName = profileName.trim();
    }
    const authEmail = authResult.data?.user?.email;
    if (authEmail) inviterEmail = authEmail;
  }

  // ---- Compose email -------------------------------------------------------
  const roleLabel = ROLE_LABEL[invite.role] ?? "Team member";
  const expiryDate = new Date(invite.expires_at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const subject = `${inviterName} invited you to ${orgName} on PIQClinical`;
  const text = [
    `${inviterName} invited you to join ${orgName} on PIQClinical as a ${roleLabel}.`,
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
    <strong>${escapeHtml(inviterName)}</strong> invited you to join
    <strong>${escapeHtml(orgName)}</strong> on PIQClinical as a
    <strong>${escapeHtml(roleLabel)}</strong>.
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
    log("warn", "send_invite.resend.missing_key", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Email service not configured" }), {
      status: 500,
      headers: jsonHeaders,
    });
  }

  try {
    const resendBody: Record<string, unknown> = {
      from: RESEND_FROM,
      to: [invite.email],
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
      log("error", "send_invite.resend.error", {
        request_id: requestId,
        status: res.status,
        body: bodyText.slice(0, 2000),
        invite_id: invite.id,
        to_domain: invite.email.split("@")[1],
      });
      return new Response(JSON.stringify({ error: "Email send failed" }), {
        status: 502,
        headers: jsonHeaders,
      });
    }
  } catch (err) {
    log("error", "send_invite.resend.fetch_failed", {
      request_id: requestId,
      error: String(err),
    });
    return new Response(JSON.stringify({ error: "Email send failed" }), {
      status: 502,
      headers: jsonHeaders,
    });
  }

  log("info", "send_invite.sent", {
    request_id: requestId,
    invite_id: invite.id,
    to_domain: invite.email.split("@")[1],
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: jsonHeaders,
  });
});
