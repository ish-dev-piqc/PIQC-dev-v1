// =============================================================================
// Resend send helper — shared across edge functions.
//
// Posts a single transactional email via https://api.resend.com/emails.
// Reads RESEND_API_KEY from Deno.env. Caller passes a requestId + logPrefix so
// structured log events stay grep-able per consumer
// (e.g. "contact.resend.error" vs "invite.resend.error").
//
// Production setup (DNS records, supabase secrets, MCP) is documented in
// docs/RESEND.md at the repo root.
// =============================================================================

export interface ResendSendInput {
  to: string | string[];
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html?: string;
}

export interface ResendSendResult {
  ok: boolean;
  error?: string;
}

export interface ResendSendContext {
  requestId: string;
  logPrefix: string;
}

function logJson(level: "warn" | "error", event: string, fields: Record<string, unknown>) {
  console.log(JSON.stringify({
    level,
    event,
    timestamp: new Date().toISOString(),
    ...fields,
  }));
}

export async function sendResendEmail(
  input: ResendSendInput,
  ctx: ResendSendContext,
): Promise<ResendSendResult> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    logJson("warn", `${ctx.logPrefix}.resend.missing_key`, { request_id: ctx.requestId });
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const body: Record<string, unknown> = {
    from: input.from,
    to: Array.isArray(input.to) ? input.to : [input.to],
    subject: input.subject,
    text: input.text,
  };
  if (input.replyTo) body.reply_to = input.replyTo;
  if (input.html) body.html = input.html;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      logJson("error", `${ctx.logPrefix}.resend.error`, {
        request_id: ctx.requestId,
        status: res.status,
        body: errBody.slice(0, 2000),
      });
      return { ok: false, error: "Email send failed" };
    }

    return { ok: true };
  } catch (err) {
    logJson("error", `${ctx.logPrefix}.resend.fetch_failed`, {
      request_id: ctx.requestId,
      error: String(err),
    });
    return { ok: false, error: "Email send failed" };
  }
}
