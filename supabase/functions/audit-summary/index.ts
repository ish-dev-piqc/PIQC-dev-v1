// =============================================================================
// audit-summary edge function — LLM-drafted executive summary for Stage 7.
//
// Takes { audit_id }, fetches Stage 4 (approved risk summary) + Stage 6
// (workspace entries) server-side under the caller's JWT (RLS-gated), builds
// a prompt, calls OpenAI gpt-4o-mini, and returns the narrative string.
//
// Mirrors the pattern from /functions/chat/ and /functions/dashboard-chat/:
//   - OPENAI_API_KEY from Deno env
//   - rate limit by IP (60-second window)
//   - body-size and content guards
//   - safe logging (counts only — never observation_text bodies)
//   - 30s timeout, AbortController on client disconnect
//
// What this function does NOT do:
//   - write to the database. Caller (audit_mode_upsert_report_draft) does that.
//   - finalize the report. Auditor still reviews, edits, and approves.
//   - cite source-extracted-items in prose. Sent as hints; in-prose citation
//     is Phase 2.
//   - send sponsor names. Existing project rule — sponsor-name-free.
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

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX       = 10;        // exec-summary generation is heavier than chat
const MAX_BODY_BYTES       = 10_000;
const OPENAI_TIMEOUT_MS    = 45_000;    // narrative gen takes longer than chat reply
const MAX_OBSERVATION_CHARS = 1_200;    // truncate per-entry observation_text in prompt
const MAX_ENTRIES_IN_PROMPT = 40;       // cap context size for cost + latency

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
// Prompt construction
//
// Sponsor-name-free per project rule. Observation_text is included but
// truncated to MAX_OBSERVATION_CHARS to keep token cost predictable. The LLM
// is instructed to synthesize a narrative — NOT to invent findings the
// observations don't support.
// -----------------------------------------------------------------------------

const EXEC_SUMMARY_PROMPT = `You are drafting the executive summary section of a vendor audit report.

Voice and structure:
- Calm, professional, evidence-based. No marketing language.
- Plain prose. No headers, no bullet points, no markdown.
- 150–250 words.
- End with a one-sentence trust-posture statement.

Hard rules:
- Sponsor names must NOT appear in the output (the audit report adds sponsor branding externally on export).
- Do NOT invent findings, observations, or claims that are not supported by the provided workspace entries.
- Do NOT cite by ID; if you reference a finding, paraphrase from the observation text.
- The output is an auditor's draft. Write as if the auditor will review and edit before approval.

If the provided context is sparse (few entries, no findings classified), say so plainly — do not pad the summary with generic phrasing.`;

// The conclusions section answers "should this vendor continue, and what
// happens next?" — shorter than the exec summary, action-oriented, narrowly
// scoped to recommendation + follow-up. Same evidence-rooted discipline.
const CONCLUSIONS_PROMPT = `You are drafting the conclusions section of a vendor audit report.

Voice and structure:
- Calm, professional, evidence-based. No marketing language.
- Plain prose. No headers, no bullet points, no markdown.
- 80–150 words. Shorter than the executive summary.
- Open with a recommendation on whether the vendor should continue providing the audited service (suitable / suitable-with-conditions / not suitable), grounded in the observed findings.
- Reference any remediation commitments by paraphrasing the observation text — do not invent commitments.
- Close with a single sentence on follow-up: whether a re-audit is required and how findings will be tracked through CAPA or equivalent.

Hard rules:
- Sponsor names must NOT appear in the output.
- Do NOT invent remediation timelines, CAPA promises, or follow-up audits that are not supported by the workspace entries.
- Do NOT cite by ID.
- The output is an auditor's draft. Write as if the auditor will review and edit before approval.

If the provided context is sparse, recommend "suitable pending further review" plainly — do not pad with generic phrasing.`;

interface WorkspaceEntryContext {
  vendor_domain:               string;
  provisional_classification:  string;
  provisional_impact:          string;
  observation_text:            string;
  has_source_link:             boolean;
}

interface PromptContext {
  vendor_name:                 string | null;
  protocol_title:              string | null;
  audit_type:                  string | null;
  risk_summary_narrative:      string | null;
  risk_tier:                   string | null;
  risk_score:                  number | null;
  focus_areas:                 string[];
  entries:                     WorkspaceEntryContext[];
  counts: {
    finding:                     number;
    observation:                 number;
    opportunity_for_improvement: number;
    not_yet_classified:          number;
  };
}

