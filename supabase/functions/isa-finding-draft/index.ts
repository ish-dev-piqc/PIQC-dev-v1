// =============================================================================
// isa-finding-draft edge function — PIQC drafts ISA findings from pad notes.
//
// Takes { audit_id, note_ids? }, fetches the live un-promoted pad notes
// server-side under the caller's JWT (RLS-gated), asks OpenAI to cluster them
// into draft findings (one finding = one root cause), then applies three
// server-side gates before anything is returned:
//   Gate 1 cite-or-drop      — untraceable drafts are withheld, not rendered
//   Gate 2 closed-world cite — references not in the curated E6(R3)/CFR map
//                              are stripped (see citationMap.ts)
//   Gate 3 protocol cite     — a protocol_ref must name a passage actually
//                              sent to the model AND quote it verbatim, or it
//                              is stripped (see protocolCandidates.ts). The
//                              closed world here is the site's own protocol.
//
// Protocol retrieval (S4): the audit's protocol shares a protocols row with
// SOTR's parsed documents (audits.protocol_id = documents.protocol_id).
// Chunk RLS is owner-only and the auditor is usually not the uploader, so
// candidate passages are fetched with the SERVICE ROLE — but only AFTER the
// JWT-scoped audit fetch has proven the caller owns the audit (the
// dashboard-chat precedent), and only from ready documents of that audit's
// protocol.
//
// Forked from /functions/audit-summary/ — same JWT passthrough, rate limit,
// body guards, abort timeout, counts-only logging.
//
// What this function does NOT do:
//   - write to the database. Drafts are proposals; the auditor accepts each
//     one explicitly via audit_mode_create_isa_finding (D-008).
//   - send sponsor/client names, site personnel names, or the PI's name.
//     Context is note bodies + domains, protocol title, audit type — plus,
//     since S4, passages of the uploaded protocol document itself: the same
//     data class the dashboard-chat (Sponsor Ask) function already sends.
//   - draft from positive notes (they feed the report's positive section,
//     not findings) or from already-promoted notes (no re-proposing).
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CITATION_MAP } from "./citationMap.ts";
import { gateDrafts } from "./gates.ts";
import {
  labelCandidates,
  MAX_QUOTE_CHARS,
  type ProtocolCandidate,
  type ProtocolChunkRow,
} from "../_shared/protocolCandidates.ts";

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
const RATE_LIMIT_MAX       = 6;         // batch drafting is the heaviest audit LLM call
const MAX_BODY_BYTES       = 20_000;
const OPENAI_TIMEOUT_MS    = 60_000;
const MAX_NOTE_CHARS       = 1_000;     // truncate per-note body in prompt
const MAX_NOTES_IN_PROMPT  = 60;
const MAX_PASSAGE_CHARS    = 700;       // truncate per-passage content in prompt
const MAX_DOMAIN_GROUPS    = 6;         // retrieval queries per request
const CANDIDATES_PER_GROUP = 4;
const EMBEDDING_MODEL      = "text-embedding-3-small";

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
//
// The writing contract here is the S0 extraction from standard ISA report
// templates + the Audit Observation Form (see plans/fable/
// isa-notes-finding-writer-fable-pass.md). The clustering criterion and the
// under-merge bias are deliberate: a fused finding hides inside smooth prose,
// while two findings that share a root cause are visible and merge in one
// gesture.
// -----------------------------------------------------------------------------

