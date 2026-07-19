// =============================================================================
// isa-report-draft edge function — PIQC drafts/refines ISA report narrative
// sections.
//
// Takes { audit_id, section }, where section is one of the four prose
// sections of isa_report_draft_objects. Two material classes:
//
//   exec_summary        — composed from ACCEPTED FINDINGS (titles, domains,
//                         severities, counts) + the set verdict + the
//                         response clause. Requires the site verdict: the
//                         verdict sentence is a beat of the summary, and
//                         refining around a placeholder writes around a hole
//                         (409 until set). Gated on VERBATIM anchors — the
//                         compliance statement, the verdict sentence, the
//                         response clause (sectionContract.ts). A draft that
//                         drops or rewrites a stock sentence is withheld.
//   the other three     — drafted from the PAD NOTES, the only place
//                         fieldwork facts live. Where the notes don't cover
//                         a beat the model writes "[not recorded in notes:
//                         …]" — the gap teaches the auditor what to fill.
//                         Notes are working papers: they feed these MEETING/
//                         BACKGROUND records, never observation content
//                         (findings own that, gated separately in S2).
//
// Returns a PROPOSAL only. Nothing persists until the auditor applies it via
// audit_mode_upsert_isa_report_draft with source='llm' (D-008); any later
// manual edit flips the section to auditor_edited.
//
// Forked from /functions/isa-finding-draft/ — same JWT passthrough, rate
// limit, body guards, abort timeout, counts-only logging. Same data stance:
// sponsor/client/personnel/PI names are never selected into the prompt, and
// the prompt requires role-nouns in output.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  buildResponseClause,
  COMPLIANCE_STATEMENT,
  gateSection,
  ISA_DOMAIN_LABELS,
  isSectionKey,
  MAX_SECTION_CHARS,
  SECTION_INSTRUCTIONS,
  VERDICT_SENTENCES,
  type SectionKey,
} from "./sectionContract.ts";

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
const RATE_LIMIT_MAX       = 6;
const MAX_BODY_BYTES       = 5_000;
const OPENAI_TIMEOUT_MS    = 60_000;
const MAX_NOTE_CHARS       = 1_000;
const MAX_NOTES_IN_PROMPT  = 60;

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
// Prompt
// -----------------------------------------------------------------------------

const SECTION_WRITER_PROMPT = `You draft narrative sections of an investigator-site audit report from the material provided. Your output is a DRAFT the auditor reviews and edits — never a final record.

REGISTER (site-audit report conventions):
- Passive, past-tense observational voice: "was conducted", "were reviewed". Never first person, never present tense.
- Dates as DD MMM YYYY.
- Flowing prose paragraphs — no headings, no bullet characters, no markdown.

HARD RULES:
- Draw ONLY on the material provided. Never invent facts, attendees, dates, history, or numbers.
- Where the material does not cover something the section normally records, write a bracketed gap instead: [not recorded in notes: attendees]. Gaps are expected and useful; invented facts are failures.
- Sponsor, client, and personnel names must NOT appear — use role nouns only: "the investigator", "the study coordinator", "the site team".
- Any sentence marked VERBATIM in the instructions must be copied into the draft exactly, character for character.

OUTPUT — a single JSON object, no markdown:
{"section_text":"..."}`;

interface NoteContext {
  id: string;
  isa_domain: string | null;
  is_positive: boolean;
  body: string;
}

interface FindingContext {
  title: string;
  isa_domain: string;
  subcategory: string | null;
  severity: string;
}

