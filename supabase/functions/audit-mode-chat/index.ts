// =============================================================================
// audit-mode-chat edge function — freeform conversational assistant for the
// auditor while they work inside an in-progress audit.
//
// Single-audit scope: the body carries audit_id + the prior conversation
// (messages: [{role, content}, ...]) and the function replies with one
// assistant turn. The function is read-only — it never writes back to any
// audit object. Auditor copies anything useful by hand. This keeps the
// agentic surface advisory, not authoritative, until a future PR earns
// the right to add tool-calls.
//
// Mirrors patterns from /functions/audit-summary/ and /functions/dashboard-chat/:
//   - OPENAI_API_KEY from Deno env
//   - rate-limit by IP
//   - body-size + message-shape guards
//   - safe logging (counts + lengths, never observation_text bodies)
//   - 30s timeout, AbortController on client disconnect
//   - JWT pass-through so all reads are RLS-scoped
//
// What this function does NOT do:
//   - persist messages anywhere
//   - allow tool-calls or function-calls back into the audit graph
//   - send sponsor names (sponsor-name-free rule)
//   - cite source-extracted-items in prose
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// -----------------------------------------------------------------------------
// CORS + constants
// -----------------------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RATE_LIMIT_WINDOW_MS  = 60_000;
const RATE_LIMIT_MAX        = 30;        // chat is lighter than narrative-gen
// Body-size math: MAX_MESSAGES (24) × MAX_MESSAGE_CHARS (2000) ≈ 48KB worst
// case, comfortably under MAX_BODY_BYTES. Keeping the per-message ceiling
// at 2000 (down from a looser 4000) so that a fully-packed legitimate
// thread can never trip the 413 before per-message validation runs. Per-
// turn 2000 chars is generous for a freeform auditor question; long-form
// content belongs on the stage workspace, not in chat.
const MAX_BODY_BYTES        = 60_000;
const OPENAI_TIMEOUT_MS     = 30_000;
const MAX_MESSAGES          = 24;        // cap turns sent to OpenAI per request
const MAX_MESSAGE_CHARS     = 2_000;     // per-turn content cap — see math above
const MAX_OBSERVATION_CHARS = 800;       // truncate per-entry observation_text in context
const MAX_ENTRIES_IN_CTX    = 25;        // cap audit context size

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
    level, event, timestamp: new Date().toISOString(), ...fields,
  }));
}

// -----------------------------------------------------------------------------
// System prompt — advisory framing. Three jobs:
//   1. Be useful for "what does this audit say about X" / "what did I miss"
//   2. Refuse to invent claims the context doesn't support
//   3. Make it obvious the auditor is the decision-maker, not the model
//
// Sponsor-name-free per project rule.
// -----------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an assistant helping a clinical-trial vendor auditor reason about a single in-progress audit.

Your job:
- Answer the auditor's questions about the audit context they share with you.
- Help them spot gaps, contradictions, or weak evidence in their own workspace.
- Suggest plausible next steps when asked, framed as options rather than directives.

Hard rules:
- The auditor is the decision-maker. You are advisory; never tell them what they "must" do.
- Do NOT invent findings, observations, classifications, scores, or remediation commitments that are not present in the provided context.
- Do NOT cite by internal ID; paraphrase from observation text instead.
- Sponsor names must NOT appear in your replies (the audit artifacts are sponsor-name-free; sponsor branding is added externally on export).
- If the context is too sparse to answer a question, say so plainly and suggest what would be needed.
- Keep replies tight — most answers fit in 3-6 sentences. Use a short bulleted list only when the auditor explicitly asks to enumerate.