const FINDING_WRITER_PROMPT = `You draft investigator-site audit findings from an auditor's raw fieldwork notes. Your output is a DRAFT the auditor reviews line-by-line against their own notes — never a final record.

CLUSTERING — the core rule:
- One finding = one root cause. Group notes into the same finding ONLY if a single root-cause response would address all of them. Three missing signatures on one delegation log are ONE finding with three evidence items. A missing signature plus an expired training certificate are TWO findings, even though both are "documentation".
- When unsure whether two deficiencies share a root cause, keep them SEPARATE. Under-merging is correctable in one gesture; over-merging hides distinct problems.

FINDING STRUCTURE:
- "observation" is the GENERALIZED deficiency statement — what requirement was not met, stated once. Do not enumerate instances in it.
- "evidence" carries the instances: each item restates ONE specific fact from the notes (subject numbers, documents, dates) and cites the exact note ids it came from in "source_note_ids". Never invent facts not present in the notes. Never add specifics the notes do not contain.
- "title" is a short noun phrase naming the deficiency.

SEVERITY — apply these decision rules and name the one that fired in "severity_rule":
- CRITICAL: adversely affects the rights, safety or well-being of participants and/or the integrity of trial data; direct non-compliance; possible serious breach requiring immediate escalation.
- MAJOR: might adversely affect participant rights/safety/well-being or data integrity; a compliance deficiency that creates regulatory liability if uncorrected.
- MINOR: would not be expected to adversely affect participants or data integrity; indicates a need for improvement.
- RECOMMENDATION: no response required; an opportunity to improve.
- Escalation rules: an accumulation of minors in one area suggests a systemic failure and may warrant MAJOR; an accumulation of majors may warrant CRITICAL. If an escalation rule drives your rating, say so in severity_rule.

REGISTER (site-audit report conventions):
- Passive, past-tense observational voice: "was not documented", "were not maintained". Never first person, never present tense.
- The prose hedging MUST match the severity: CRITICAL states impact plainly ("adversely affects"), MAJOR hedges once ("might adversely affect"), MINOR uses "would not be expected to adversely affect". A minor written in critical register reads as a misclassification.
- Structure each observation as: requirement → observed condition → gap. Evidence carries the instances.
- Dates as DD MMM YYYY.

CITATIONS:
- Set "reference" ONLY to one exact string from the ALLOWED CITATIONS list for the finding's domain. Copy it verbatim. If none fits, set reference to null. NEVER compose your own citation.

PROTOCOL CITATIONS (when PROTOCOL PASSAGES are provided):
- The passages are excerpts of THIS study's own protocol. If one states the requirement a finding breaches, cite it: set "protocol_ref" to {"passage":"<its label, e.g. P3>","quote":"<a verbatim contiguous excerpt of that passage, max ${MAX_QUOTE_CHARS} characters>"}.
- The quote must be copied EXACTLY from the labeled passage — no paraphrase, no stitching, no quoting from memory. If no provided passage states the requirement, set protocol_ref to null. A missing protocol_ref is normal; a wrong one is a serious error.
- At most one protocol_ref per finding.

HARD RULES:
- Sponsor, client, and site personnel names must NOT appear anywhere in your output.
- Do NOT invent findings, facts, or citations. Every evidence item must cite the note ids that support it.
- If the notes are sparse or ambiguous, produce fewer, smaller drafts — do not pad.
- Positive observations are not findings; ignore praise-only content.

OUTPUT — a single JSON object, no markdown:
{"drafts":[{"title":"...","isa_domain":"<one of the domain keys>","subcategory":"... or null","severity":"CRITICAL|MAJOR|MINOR|RECOMMENDATION","severity_rule":"which rule fired","observation":"...","evidence":[{"text":"...","source_note_ids":["<note id>"]}],"reference":"<exact allowed citation or null>","protocol_ref":{"passage":"P1","quote":"..."} or null}]}`;

interface NoteContext {
  id: string;
  isa_domain: string | null;
  body: string;
}