function buildUserMessage(
  section: SectionKey,
  material: {
    protocolTitle: string | null;
    auditType: string | null;
    findings: FindingContext[];
    notes: NoteContext[];
    anchors: { label: string; text: string }[];
  },
): string {
  const lines: string[] = [];
  lines.push(`Section to draft: ${section}`);
  lines.push(`Instructions: ${SECTION_INSTRUCTIONS[section]}`);
  lines.push(`Protocol: ${material.protocolTitle ?? "(unspecified)"}`);
  if (material.auditType) lines.push(`Audit type: ${material.auditType}`);
  lines.push(`Length limit: ${MAX_SECTION_CHARS[section]} characters.`);
  lines.push("");

  if (section === "exec_summary") {
    for (const a of material.anchors) {
      lines.push(`${a.label} (VERBATIM): ${a.text}`);
    }
    lines.push("");
    const counts = { CRITICAL: 0, MAJOR: 0, MINOR: 0, RECOMMENDATION: 0 } as Record<string, number>;
    for (const f of material.findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    lines.push(
      `Finding counts: ${counts.CRITICAL} critical, ${counts.MAJOR} major, ${counts.MINOR} minor, ${counts.RECOMMENDATION} recommendations.`,
    );
    lines.push(`Findings (${material.findings.length}):`);
    for (const f of material.findings) {
      const label = ISA_DOMAIN_LABELS[f.isa_domain] ?? f.isa_domain;
      lines.push(`- [${f.severity}] ${f.title} — ${label}${f.subcategory ? ` – ${f.subcategory}` : ""}`);
    }
  } else {
    lines.push(`Fieldwork notes (${material.notes.length}):`);
    for (const n of material.notes) {
      const tags = [
        n.isa_domain ? `tagged: ${ISA_DOMAIN_LABELS[n.isa_domain] ?? n.isa_domain}` : null,
        n.is_positive ? "positive observation" : null,
      ].filter(Boolean).join("; ");
      lines.push(`-${tags ? ` (${tags})` : ""} ${n.body}`);
    }
  }

  lines.push("");
  lines.push("Draft the section now. Output the JSON object only.");
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
    log("warn", "isa_report_draft.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: string; section?: unknown };
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
  if (!isSectionKey(body.section)) {
    return new Response(JSON.stringify({ error: "section must be one of the four report prose sections" }),
      { status: 400, headers: jsonHeaders });
  }
  const section = body.section;

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
    log("error", "isa_report_draft.missing_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }

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
  // Fetch context — RLS-gated. Sponsor name is intentionally never selected.
  // ---------------------------------------------------------------------------

  const { data: audit, error: auditErr } = await supabase
    .from("audits")
    .select(`id, audit_type, workflow_type, protocol:protocols(title)`)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "isa_report_draft.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }
  if (audit.workflow_type !== "INVESTIGATOR_SITE_AUDIT") {
    return new Response(JSON.stringify({ error: "Report drafting is only available on investigator site audits" }),
      { status: 409, headers: jsonHeaders });
  }

  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  const { data: draftRow } = await supabase
    .from("isa_report_draft_objects")
    .select("site_verdict, response_due_days, response_due_basis")
    .eq("audit_id", auditId)
    .maybeSingle();

  const anchors: { label: string; text: string }[] = [];
  let findings: FindingContext[] = [];
  let notes: NoteContext[] = [];

  if (section === "exec_summary") {
    // The verdict sentence is a beat of the summary; no verdict, no refine.
    const verdict = draftRow?.site_verdict as string | null | undefined;
    if (!verdict || !VERDICT_SENTENCES[verdict]) {
      return new Response(JSON.stringify({
        error: "Set the site-continuation verdict before refining the summary — it is one of its sentences",
      }), { status: 409, headers: jsonHeaders });
    }
    anchors.push(
      { label: "Compliance statement", text: COMPLIANCE_STATEMENT },
      { label: "Site-continuation sentence", text: VERDICT_SENTENCES[verdict] },
      {
        label: "Response clause",
        text: buildResponseClause(
          (draftRow?.response_due_days as number | undefined) ?? 30,
          ((draftRow?.response_due_basis as string | undefined) === "BUSINESS" ? "BUSINESS" : "CALENDAR"),
        ),
      },
    );

    const { data: findingRows } = await supabase
      .from("isa_finding_objects")
      .select("title, isa_domain, subcategory, severity")
      .eq("audit_id", auditId)
      .order("created_at", { ascending: true });
    findings = (findingRows ?? []) as FindingContext[];
  } else {
    const { data: noteRows } = await supabase
      .from("audit_note_objects")
      .select("id, body, isa_domain, is_positive")
      .eq("audit_id", auditId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(MAX_NOTES_IN_PROMPT);
    notes = ((noteRows ?? []) as Record<string, unknown>[]).map((n) => ({
      id: String(n.id),
      isa_domain: (n.isa_domain as string | null) ?? null,
      is_positive: Boolean(n.is_positive),
      body: String(n.body ?? "").slice(0, MAX_NOTE_CHARS),
    }));
    if (notes.length === 0) {
      return new Response(JSON.stringify({
        error: "No fieldwork notes to draft from — this section drafts from the pad",
      }), { status: 409, headers: jsonHeaders });
    }
  }

  log("info", "isa_report_draft.request", {
    request_id: requestId,
    audit_id: auditId,
    section,
    note_count: notes.length,
    finding_count: findings.length,
  });

  // ---------------------------------------------------------------------------
  // OpenAI call — JSON mode, low temperature.
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
        temperature: 0.2,
        max_tokens: 2_000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SECTION_WRITER_PROMPT },
          {
            role: "user",
            content: buildUserMessage(section, {
              protocolTitle,
              auditType: (audit.audit_type as string | null) ?? null,
              findings,
              notes,
              anchors,
            }),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "isa_report_draft.openai.fetch_failed", {
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
    log("error", "isa_report_draft.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const content = payload?.choices?.[0]?.message?.content;
  let parsed: { section_text?: unknown };
  try {
    parsed = JSON.parse(typeof content === "string" ? content : "");
  } catch {
    log("error", "isa_report_draft.openai.unparseable", { request_id: requestId });
    return new Response(JSON.stringify({ error: "AI service returned unparseable output" }),
      { status: 502, headers: jsonHeaders });
  }

  // ---------------------------------------------------------------------------
  // Gate. Counts only in logs — never section text.
  // ---------------------------------------------------------------------------

  const text = typeof parsed.section_text === "string" ? parsed.section_text.trim() : "";
  const gate = gateSection(section, text, anchors);

  log("info", "isa_report_draft.response", {
    request_id: requestId,
    audit_id: auditId,
    section,
    gate_ok: gate.ok,
    missing_anchor_count: gate.missing.length,
    text_length: text.length,
  });

  if (!gate.ok) {
    return new Response(JSON.stringify({
      error: `The draft was withheld — it dropped or rewrote: ${gate.missing.join(", ")}. Try again.`,
    }), { status: 422, headers: jsonHeaders });
  }

  return new Response(JSON.stringify({
    section,
    section_text: text,
    note_count: notes.length,
    finding_count: findings.length,
  }), { status: 200, headers: jsonHeaders });
});