Tone:
- Calm, professional, evidence-based.
- No marketing language. No filler. No "Great question!" openers.`;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type ChatRole = "user" | "assistant";
interface ClientChatMessage { role: ChatRole; content: string }

interface WorkspaceEntryContext {
  vendor_domain:               string;
  provisional_classification:  string;
  provisional_impact:          string;
  observation_text:            string;
  has_source_link:             boolean;
}

interface AuditChatContext {
  vendor_name:                 string | null;
  protocol_title:              string | null;
  audit_type:                  string | null;
  current_stage:               string | null;
  risk_summary_narrative:      string | null;
  risk_tier:                   string | null;
  risk_score:                  number | null;
  focus_areas:                 string[];
  report_executive_summary:    string | null;
  report_conclusions:          string | null;
  entries:                     WorkspaceEntryContext[];
  counts: {
    finding:                     number;
    observation:                 number;
    opportunity_for_improvement: number;
    not_yet_classified:          number;
  };
}

// -----------------------------------------------------------------------------
// Context builder — one prepended system-side message that primes the model
// with the audit state. Kept separate from the user-supplied conversation
// turns so the auditor's thread reads naturally.
// -----------------------------------------------------------------------------

function buildContextMessage(ctx: AuditChatContext): string {
  const lines: string[] = [];
  lines.push("AUDIT CONTEXT (read-only, do not echo back verbatim unless asked):");
  lines.push("");
  lines.push(`Vendor: ${ctx.vendor_name ?? "(unspecified)"}`);
  lines.push(`Protocol: ${ctx.protocol_title ?? "(unspecified)"}`);
  if (ctx.audit_type)     lines.push(`Audit type: ${ctx.audit_type}`);
  if (ctx.current_stage)  lines.push(`Current stage: ${ctx.current_stage}`);
  lines.push("");

  lines.push("Risk summary (Stage 4):");
  lines.push(ctx.risk_summary_narrative?.trim() || "(not yet drafted or not approved)");
  if (ctx.risk_tier || ctx.risk_score != null) {
    lines.push(`Risk posture: tier=${ctx.risk_tier ?? "?"}; score=${ctx.risk_score ?? "?"}`);
  }
  if (ctx.focus_areas.length > 0) {
    lines.push(`Focus areas: ${ctx.focus_areas.join("; ")}`);
  }
  lines.push("");

  lines.push("Workspace entry counts (Stage 6):");
  lines.push(`- Findings: ${ctx.counts.finding}`);
  lines.push(`- Observations: ${ctx.counts.observation}`);
  lines.push(`- Opportunities for improvement: ${ctx.counts.opportunity_for_improvement}`);
  lines.push(`- Not yet classified: ${ctx.counts.not_yet_classified}`);
  lines.push("");

  if (ctx.entries.length > 0) {
    lines.push(`Workspace entries (up to ${MAX_ENTRIES_IN_CTX}, observation text truncated):`);
    for (const e of ctx.entries) {
      lines.push(`- [${e.provisional_classification} · impact=${e.provisional_impact} · domain=${e.vendor_domain}${e.has_source_link ? " · source-linked" : ""}] ${e.observation_text}`);
    }
    lines.push("");
  }

  if (ctx.report_executive_summary || ctx.report_conclusions) {
    lines.push("Report draft (Stage 7), if present:");
    if (ctx.report_executive_summary) {
      lines.push("Executive summary:");
      lines.push(ctx.report_executive_summary.trim());
    }
    if (ctx.report_conclusions) {
      lines.push("Conclusions:");
      lines.push(ctx.report_conclusions.trim());
    }
    lines.push("");
  }

  lines.push("End of audit context.");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: jsonHeaders });
  }

  const ip = getClientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    log("warn", "audit_mode_chat.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: unknown; messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: jsonHeaders });
  }

  const auditId = body.audit_id;
  if (typeof auditId !== "string" || auditId.length === 0) {
    return new Response(JSON.stringify({ error: "audit_id is required" }),
      { status: 400, headers: jsonHeaders });
  }

  // ---- Strict message-shape validation ----
  // We accept only { role: 'user' | 'assistant', content: string }. Reject
  // 'system' from the client — the system prompt is owned by this function.
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages array is required and non-empty" }),
      { status: 400, headers: jsonHeaders });
  }
  if (body.messages.length > MAX_MESSAGES) {
    return new Response(JSON.stringify({ error: `messages exceeds ${MAX_MESSAGES} turns` }),
      { status: 400, headers: jsonHeaders });
  }
  const messages: ClientChatMessage[] = [];
  for (const raw of body.messages) {
    if (!raw || typeof raw !== "object") {
      return new Response(JSON.stringify({ error: "Each message must be an object" }),
        { status: 400, headers: jsonHeaders });
    }
    const m = raw as { role?: unknown; content?: unknown };
    if (m.role !== "user" && m.role !== "assistant") {
      return new Response(JSON.stringify({ error: "Message role must be 'user' or 'assistant'" }),
        { status: 400, headers: jsonHeaders });
    }
    if (typeof m.content !== "string" || m.content.trim().length === 0) {
      return new Response(JSON.stringify({ error: "Message content must be a non-empty string" }),
        { status: 400, headers: jsonHeaders });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return new Response(JSON.stringify({ error: `Message exceeds ${MAX_MESSAGE_CHARS} chars` }),
        { status: 400, headers: jsonHeaders });
    }
    messages.push({ role: m.role, content: m.content });
  }
  // Last message must be from the user — otherwise the model has nothing to
  // respond to (and the caller is probably mis-using the API).
  if (messages[messages.length - 1].role !== "user") {
    return new Response(JSON.stringify({ error: "Last message must be from the user" }),
      { status: 400, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    log("error", "audit_mode_chat.missing_supabase_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }
  if (!openaiKey) {
    log("error", "audit_mode_chat.missing_openai_key", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }

  // Authenticate the caller — pass through the user's JWT so all subsequent
  // reads are RLS-scoped to their access. Never read with service-role here.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Not authenticated" }),
      { status: 401, headers: jsonHeaders });
  }
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Fetch context. All reads are RLS-gated to the lead_auditor_id of the audit.
  // Sponsor names are NEVER selected.
  // ---------------------------------------------------------------------------
  const { data: audit, error: auditErr } = await supabase
    .from("audits")
    .select(`
      id, audit_type, current_stage, vendor_id, protocol_id,
      vendor:vendors(name),
      protocol:protocols(title)
    `)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "audit_mode_chat.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }

  const vendor = audit.vendor as { name?: string } | { name?: string }[] | null;
  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const vendorName = (Array.isArray(vendor) ? vendor[0]?.name : vendor?.name) ?? null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  // Risk summary — only inject if approved. Pre-approval drafts may be
  // contradictory or stale; we don't want the chat to anchor on them.
  const { data: riskSummary } = await supabase
    .from("vendor_risk_summary_objects")
    .select("executive_summary_text, composite_score, tier, focus_areas, approval_status")
    .eq("audit_id", auditId)
    .maybeSingle();

  const riskApproved = riskSummary?.approval_status === "APPROVED";

  const { data: entries } = await supabase
    .from("audit_workspace_entry_objects")
    .select("vendor_domain, provisional_classification, provisional_impact, observation_text, source_extracted_item_id")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: true })
    .limit(MAX_ENTRIES_IN_CTX);

  const rows = entries ?? [];

  const { data: reportDraft } = await supabase
    .from("report_draft_objects")
    .select("executive_summary, conclusions")
    .eq("audit_id", auditId)
    .maybeSingle();

  // ---------------------------------------------------------------------------
  // Build context. Safe logging: counts + lengths only.
  // ---------------------------------------------------------------------------
  const counts = {
    finding: 0,
    observation: 0,
    opportunity_for_improvement: 0,
    not_yet_classified: 0,
  };
  const entriesCtx: WorkspaceEntryContext[] = rows.map((r) => {
    switch (r.provisional_classification) {
      case "FINDING": counts.finding++; break;
      case "OBSERVATION": counts.observation++; break;
      case "OPPORTUNITY_FOR_IMPROVEMENT": counts.opportunity_for_improvement++; break;
      case "NOT_YET_CLASSIFIED": counts.not_yet_classified++; break;
    }
    return {
      vendor_domain:              r.vendor_domain,
      provisional_classification: r.provisional_classification,
      provisional_impact:         r.provisional_impact,
      observation_text:           String(r.observation_text ?? "").slice(0, MAX_OBSERVATION_CHARS),
      has_source_link:            !!r.source_extracted_item_id,
    };
  });

  const ctx: AuditChatContext = {
    vendor_name:             vendorName,
    protocol_title:          protocolTitle,
    audit_type:              (audit.audit_type as string | null) ?? null,
    current_stage:           (audit.current_stage as string | null) ?? null,
    risk_summary_narrative:  riskApproved ? ((riskSummary?.executive_summary_text as string | null) ?? null) : null,
    risk_tier:               riskApproved ? ((riskSummary?.tier as string | null) ?? null) : null,
    risk_score:              riskApproved ? ((riskSummary?.composite_score as number | null) ?? null) : null,
    focus_areas:             riskApproved ? ((riskSummary?.focus_areas as string[] | null) ?? []) : [],
    report_executive_summary: (reportDraft?.executive_summary as string | null) ?? null,
    report_conclusions:       (reportDraft?.conclusions as string | null) ?? null,
    entries:                 entriesCtx,
    counts,
  };

  log("info", "audit_mode_chat.request", {
    request_id: requestId,
    audit_id: auditId,
    turns: messages.length,
    last_user_chars: messages[messages.length - 1].content.length,
    entry_count: rows.length,
    counts,
    risk_approved: riskApproved,
    has_report_draft: !!reportDraft,
  });

  // ---------------------------------------------------------------------------
  // OpenAI call. Order:
  //   1. system  — assistant framing + hard rules
  //   2. system  — current audit context (read-only injection)
  //   3. ...user/assistant turns as supplied by the client
  // The context is a second system message rather than a user turn so the
  // model treats it as authoritative scope, not a question to answer.
  // ---------------------------------------------------------------------------
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  req.signal.addEventListener("abort", () => controller.abort());

  let openaiRes: Response;
  try {
    openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.3,
        max_tokens: 600,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "system", content: buildContextMessage(ctx) },
          ...messages,
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "audit_mode_chat.openai.fetch_failed", {
      request_id: requestId, aborted, error: String(err),
    });
    return new Response(
      JSON.stringify({ error: aborted ? "Request timed out" : "AI service error" }),
      { status: aborted ? 504 : 502, headers: jsonHeaders },
    );
  }
  clearTimeout(timeoutId);

  if (!openaiRes.ok) {
    const errText = await openaiRes.text();
    log("error", "audit_mode_chat.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const reply = payload?.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || reply.trim().length === 0) {
    log("error", "audit_mode_chat.openai.empty_response", { request_id: requestId });
    return new Response(JSON.stringify({ error: "AI service returned empty reply" }),
      { status: 502, headers: jsonHeaders });
  }

  log("info", "audit_mode_chat.response", {
    request_id: requestId,
    audit_id: auditId,
    reply_chars: reply.length,
  });

  return new Response(JSON.stringify({ reply: reply.trim() }),
    { status: 200, headers: jsonHeaders });
});