function buildUserMessage(
  notes: NoteContext[],
  protocolTitle: string | null,
  auditType: string | null,
  candidates: ProtocolCandidate[],
): string {
  const lines: string[] = [];
  lines.push(`Protocol: ${protocolTitle ?? "(unspecified)"}`);
  if (auditType) lines.push(`Audit type: ${auditType}`);
  lines.push("");

  lines.push("ALLOWED CITATIONS by domain (reference must be one of these, verbatim):");
  for (const [domain, cites] of Object.entries(CITATION_MAP)) {
    lines.push(`- ${domain}: ${cites.join(" | ")}`);
  }
  lines.push("");

  if (candidates.length > 0) {
    lines.push(`PROTOCOL PASSAGES (${candidates.length}; protocol_ref may cite these labels only):`);
    for (const c of candidates) {
      const where = [
        c.section_heading ? `§ ${c.section_heading}` : null,
        c.page_start !== null
          ? `p. ${c.page_start}${c.page_end !== null && c.page_end !== c.page_start ? `–${c.page_end}` : ""}`
          : null,
      ].filter(Boolean).join(", ");
      lines.push(`[${c.label}]${where ? ` (${where})` : ""} ${c.content.slice(0, MAX_PASSAGE_CHARS)}`);
    }
    lines.push("");
  }

  lines.push(`Fieldwork notes (${notes.length}; cite ids exactly as given):`);
  for (const n of notes) {
    const tag = n.isa_domain ? ` (auditor tagged: ${n.isa_domain})` : "";
    lines.push(`[${n.id}]${tag} ${n.body}`);
  }
  lines.push("");
  lines.push("Cluster these notes into draft findings now. Output the JSON object only.");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Protocol-passage retrieval (Gate 3's candidate set).
//
// Notes are grouped by auditor-tagged domain so a multi-domain visit doesn't
// dilute the query vector (consent notes swamping IP-accountability notes);
// each group embeds once and pulls its own top passages via hybrid_search,
// scoped to the audit protocol's ready documents. Any failure here degrades
// to "no candidates" — drafting proceeds without the bridge, never 500s.
// -----------------------------------------------------------------------------

async function embedText(
  openaiKey: string,
  text: string,
  signal: AbortSignal,
): Promise<number[] | null> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input: text.slice(0, 8_000), model: EMBEDDING_MODEL }),
    signal,
  });
  if (!res.ok) return null;
  const data = await res.json();
  const embedding = data?.data?.[0]?.embedding;
  return Array.isArray(embedding) ? (embedding as number[]) : null;
}

