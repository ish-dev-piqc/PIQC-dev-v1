// =============================================================================
// audit-observation-draft edge function — PIQC drafts CANDIDATE observations
// for a vendor audit from the fieldwork notes pad + the filed evidence.
//
// Takes { audit_id }, fetches the live un-promoted non-positive notes and the
// evidence register server-side under the caller's JWT (RLS-gated), retrieves
// passages of the audit protocol (P-labels) and the filed evidence documents
// (E-labels) with the service role — only AFTER the JWT-scoped audit fetch
// has proven ownership — then asks OpenAI to propose candidate observations
// and applies the gates (gates.ts) before anything is returned:
//   Gate 1 cite-or-drop  — untraceable candidates are withheld, not rendered
//   Gate 3 protocol cite — a protocol_ref must name a passage sent AND quote
//                          it verbatim, or it is stripped
//   (no Gate 2 — no vendor closed-world citation map exists)
//
// Forked from isa-finding-draft (same JWT passthrough, rate limit, body
// guards, abort timeout, counts-only logging); evidence retrieval from
// audit-deliverable-draft.
//
// What this function does NOT do:
//   - write to the database. Candidates are proposals; the auditor accepts
//     each one explicitly via audit_mode_promote_workspace_candidate.
//   - grade. The response shape has no severity, impact, or classification
//     field — the auditor classifies at accept time (D4 doctrine).
//   - send sponsor/client/vendor personnel names. Context is note bodies,
//     protocol title, audit type, and passages of the auditor's own filed
//     documents — the same data class Sponsor Ask and the deliverable engine
//     already send.
//   - draft from positive notes or from already-promoted notes.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { gateCandidates } from "./gates.ts";
import {
  labelCandidates,
  MAX_QUOTE_CHARS,
  type ProtocolCandidate,
  type ProtocolChunkRow,
} from "../_shared/protocolCandidates.ts";
import { normalizeRegister } from "../_shared/evidenceRegister.ts";

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
const MAX_BODY_BYTES       = 20_000;
const OPENAI_TIMEOUT_MS    = 60_000;
const MAX_NOTE_CHARS       = 1_000;     // the pad tells the auditor this
const MAX_NOTES_IN_PROMPT  = 60;
const MAX_PASSAGE_CHARS    = 700;
const NOTES_PER_QUERY      = 8;         // retrieval groups, creation order
const MAX_QUERY_GROUPS     = 6;
const CANDIDATES_PER_GROUP = 4;
const EMBEDDING_MODEL      = "text-embedding-3-small";

// Evidence-only runs (no draftable notes) still need a retrieval query.
const GENERIC_DEFICIENCY_QUERY =
  "deviation non-compliance not documented not signed expired overdue missing incomplete uncontrolled out of specification unapproved";

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
// Prompt. No severity, no classification — the shape cannot carry them and
// the gates would not pass them through if it did.
// -----------------------------------------------------------------------------

