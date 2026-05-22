import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const MAX_BODY_BYTES = 20_000;

const NAME_MAX = 200;
const EMAIL_MAX = 320;
const COMPANY_MAX = 200;
const MESSAGE_MAX = 5000;
const MESSAGE_MIN = 1;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RESEND_TO = "ishika@piqclinical.com";
const RESEND_FROM = "PIQClinical <hello@updates.piqclinical.com>";

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { ok: boolean; retryAfter: number } {
  const now = Date.now();

  if (rateLimitBuckets.size > 10_000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (v.resetAt < now) rateLimitBuckets.delete(k);
    }
  }

  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return { ok: true, retryAfter: 0 };
  }
  if (bucket.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }
  bucket.count++;
  return { ok: true, retryAfter: 0 };
}

function getClientIp(req: Request): string {
  return req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? "unknown";
}

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  }));
}

interface ContactBody {
  name: string;
  email: string;
  company?: string;
  message: string;
  // Honeypot. Should always be empty for real users.
  website?: string;
}

function validate(body: unknown): { ok: true; data: Required<Omit<ContactBody, "website" | "company">> & { company: string | null } } | { ok: false; error: string } {
  if (!body || typeof body !== "object") return { ok: false, error: "Invalid body" };
  const b = body as Record<string, unknown>;

  const name = typeof b.name === "string" ? b.name.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim() : "";
  const company = typeof b.company === "string" ? b.company.trim() : "";
  const message = typeof b.message === "string" ? b.message.trim() : "";

  if (name.length < 1 || name.length > NAME_MAX) return { ok: false, error: "Invalid name" };
  if (email.length < 3 || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, error: "Invalid email" };
  if (company.length > COMPANY_MAX) return { ok: false, error: "Company too long" };
  if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) return { ok: false, error: "Invalid message" };

  return {
    ok: true,
    data: { name, email, company: company || null, message },
  };
}

async function sendEmail(payload: {
  name: string;
  email: string;
  company: string | null;
  message: string;
}, requestId: string): Promise<{ ok: boolean; error?: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    log("warn", "contact.resend.missing_key", { request_id: requestId });
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const subject = `New contact: ${payload.name}${payload.company ? ` (${payload.company})` : ""}`;
  const text = [
    `From: ${payload.name} <${payload.email}>`,
    `Company: ${payload.company || "—"}`,
    "",
    payload.message,
  ].join("\n");

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [RESEND_TO],
        reply_to: payload.email,
        subject,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      log("error", "contact.resend.error", {
        request_id: requestId,
        status: res.status,
        body: body.slice(0, 2000),
      });
      return { ok: false, error: "Email send failed" };
    }

    return { ok: true };
  } catch (err) {
    log("error", "contact.resend.fetch_failed", {
      request_id: requestId,
      error: String(err),
    });
    return { ok: false, error: "Email send failed" };
  }
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
  const ip = getClientIp(req);

  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    log("warn", "contact.rate_limited", { request_id: requestId, ip, retry_after: rl.retryAfter });
    return new Response(
      JSON.stringify({ error: "Too many requests" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } }
    );
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return new Response(
      JSON.stringify({ error: "Content-Type must be application/json" }),
      { status: 415, headers: jsonHeaders }
    );
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    log("warn", "contact.body_too_large", { request_id: requestId, ip, content_length: contentLength });
    return new Response(
      JSON.stringify({ error: "Request body too large" }),
      { status: 413, headers: jsonHeaders }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: jsonHeaders });
  }

  // Honeypot — if the hidden `website` field is filled, pretend success.
  // Real users never see the field; bots fill everything.
  if (raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).website === "string" && (raw as Record<string, unknown>).website !== "") {
    log("warn", "contact.honeypot_triggered", { request_id: requestId, ip });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders });
  }

  const validated = validate(raw);
  if (!validated.ok) {
    return new Response(JSON.stringify({ error: validated.error }), { status: 400, headers: jsonHeaders });
  }
  const { name, email, company, message } = validated.data;

  const userAgent = req.headers.get("user-agent") ?? null;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    log("error", "contact.missing_supabase_env", { request_id: requestId });
    return new Response(
      JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: insertError } = await supabase.from("contact_messages").insert({
    name,
    email,
    company,
    message,
    ip,
    user_agent: userAgent,
  });

  if (insertError) {
    log("error", "contact.db.insert_failed", {
      request_id: requestId,
      error: insertError.message,
    });
    return new Response(
      JSON.stringify({ error: "Could not record submission" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  log("info", "contact.recorded", {
    request_id: requestId,
    ip,
    name_length: name.length,
    message_length: message.length,
  });

  // Best-effort email. If it fails, the DB row is still there and we surface
  // success to the user — Ishika checks the table if email goes missing.
  const emailResult = await sendEmail({ name, email, company, message }, requestId);
  if (!emailResult.ok) {
    log("warn", "contact.email_failed_row_kept", { request_id: requestId });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: jsonHeaders });
});