async function retrieveProtocolCandidates(
  serviceClient: ReturnType<typeof createClient>,
  openaiKey: string,
  docIds: string[],
  notes: NoteContext[],
  signal: AbortSignal,
  requestId: string,
): Promise<ProtocolCandidate[]> {
  try {
    const groups = new Map<string, string[]>();
    for (const n of notes) {
      const key = n.isa_domain ?? "GENERAL";
      const bodies = groups.get(key) ?? [];
      bodies.push(n.body);
      groups.set(key, bodies);
    }
    const ranked = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, MAX_DOMAIN_GROUPS);

    const perGroup = await Promise.all(ranked.map(async ([, bodies]) => {
      const queryText = bodies.join("\n").slice(0, 4_000);
      const embedding = await embedText(openaiKey, queryText, signal);
      if (!embedding) return [] as ProtocolChunkRow[];
      const { data, error } = await serviceClient.rpc("hybrid_search", {
        query_embedding: embedding,
        query_text: queryText,
        match_count: CANDIDATES_PER_GROUP,
        filter_document_ids: docIds,
      });
      if (error || !Array.isArray(data)) return [] as ProtocolChunkRow[];
      return (data as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        document_id: String(row.document_id),
        content: String(row.content ?? ""),
        section_heading: (row.section_heading as string | null) ?? null,
        page_start: typeof row.page_start === "number" ? row.page_start : null,
        page_end: typeof row.page_end === "number" ? row.page_end : null,
      }));
    }));

    return labelCandidates(perGroup.flat());
  } catch (err) {
    log("warn", "isa_finding_draft.protocol_retrieval_failed", {
      request_id: requestId, error: String(err),
    });
    return [];
  }
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
    log("warn", "isa_finding_draft.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: string; note_ids?: unknown };
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
  let noteIdFilter: string[] | null = null;
  if (body.note_ids !== undefined) {
    if (!Array.isArray(body.note_ids)
        || body.note_ids.some((id) => typeof id !== "string")) {
      return new Response(JSON.stringify({ error: "note_ids must be an array of ids" }),
        { status: 400, headers: jsonHeaders });
    }
    noteIdFilter = body.note_ids as string[];
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
    log("error", "isa_finding_draft.missing_env", { request_id: requestId });
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
    .select(`id, audit_type, workflow_type, protocol_id, protocol:protocols(title)`)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "isa_finding_draft.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }
  if (audit.workflow_type !== "INVESTIGATOR_SITE_AUDIT") {
    return new Response(JSON.stringify({ error: "Finding drafting is only available on investigator site audits" }),
      { status: 409, headers: jsonHeaders });
  }

  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  // Live, un-promoted, non-positive notes only. Positive notes feed the
  // report's positive-observations section, not findings. Promoted notes are
  // already covered by an accepted finding — re-runs propose only new ground.
  let notesQuery = supabase
    .from("audit_note_objects")
    .select("id, body, isa_domain, is_positive")
    .eq("audit_id", auditId)
    .is("deleted_at", null)
    .is("promoted_finding_id", null)
    .eq("is_positive", false)
    .order("created_at", { ascending: true })
    .limit(MAX_NOTES_IN_PROMPT);
  if (noteIdFilter && noteIdFilter.length > 0) {
    notesQuery = notesQuery.in("id", noteIdFilter);
  }
  const { data: noteRows } = await notesQuery;

  const notes: NoteContext[] = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    isa_domain: (n.isa_domain as string | null) ?? null,
    body: String(n.body ?? "").slice(0, MAX_NOTE_CHARS),
  }));

  if (notes.length === 0) {
    return new Response(JSON.stringify({
      error: "No draftable notes — every live note is already promoted, positive, or outside the selection",
    }), { status: 409, headers: jsonHeaders });
  }

  log("info", "isa_finding_draft.request", {
    request_id: requestId,
    audit_id: auditId,
    note_count: notes.length,
    filtered: noteIdFilter !== null,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  req.signal.addEventListener("abort", () => controller.abort());

  // ---------------------------------------------------------------------------
  // Protocol-passage retrieval — service role, but ONLY after the JWT-scoped
  // audit fetch above proved the caller owns this audit. Missing service key
  // or no ready parsed documents → the bridge is silently unavailable;
  // drafting itself is unaffected.
  // ---------------------------------------------------------------------------

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let candidates: ProtocolCandidate[] = [];
  let protocolSource: "ready" | "unavailable" = "unavailable";

  if (serviceRoleKey && audit.protocol_id) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    const { data: docRows } = await serviceClient
      .from("documents")
      .select("id")
      .eq("protocol_id", audit.protocol_id as string)
      .eq("status", "ready");
    const docIds = (docRows ?? []).map((d) => String(d.id));
    if (docIds.length > 0) {
      protocolSource = "ready";
      candidates = await retrieveProtocolCandidates(
        serviceClient, openaiKey, docIds, notes, controller.signal, requestId,
      );
    }
  }

  log("info", "isa_finding_draft.protocol_candidates", {
    request_id: requestId,
    audit_id: auditId,
    protocol_source: protocolSource,
    candidate_count: candidates.length,
  });

  // ---------------------------------------------------------------------------
  // OpenAI call — JSON mode, low temperature for structured clustering.
  // ---------------------------------------------------------------------------

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
        max_tokens: 4_000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: FINDING_WRITER_PROMPT },
          { role: "user", content: buildUserMessage(notes, protocolTitle, (audit.audit_type as string | null) ?? null, candidates) },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "isa_finding_draft.openai.fetch_failed", {
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
    log("error", "isa_finding_draft.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const content = payload?.choices?.[0]?.message?.content;
  let parsed: { drafts?: unknown };
  try {
    parsed = JSON.parse(typeof content === "string" ? content : "");
  } catch {
    log("error", "isa_finding_draft.openai.unparseable", { request_id: requestId });
    return new Response(JSON.stringify({ error: "AI service returned unparseable output" }),
      { status: 502, headers: jsonHeaders });
  }

  // ---------------------------------------------------------------------------
  // Gates. Counts only in logs — never draft bodies.
  // ---------------------------------------------------------------------------

  const liveNoteIds = new Set(notes.map((n) => n.id));
  const { accepted, withheldCount, strippedReferenceCount, strippedProtocolRefCount } =
    gateDrafts(parsed.drafts, liveNoteIds, candidates);

  log("info", "isa_finding_draft.response", {
    request_id: requestId,
    audit_id: auditId,
    note_count: notes.length,
    draft_count: accepted.length,
    withheld_count: withheldCount,
    stripped_reference_count: strippedReferenceCount,
    stripped_protocol_ref_count: strippedProtocolRefCount,
    protocol_source: protocolSource,
  });

  return new Response(JSON.stringify({
    drafts: accepted,
    withheld_count: withheldCount,
    stripped_reference_count: strippedReferenceCount,
    stripped_protocol_ref_count: strippedProtocolRefCount,
    protocol_source: protocolSource,
    note_count: notes.length,
  }), { status: 200, headers: jsonHeaders });
});