const OBSERVATION_WRITER_PROMPT = `You draft CANDIDATE vendor-audit observations from an auditor's raw fieldwork notes and passages of the documents the auditor filed as evidence. Your output is a set of candidates the auditor accepts, edits, or rejects one by one — never a final record.

CLUSTERING — the core rule:
- One observation = one root cause. Group notes into the same observation ONLY if a single corrective action would address all of them. When unsure, keep them SEPARATE — under-merging is correctable in one gesture; over-merging hides distinct problems.

OBSERVATION STRUCTURE:
- "vendor_domain": a short noun phrase naming the area (e.g. "Validation", "Data integrity", "Training", "Change control", "Vendor oversight", "Quality system"). Reuse the same phrase for observations in the same area.
- "observation_text": the generalized deficiency stated once — requirement → observed condition → gap. Do not enumerate instances in it.
- "checkpoint_ref": the vendor SOP / document / section the notes or evidence name for this observation (e.g. "SOP-014 rev 3 §4.2"), or null. Never invent one.
- "evidence" carries the instances: each item restates ONE specific fact and cites where it came from — the exact note ids in "source_note_ids" and/or the evidence-passage labels (E1, E2, …) in "source_passages". An item with no citation is worthless. Never invent facts; never add specifics the sources do not contain.

REGISTER (vendor-audit report conventions):
- Passive, past-tense observational voice: "was not documented", "were not maintained". Never first person, never present tense.
- Do NOT rate, grade, classify, or assign impact or severity anywhere — not in the text, not as a field. The auditor classifies each accepted observation.
- Dates as DD MMM YYYY.

PROTOCOL CITATIONS (when PROTOCOL PASSAGES are provided):
- If a protocol passage states the requirement an observation breaches, cite it: set "protocol_ref" to {"passage":"<its label, e.g. P3>","quote":"<a verbatim contiguous excerpt, max ${MAX_QUOTE_CHARS} characters>"}. The quote must be copied EXACTLY. If no passage applies, set protocol_ref to null. At most one per observation.

HARD RULES:
- Sponsor, client, and vendor personnel names must NOT appear anywhere in your output.
- Do NOT invent observations, facts, or citations.
- If the sources are sparse or ambiguous, produce fewer, smaller candidates — do not pad. Positive or praise-only content is not an observation.

OUTPUT — a single JSON object, no markdown:
{"candidates":[{"vendor_domain":"...","observation_text":"...","checkpoint_ref":"... or null","evidence":[{"text":"...","source_note_ids":["<note id>"],"source_passages":["E1"]}],"protocol_ref":{"passage":"P1","quote":"..."} or null}]}`;

interface NoteContext {
  id: string;
  body: string;
}

function passageLine(c: ProtocolCandidate): string {
  const where = [
    c.section_heading ? `§ ${c.section_heading}` : null,
    c.page_start !== null
      ? `p. ${c.page_start}${c.page_end !== null && c.page_end !== c.page_start ? `–${c.page_end}` : ""}`
      : null,
  ].filter(Boolean).join(", ");
  return `[${c.label}]${where ? ` (${where})` : ""} ${c.content.slice(0, MAX_PASSAGE_CHARS)}`;
}