function buildUserMessage(ctx: PromptContext): string {
  const lines: string[] = [];
  lines.push(`Vendor: ${ctx.vendor_name ?? '(unspecified)'}`);
  lines.push(`Protocol: ${ctx.protocol_title ?? '(unspecified)'}`);
  if (ctx.audit_type) lines.push(`Audit type: ${ctx.audit_type}`);
  lines.push('');

  lines.push('Approved risk summary:');
  lines.push(ctx.risk_summary_narrative?.trim() || '(no narrative provided)');
  if (ctx.risk_tier || ctx.risk_score != null) {
    lines.push(`Risk posture: tier=${ctx.risk_tier ?? '?'}; score=${ctx.risk_score ?? '?'}`);
  }
  if (ctx.focus_areas.length > 0) {
    lines.push(`Focus areas: ${ctx.focus_areas.join('; ')}`);
  }
  lines.push('');

  lines.push('Counts across workspace entries:');
  lines.push(`- Findings: ${ctx.counts.finding}`);
  lines.push(`- Observations: ${ctx.counts.observation}`);
  lines.push(`- Opportunities for improvement: ${ctx.counts.opportunity_for_improvement}`);
  lines.push(`- Not yet classified: ${ctx.counts.not_yet_classified}`);
  lines.push('');

  lines.push(`Workspace entries (up to ${MAX_ENTRIES_IN_PROMPT}, observation text truncated):`);
  for (const e of ctx.entries) {
    lines.push(`- [${e.provisional_classification} · impact=${e.provisional_impact} · domain=${e.vendor_domain}${e.has_source_link ? ' · source-linked' : ''}] ${e.observation_text}`);
  }
  lines.push('');

  lines.push('Draft the executive summary as plain prose now.');
  return lines.join('\n');
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
    log("warn", "audit_summary.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: string; section?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: jsonHeaders });
  }
  const auditId = body.audit_id;
  if (!auditId || typeof auditId !== "string") {
    return new Response(JSON.stringify({ error: "audit_id is required" }),
      { status: 400, headers: jsonHeaders });
  }
  // Section discriminator. Defaults to 'executive_summary' so existing clients
  // (PR #69) keep working unchanged. New 'conclusions' callsite added in this
  // PR. The two sections share context-fetch and OpenAI plumbing — only the
  // system prompt + max_tokens differ.
  const section: "executive_summary" | "conclusions" =
    body.section === "conclusions" ? "conclusions" : "executive_summary";

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    log("error", "audit_summary.missing_supabase_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }
  if (!openaiKey) {
    log("error", "audit_summary.missing_openai_key", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }

  // Authenticate the caller — pass through the user's JWT so all subsequent
  // reads are RLS-scoped to their access. The edge function never reads with
  // service-role credentials.
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
  // Fetch context. All four reads are RLS-gated to the lead_auditor_id of the
  // audit; mismatched callers get empty rows and we 404.
  // ---------------------------------------------------------------------------

  // Joined select via PostgREST embeds. audits doesn't carry vendor_name or
  // protocol_title directly — they're foreign-key joins on vendors.name and
  // protocols.title. Sponsor name (protocols.sponsor) is intentionally NOT
  // selected — sponsor-name-free rule.
  const { data: audit, error: auditErr } = await supabase
    .from("audits")
    .select(`
      id, audit_type, vendor_id, protocol_id, protocol_version_id,
      vendor:vendors(name),
      protocol:protocols(title)
    `)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "audit_summary.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }

  // PostgREST returns embedded resources as objects (or arrays when ambiguous).
  // Cast carefully — `vendor` may be `{ name } | null` or an array depending
  // on join cardinality. Both `vendor_id` and `protocol_id` are NOT NULL, so
  // the row exists; only the column may be missing.
  const vendor = audit.vendor as { name?: string } | { name?: string }[] | null;
  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const vendorName = (Array.isArray(vendor) ? vendor[0]?.name : vendor?.name) ?? null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  const { data: riskSummary } = await supabase
    .from("vendor_risk_summary_objects")
    .select("id, executive_summary_text, composite_score, tier, focus_areas, approval_status")
    .eq("audit_id", auditId)
    .maybeSingle();

  if (!riskSummary || riskSummary.approval_status !== "APPROVED") {
    return new Response(JSON.stringify({
      error: "Stage 4 risk summary must be approved before generating an LLM executive summary",
    }), { status: 409, headers: jsonHeaders });
  }

  const { data: entries } = await supabase
    .from("audit_workspace_entry_objects")
    .select("vendor_domain, provisional_classification, provisional_impact, observation_text, source_extracted_item_id")
    .eq("audit_id", auditId)
    .order("created_at", { ascending: true })
    .limit(MAX_ENTRIES_IN_PROMPT);

  const rows = entries ?? [];

  // ---------------------------------------------------------------------------
  // Build prompt context. Safe logging: counts only.
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

  const ctx: PromptContext = {
    vendor_name:                vendorName,
    protocol_title:             protocolTitle,
    audit_type:                 (audit.audit_type as string | null) ?? null,
    risk_summary_narrative:     (riskSummary.executive_summary_text as string | null) ?? null,
    risk_tier:                  (riskSummary.tier as string | null) ?? null,
    risk_score:                 (riskSummary.composite_score as number | null) ?? null,
    focus_areas:                ((riskSummary.focus_areas as string[] | null) ?? []),
    entries:                    entriesCtx,
    counts,
  };

  log("info", "audit_summary.request", {
    request_id: requestId,
    audit_id: auditId,
    section,
    entry_count: rows.length,
    counts,
  });

  // ---------------------------------------------------------------------------
  // OpenAI call
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
        temperature: 0.4,
        // Conclusions are shorter (80-150 words); exec summary is 150-250.
        // Cap accordingly to keep cost predictable per section.
        max_tokens: section === "conclusions" ? 400 : 700,
        messages: [
          {
            role: "system",
            content: section === "conclusions" ? CONCLUSIONS_PROMPT : EXEC_SUMMARY_PROMPT,
          },
          { role: "user", content: buildUserMessage(ctx) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "audit_summary.openai.fetch_failed", {
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
    log("error", "audit_summary.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const narrative = payload?.choices?.[0]?.message?.content;
  if (typeof narrative !== "string" || narrative.trim().length === 0) {
    log("error", "audit_summary.openai.empty_response", { request_id: requestId });
    return new Response(JSON.stringify({ error: "AI service returned empty narrative" }),
      { status: 502, headers: jsonHeaders });
  }

  log("info", "audit_summary.response", {
    request_id: requestId,
    audit_id: auditId,
    section,
    narrative_length: narrative.length,
  });

  return new Response(JSON.stringify({ narrative: narrative.trim() }),
    { status: 200, headers: jsonHeaders });
});