function buildUserMessage(
  notes: NoteContext[],
  protocolTitle: string | null,
  auditType: string | null,
  protocol: ProtocolCandidate[],
  evidence: ProtocolCandidate[],
  evidenceTitles: Map<string, string>,
): string {
  const lines: string[] = [];
  lines.push(`Protocol: ${protocolTitle ?? "(unspecified)"}`);
  if (auditType) lines.push(`Audit type: ${auditType}`);
  lines.push("");

  if (protocol.length > 0) {
    lines.push(`PROTOCOL PASSAGES (${protocol.length}; protocol_ref may cite these labels only):`);
    for (const c of protocol) lines.push(passageLine(c));
    lines.push("");
  }

  if (evidence.length > 0) {
    lines.push(`EVIDENCE PASSAGES (${evidence.length}; from the auditor's filed documents — source_passages may cite these labels only):`);
    for (const c of evidence) {
      const title = evidenceTitles.get(c.document_id);
      lines.push(`${title ? `(${title}) ` : ""}${passageLine(c)}`);
    }
    lines.push("");
  }

  if (notes.length > 0) {
    lines.push(`Fieldwork notes (${notes.length}; cite ids exactly as given):`);
    for (const n of notes) lines.push(`[${n.id}] ${n.body}`);
  } else {
    lines.push("Fieldwork notes: none yet — draft from the evidence passages only.");
  }
  lines.push("");
  lines.push("Propose candidate observations now. Output the JSON object only.");
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Retrieval — notes embedded in creation-order groups (vendor notes carry no
// domain to group by); one hybrid_search per group over protocol + evidence
// documents, partitioned by document id. Any failure degrades to "no
// passages" — drafting proceeds without the bridge, never 500s.
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

async function retrieveCandidates(
  serviceClient: ReturnType<typeof createClient>,
  openaiKey: string,
  protocolDocIds: string[],
  evidenceDocIds: string[],
  notes: NoteContext[],
  signal: AbortSignal,
  requestId: string,
): Promise<{ protocol: ProtocolCandidate[]; evidence: ProtocolCandidate[] }> {
  try {
    const queries: string[] = [];
    for (let i = 0; i < notes.length && queries.length < MAX_QUERY_GROUPS; i += NOTES_PER_QUERY) {
      queries.push(notes.slice(i, i + NOTES_PER_QUERY).map((n) => n.body).join("\n").slice(0, 4_000));
    }
    if (queries.length === 0) queries.push(GENERIC_DEFICIENCY_QUERY);
    const allDocIds = [...protocolDocIds, ...evidenceDocIds];

    const perGroup = await Promise.all(queries.map(async (queryText) => {
      const embedding = await embedText(openaiKey, queryText, signal);
      if (!embedding) return [] as ProtocolChunkRow[];
      const { data, error } = await serviceClient.rpc("hybrid_search", {
        query_embedding: embedding,
        query_text: queryText,
        match_count: CANDIDATES_PER_GROUP,
        filter_document_ids: allDocIds,
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

    const evidenceIdSet = new Set(evidenceDocIds);
    const flat = perGroup.flat();
    return {
      protocol: labelCandidates(flat.filter((r) => !evidenceIdSet.has(r.document_id)), "P"),
      evidence: labelCandidates(flat.filter((r) => evidenceIdSet.has(r.document_id)), "E"),
    };
  } catch (err) {
    log("warn", "audit_observation_draft.retrieval_failed", {
      request_id: requestId, error: String(err),
    });
    return { protocol: [], evidence: [] };
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
    log("warn", "audit_observation_draft.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: unknown };
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
    log("error", "audit_observation_draft.missing_env", { request_id: requestId });
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
  // Context — RLS-gated. Sponsor and vendor names are never selected.
  // ---------------------------------------------------------------------------

  const { data: audit, error: auditErr } = await supabase
    .from("audits")
    .select(`id, audit_type, workflow_type, protocol_id, protocol:protocols(title)`)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "audit_observation_draft.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }
  if (audit.workflow_type !== "VENDOR_AUDIT") {
    return new Response(JSON.stringify({ error: "Observation drafting is only available on vendor audits" }),
      { status: 409, headers: jsonHeaders });
  }

  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  // Live, un-promoted (either lane), non-positive notes only. Fails CLOSED:
  // an unreadable pad is not an empty pad (pre-apply of 20260908000000 the
  // backlink column is missing and this read errors — the honest answer is
  // "not yet", never "no notes").
  const { data: noteRows, error: notesErr } = await supabase
    .from("audit_note_objects")
    .select("id, body")
    .eq("audit_id", auditId)
    .is("deleted_at", null)
    .is("promoted_entry_id", null)
    .is("promoted_finding_id", null)
    .eq("is_positive", false)
    .order("created_at", { ascending: true })
    .limit(MAX_NOTES_IN_PROMPT);
  if (notesErr) {
    log("warn", "audit_observation_draft.notes_read_error", {
      request_id: requestId, error: String(notesErr.message),
    });
    return new Response(JSON.stringify({ error: "Fieldwork notes could not be read — try again" }),
      { status: 503, headers: jsonHeaders });
  }
  const notes: NoteContext[] = (noteRows ?? []).map((n) => ({
    id: n.id as string,
    body: String(n.body ?? "").slice(0, MAX_NOTE_CHARS),
  }));

  // Evidence register — same read and the same fail-closed stance as the
  // deliverable engine: drafting "from notes only" over a register read
  // error would silently under-ground every candidate.
  const { data: registerRows, error: registerErr } = await supabase
    .from("audit_source_documents")
    .select("document_id, source_type, include_in_generation, documents(title, status, content_hash, kind)")
    .eq("audit_id", auditId)
    .order("added_at", { ascending: false });
  if (registerErr) {
    log("warn", "audit_observation_draft.register_read_error", {
      request_id: requestId, error: String(registerErr.message),
    });
    return new Response(JSON.stringify({ error: "Evidence register could not be read — try again" }),
      { status: 503, headers: jsonHeaders });
  }
  const evidenceDocs = normalizeRegister(registerRows).filter((d) => d.included && d.status === "ready");

  if (notes.length === 0 && evidenceDocs.length === 0) {
    return new Response(JSON.stringify({
      error: "Nothing to draft from — add fieldwork notes or file evidence documents first",
    }), { status: 409, headers: jsonHeaders });
  }

  log("info", "audit_observation_draft.request", {
    request_id: requestId,
    audit_id: auditId,
    note_count: notes.length,
    evidence_doc_count: evidenceDocs.length,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  req.signal.addEventListener("abort", () => controller.abort());

  // ---------------------------------------------------------------------------
  // Retrieval — service role, ONLY after the JWT audit fetch proved ownership.
  // ---------------------------------------------------------------------------

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let protocolSource: "ready" | "unavailable" = "unavailable";
  let candidates: { protocol: ProtocolCandidate[]; evidence: ProtocolCandidate[] } =
    { protocol: [], evidence: [] };

  if (serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
    let protocolDocIds: string[] = [];
    if (audit.protocol_id) {
      const { data: docRows } = await serviceClient
        .from("documents")
        .select("id")
        .eq("protocol_id", audit.protocol_id as string)
        .eq("status", "ready");
      protocolDocIds = (docRows ?? []).map((d) => String(d.id));
      if (protocolDocIds.length > 0) protocolSource = "ready";
    }
    const evidenceDocIds = evidenceDocs.map((d) => d.document_id);
    if (protocolDocIds.length > 0 || evidenceDocIds.length > 0) {
      candidates = await retrieveCandidates(
        serviceClient, openaiKey, protocolDocIds, evidenceDocIds, notes, controller.signal, requestId,
      );
    }
  }

  log("info", "audit_observation_draft.passages", {
    request_id: requestId,
    audit_id: auditId,
    protocol_source: protocolSource,
    protocol_candidate_count: candidates.protocol.length,
    evidence_candidate_count: candidates.evidence.length,
  });

  // ---------------------------------------------------------------------------
  // OpenAI call — JSON mode, low temperature for structured clustering.
  // ---------------------------------------------------------------------------

  const evidenceTitles = new Map(evidenceDocs.map((d) => [d.document_id, d.title]));
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
          { role: "system", content: OBSERVATION_WRITER_PROMPT },
          {
            role: "user",
            content: buildUserMessage(
              notes, protocolTitle, (audit.audit_type as string | null) ?? null,
              candidates.protocol, candidates.evidence, evidenceTitles,
            ),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "audit_observation_draft.openai.fetch_failed", {
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
    log("error", "audit_observation_draft.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const content = payload?.choices?.[0]?.message?.content;
  let parsed: { candidates?: unknown };
  try {
    parsed = JSON.parse(typeof content === "string" ? content : "");
  } catch {
    log("error", "audit_observation_draft.openai.unparseable", { request_id: requestId });
    return new Response(JSON.stringify({ error: "AI service returned unparseable output" }),
      { status: 502, headers: jsonHeaders });
  }

  // ---------------------------------------------------------------------------
  // Gates. Counts only in logs — never candidate bodies.
  // ---------------------------------------------------------------------------

  const liveNoteIds = new Set(notes.map((n) => n.id));
  const { accepted, withheldCount, strippedProtocolRefCount } =
    gateCandidates(parsed.candidates, liveNoteIds, candidates.evidence, candidates.protocol);

  log("info", "audit_observation_draft.response", {
    request_id: requestId,
    audit_id: auditId,
    note_count: notes.length,
    evidence_doc_count: evidenceDocs.length,
    candidate_count: accepted.length,
    withheld_count: withheldCount,
    stripped_protocol_ref_count: strippedProtocolRefCount,
    protocol_source: protocolSource,
  });

  return new Response(JSON.stringify({
    candidates: accepted,
    withheld_count: withheldCount,
    stripped_protocol_ref_count: strippedProtocolRefCount,
    protocol_source: protocolSource,
    note_count: notes.length,
    evidence_doc_count: evidenceDocs.length,
  }), { status: 200, headers: jsonHeaders });
});
