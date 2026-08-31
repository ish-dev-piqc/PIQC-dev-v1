// =============================================================================
// audit-deliverable-draft edge function — PIQC drafts a Stage-5 vendor-audit
// deliverable grounded in the protocol + the audit's evidence register (PR-C2).
//
// Consolidates the C1 checklist engine at the rule-of-three moment: takes
// { audit_id, deliverable: 'checklist' | 'agenda' | 'confirmation_letter' |
// 'internal_notification' (PR-D1) | 'evidence_gap_summary' (PR-D3) }, runs
// ONE engine (JWT ownership proof → service-role retrieval over protocol +
// register chunks → OpenAI → verbatim-quote ref gate), and shapes output per
// deliverable's `shape`. The gap summary additionally feeds the FULL register
// (withheld rows as titles-only), the risk summary's scope areas, and the
// checklist's expectations into its user message — see the gap-context block.
// Supersedes /audit-checklist-draft (deleted).
//
// Invariants (all deliverables):
//   - proposals only — this function never writes to the database. The client
//     applies via the audit_mode_apply_*_generation RPCs (content through the
//     existing upserts → demote latch intact; snapshot stamped atomically).
//   - refs must name a passage actually sent to the model AND quote it
//     verbatim (materializeRef) — invalid refs are STRIPPED, never repaired.
//     Uncited entries are allowed: the non-negotiable is no fabricated
//     provenance, not everything-cited.
//   - existing entries survive by identity: the model sees C-labels, never
//     real ids.
//   - the letter's recipients NEVER reach the model (personnel names); the
//     client merges current recipients into content at apply time.
//   - human-triggered only; no auto-regenerate.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  labelCandidates,
  materializeRef,
  type ProtocolCandidate,
  type ProtocolChunkRow,
} from "../_shared/protocolCandidates.ts";
import { AGENDA_PROMPT, CHECKLIST_PROMPT, EVIDENCE_GAP_SUMMARY_PROMPT, INTERNAL_NOTIFICATION_PROMPT, LETTER_PROMPT } from "./prompts.ts";

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
const MAX_BODY_BYTES       = 10_000;
const OPENAI_TIMEOUT_MS    = 60_000;
const MAX_PASSAGE_CHARS    = 700;
const CANDIDATES_PER_GROUP = 4;
const MAX_PROMPT_CHARS     = 500;   // per-entry text cap (item prompt / topic)
const MAX_BODY_TEXT_CHARS  = 6_000; // letter body cap
const MAX_REFS_PER_ENTRY   = 2;
const EMBEDDING_MODEL      = "text-embedding-3-small";
// Gap-summary context caps (PR-D3) — prompt-budget levers, kept here so the
// whole budget stays reviewable in one block. Withheld register rows are
// EXEMPT from the register cap (naming them is the deliverable's invariant);
// on-file rows past it are counted and disclosed to the model.
const GAP_MAX_REGISTER_DOCS = 120;
const GAP_MAX_SCOPE_AREAS   = 50;
const GAP_MAX_LINE_CHARS    = 200;  // per register-title / scope-area / checklist line

type DeliverableKind = "checklist" | "agenda" | "confirmation_letter" | "internal_notification" | "evidence_gap_summary";

// shape drives every structural branch: "items" kinds carry labeled entry
// lists (C-label revision mode, capped at maxItems); "letter" kinds carry a
// single body_text + scope blob (current-draft revision mode, empty-body 502
// guard). The discriminated union makes per-shape data compiler-forced: a new
// letter-shaped kind cannot be added without declaring its blob ref id and
// revision heading, and cannot carry a meaningless maxItems.
type DeliverableConfig = { table: string; systemPrompt: string } & (
  | { shape: "items"; maxItems: number }
  | {
      shape: "letter";
      // item_id stamped on the blob-level generation_refs rows (persisted
      // provenance — never change for an existing kind).
      blobRefId: string;
      // Heading for the current-draft block in revision mode; must mirror the
      // prompt's "REVISION MODE (when <X> is provided)" wording.
      revisionHeading: string;
      // Body cap override for kinds whose output scales with input (the gap
      // summary enumerates the register + checklist). Applies to BOTH the
      // output slice and the revise-mode echo of the current body — a lower
      // echo cap would silently truncate the auditor's own text on write-back.
      maxBodyChars?: number;
    }
);
const DELIVERABLES: Record<DeliverableKind, DeliverableConfig> = {
  checklist:             { table: "checklist_objects",             systemPrompt: CHECKLIST_PROMPT,             shape: "items", maxItems: 40 },
  agenda:                { table: "agenda_objects",                systemPrompt: AGENDA_PROMPT,                shape: "items", maxItems: 20 },
  confirmation_letter:   { table: "confirmation_letter_objects",   systemPrompt: LETTER_PROMPT,                shape: "letter", blobRefId: "letter",       revisionHeading: "CURRENT LETTER" },
  internal_notification: { table: "internal_notification_objects", systemPrompt: INTERNAL_NOTIFICATION_PROMPT, shape: "letter", blobRefId: "notification", revisionHeading: "CURRENT DRAFT"  },
  evidence_gap_summary:  { table: "evidence_gap_summary_objects",  systemPrompt: EVIDENCE_GAP_SUMMARY_PROMPT,  shape: "letter", blobRefId: "gap_summary",  revisionHeading: "CURRENT SUMMARY", maxBodyChars: 12_000 },
};

// Static retrieval lenses — the standard vendor-audit domains. Per-domain
// queries so one domain's passages don't swamp another's.
const QUERY_GROUPS: string[] = [
  "quality management system, standard operating procedures, document control, change control",
  "personnel qualifications, training records, delegation of responsibilities, organization chart",
  "data integrity, data management, audit trail, electronic records and signatures",
  "vendor oversight, subcontracting, third party agreements, communication with sponsor",
  "safety reporting, deviations, CAPA, incident and complaint handling",
  "study-specific procedures, protocol requirements, sample handling, monitoring visits",
];

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
// Existing-content extraction (C-labels)
// -----------------------------------------------------------------------------

interface ExistingEntry {
  id: string;
  label: string;
  text: string;                          // what the model sees for this entry
  raw: Record<string, unknown>;          // full original fields for kept-entry fallback
}

function extractExisting(kind: DeliverableKind, content: unknown): ExistingEntry[] {
  const c = (content ?? {}) as Record<string, unknown>;
  const config = DELIVERABLES[kind];
  if (config.shape === "letter") return []; // letter-shaped revision passes body/scope, not labeled entries
  const maxItems = config.maxItems;
  const rawItems = Array.isArray(c.items) ? c.items : [];
  return rawItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .filter((it) => typeof it.id === "string")
    .filter((it) => {
      const text = kind === "checklist" ? it.prompt : it.topic;
      return typeof text === "string" && text.trim().length > 0;
    })
    .slice(0, maxItems)
    .map((it, i) => ({
      id: it.id as string,
      label: `C${i + 1}`,
      text: String(kind === "checklist" ? it.prompt : it.topic).trim(),
      raw: it,
    }));
}

// -----------------------------------------------------------------------------
// User message
// -----------------------------------------------------------------------------

// Gap-summary-only context (PR-D3): the coverage basis the summary is written
// against. registerListing carries withheld rows as titles-only (their content
// never reaches retrieval or the prompt; naming them as withheld is the point
// of the deliverable), and withheld rows are never dropped by the cap.
interface GapSummaryContext {
  scopeAreas: string[];
  registerListing: { title: string; status: string; withheld: boolean }[];
  // On-file rows dropped by GAP_MAX_REGISTER_DOCS; disclosed in the header.
  truncatedCount: number;
  checklistItems: { prompt: string; evidence_expected: boolean }[];
  // Persisted into the gap kind's grounding snapshot so a kind-aware currency
  // check (client slice) can diff the axes this deliverable depends on.
  registerSnapshot: { document_id: string; title: string; status: string; included: boolean }[];
  checklistItemIds: string[];
}

function buildUserMessage(
  kind: DeliverableKind,
  protocolTitle: string | null,
  auditType: string | null,
  protocolCandidates: ProtocolCandidate[],
  evidenceCandidates: ProtocolCandidate[],
  docTitles: Map<string, string>,
  existing: ExistingEntry[],
  letterCurrent: { body_text: string; scope: string[] } | null,
  gapContext: GapSummaryContext | null,
): string {
  const lines: string[] = [];
  lines.push(`Protocol: ${protocolTitle ?? "(unspecified)"}`);
  if (auditType) lines.push(`Audit type: ${auditType}`);
  lines.push("");

  const renderPassage = (c: ProtocolCandidate) => {
    const where = [
      c.section_heading ? `§ ${c.section_heading}` : null,
      c.page_start !== null
        ? `p. ${c.page_start}${c.page_end !== null && c.page_end !== c.page_start ? `–${c.page_end}` : ""}`
        : null,
    ].filter(Boolean).join(", ");
    return `[${c.label}]${where ? ` (${where})` : ""} ${c.content.slice(0, MAX_PASSAGE_CHARS)}`;
  };

  if (protocolCandidates.length > 0) {
    lines.push(`PROTOCOL PASSAGES (${protocolCandidates.length}):`);
    for (const c of protocolCandidates) lines.push(renderPassage(c));
    lines.push("");
  }
  if (evidenceCandidates.length > 0) {
    lines.push(`EVIDENCE PASSAGES (${evidenceCandidates.length}; from the auditor's filed documents):`);
    for (const c of evidenceCandidates) {
      const title = docTitles.get(c.document_id);
      lines.push(`${renderPassage(c)}${title ? ` [from: ${title}]` : ""}`);
    }
    lines.push("");
  }
  if (gapContext) {
    if (gapContext.scopeAreas.length > 0) {
      lines.push("SCOPE AREAS (from the risk summary):");
      for (const a of gapContext.scopeAreas) lines.push(`- ${a}`);
      lines.push("");
    }
    const totalDocs = gapContext.registerListing.length + gapContext.truncatedCount;
    lines.push(gapContext.truncatedCount > 0
      ? `EVIDENCE REGISTER (${gapContext.registerListing.length} of ${totalDocs} documents shown; the coverage basis — state that ${gapContext.truncatedCount} more on-file documents exist but are not listed here):`
      : `EVIDENCE REGISTER (${gapContext.registerListing.length} documents; the coverage basis):`);
    if (gapContext.registerListing.length === 0) {
      lines.push("(no evidence documents filed yet)");
    }
    for (const entry of gapContext.registerListing) {
      lines.push(entry.withheld
        ? `- [WITHHELD from generation] ${entry.title}`
        : `- [on file, ${entry.status}] ${entry.title}`);
    }
    lines.push("");
    if (gapContext.checklistItems.length > 0) {
      lines.push(`CHECKLIST EXPECTATIONS (${gapContext.checklistItems.length} items):`);
      for (const it of gapContext.checklistItems) {
        lines.push(`- ${it.prompt}${it.evidence_expected ? " [evidence expected]" : ""}`);
      }
      lines.push("");
    }
  }
  if (existing.length > 0) {
    lines.push(`EXISTING ITEMS (${existing.length}; revision mode — reference by label):`);
    for (const e of existing) lines.push(`[${e.label}] ${e.text.slice(0, MAX_PROMPT_CHARS)}`);
    lines.push("");
  }
  const cfg = DELIVERABLES[kind];
  if (letterCurrent && cfg.shape === "letter") {
    lines.push(`${cfg.revisionHeading} (revision mode — preserve substance):`);
    lines.push(`body_text: ${letterCurrent.body_text.slice(0, cfg.maxBodyChars ?? MAX_BODY_TEXT_CHARS)}`);
    lines.push(`scope: ${letterCurrent.scope.join(" | ").slice(0, 2_000)}`);
    lines.push("");
  }
  lines.push(
    existing.length > 0 || letterCurrent
      ? "Revise against these passages now. Output the JSON object only."
      : "Draft it now. Output the JSON object only.",
  );
  return lines.join("\n");
}

// -----------------------------------------------------------------------------
// Gap-summary coverage basis (PR-D3) — JWT/RLS-gated, gap kind only. All
// reads mirror queries the client app already performs; no new privilege
// paths. Withheld rows contribute their register title ONLY — their document
// content stays out of retrieval and the prompt entirely. ABSENCE degrades
// (no risk summary → organize by register + checklist; no checklist →
// outstanding basis is scope areas vs register); read ERRORS are logged here,
// and the register read fails closed in the handler — an unreadable register
// is not an empty one.
// -----------------------------------------------------------------------------

// One normalized row per AUDIT_EVIDENCE register entry — the single place the
// evidence-kind predicate and PostgREST embed unwrap live.
interface RegisterDoc {
  document_id: string;
  source_type: string;
  title: string;
  status: string;
  content_hash: string | null;
  included: boolean;
}

function normalizeRegister(registerRows: unknown[] | null): RegisterDoc[] {
  return (registerRows ?? []).flatMap((r) => {
    const docRaw = (r as { documents: unknown }).documents;
    const doc = (Array.isArray(docRaw) ? docRaw[0] : docRaw) as
      | { title?: string; status?: string; content_hash?: string | null; kind?: string }
      | null;
    if (!doc || doc.kind !== "AUDIT_EVIDENCE") return [];
    return [{
      document_id: String((r as { document_id: unknown }).document_id),
      source_type: String((r as { source_type: unknown }).source_type),
      title: (doc.title ?? "").trim() || "(untitled)",
      status: doc.status ?? "unknown",
      content_hash: doc.content_hash ?? null,
      included: (r as { include_in_generation: boolean }).include_in_generation === true,
    }];
  });
}

// Titles, scope areas, and checklist lines are freetext interpolated into a
// line-oriented prompt block — collapse whitespace so a newline in a title
// cannot forge a register entry.
const cleanLine = (s: string) => s.replace(/\s+/g, " ").trim();

async function loadGapSummaryContext(
  supabase: ReturnType<typeof createClient>,
  auditId: string,
  register: RegisterDoc[],
  requestId: string,
): Promise<GapSummaryContext> {
  // Withheld rows first and exempt from the cap; on-file rows past it are
  // counted so the prompt can disclose the truncation instead of lying about
  // register size.
  const withheldRows = register.filter((d) => !d.included);
  const onFileRows = register.filter((d) => d.included);
  const listed = [...withheldRows, ...onFileRows]
    .slice(0, Math.max(GAP_MAX_REGISTER_DOCS, withheldRows.length));
  const registerListing = listed.map((d) => ({
    title: cleanLine(d.title).slice(0, GAP_MAX_LINE_CHARS),
    status: d.status,
    withheld: !d.included,
  }));

  const [riskRes, checklistRes] = await Promise.all([
    supabase
      .from("vendor_risk_summary_objects")
      .select("id, focus_areas")
      .eq("audit_id", auditId)
      .maybeSingle(),
    supabase
      .from(DELIVERABLES.checklist.table)
      .select("content")
      .eq("audit_id", auditId)
      .maybeSingle(),
  ]);
  if (riskRes.error) {
    log("warn", "audit_deliverable_draft.gap_context.risk_summary_read_error", {
      request_id: requestId, error: String(riskRes.error.message),
    });
  }
  if (checklistRes.error) {
    log("warn", "audit_deliverable_draft.gap_context.checklist_read_error", {
      request_id: requestId, error: String(checklistRes.error.message),
    });
  }

  const focusAreas = (((riskRes.data as { focus_areas?: unknown } | null)?.focus_areas as string[] | null) ?? [])
    .map((a) => cleanLine(String(a)).slice(0, GAP_MAX_LINE_CHARS))
    .filter(Boolean);

  let domains: string[] = [];
  const riskSummaryId = (riskRes.data as { id?: unknown } | null)?.id;
  if (typeof riskSummaryId === "string") {
    const { data: junction, error: junctionErr } = await supabase
      .from("vendor_risk_summary_protocol_risks")
      .select("protocol_risk_objects(section_identifier, section_title, operational_domain_tag)")
      .eq("risk_summary_id", riskSummaryId);
    if (junctionErr) {
      log("warn", "audit_deliverable_draft.gap_context.junction_read_error", {
        request_id: requestId, error: String(junctionErr.message),
      });
    }
    domains = ((junction ?? []) as { protocol_risk_objects: unknown }[]).flatMap((j) => {
      const v = j.protocol_risk_objects;
      const p = (Array.isArray(v) ? v[0] : v) as
        | { section_identifier?: string; section_title?: string; operational_domain_tag?: string }
        | null;
      if (!p || typeof p.operational_domain_tag !== "string" || p.operational_domain_tag.trim().length === 0) {
        return [];
      }
      const section = [p.section_identifier, p.section_title].filter(Boolean).join(" ");
      return [cleanLine(`${p.operational_domain_tag}${section ? ` (§${section})` : ""}`).slice(0, GAP_MAX_LINE_CHARS)];
    });
  }
  const scopeAreas = [...new Set([...focusAreas, ...domains])].slice(0, GAP_MAX_SCOPE_AREAS);

  // Checklist expectations through the same parser the checklist kind uses —
  // its cap and item-validity rules come from DELIVERABLES.checklist.
  const checklistContent = (checklistRes.data as { content?: unknown } | null)?.content ?? null;
  const checklistEntries = extractExisting("checklist", checklistContent);
  const checklistItems = checklistEntries.map((e) => ({
    prompt: cleanLine(e.text).slice(0, GAP_MAX_LINE_CHARS),
    evidence_expected: e.raw.evidence_expected === true,
  }));

  // Snapshot identity comes from the RAW item list, NOT the capped/filtered
  // prompt extraction above: the client diffs these ids against the FULL live
  // checklist, so a capped snapshot would flag a >maxItems checklist as
  // permanently stale the instant it is drafted — and Revise could never
  // clear it (regeneration re-caps).
  const rawChecklistItems = Array.isArray((checklistContent as Record<string, unknown> | null)?.items)
    ? ((checklistContent as Record<string, unknown>).items as unknown[])
    : [];
  const checklistItemIds = rawChecklistItems
    .filter((it): it is Record<string, unknown> => !!it && typeof it === "object")
    .map((it) => it.id)
    .filter((id): id is string => typeof id === "string");

  return {
    scopeAreas,
    registerListing,
    truncatedCount: register.length - listed.length,
    checklistItems,
    registerSnapshot: register.map((d) => ({
      document_id: d.document_id, title: d.title, status: d.status, included: d.included,
    })),
    checklistItemIds,
  };
}

// -----------------------------------------------------------------------------
// Retrieval — one hybrid_search per query group over the combined corpus,
// partitioned into protocol vs evidence rows by document id. Failure degrades
// to "no candidates"; drafting proceeds ungrounded, never 500s.
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
  reviseQuery: string | null,
  signal: AbortSignal,
  requestId: string,
): Promise<{ protocol: ProtocolCandidate[]; evidence: ProtocolCandidate[] }> {
  try {
    const allDocIds = [...protocolDocIds, ...evidenceDocIds];
    const queries = [...QUERY_GROUPS];
    if (reviseQuery) queries.push(reviseQuery.slice(0, 4_000));

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
    log("warn", "audit_deliverable_draft.retrieval_failed", {
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
    log("warn", "audit_deliverable_draft.rate_limited", { request_id: requestId, ip });
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: { ...jsonHeaders, "Retry-After": String(rl.retryAfter) } });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ error: "Request too large" }),
      { status: 413, headers: jsonHeaders });
  }

  let body: { audit_id?: string; deliverable?: string };
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
  // The config map IS the allowlist — a new kind added there is accepted (and
  // named in the error) without touching this check.
  if (typeof body.deliverable !== "string" || !(body.deliverable in DELIVERABLES)) {
    return new Response(
      JSON.stringify({ error: `deliverable must be one of: ${Object.keys(DELIVERABLES).join(", ")}` }),
      { status: 400, headers: jsonHeaders });
  }
  const kind = body.deliverable as DeliverableKind;
  const config = DELIVERABLES[kind];

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!supabaseUrl || !supabaseAnonKey || !openaiKey) {
    log("error", "audit_deliverable_draft.missing_env", { request_id: requestId });
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
  // Context — RLS-gated. Names never selected.
  // ---------------------------------------------------------------------------

  const { data: audit, error: auditErr } = await supabase
    .from("audits")
    .select(`id, audit_type, workflow_type, protocol_id, protocol:protocols(title)`)
    .eq("id", auditId)
    .maybeSingle();

  if (auditErr || !audit) {
    log("warn", "audit_deliverable_draft.audit_not_found", { request_id: requestId, audit_id: auditId });
    return new Response(JSON.stringify({ error: "Audit not found or access denied" }),
      { status: 404, headers: jsonHeaders });
  }
  if (audit.workflow_type !== "VENDOR_AUDIT") {
    return new Response(JSON.stringify({ error: "Deliverable drafting is only available on vendor audits" }),
      { status: 409, headers: jsonHeaders });
  }

  const protocol = audit.protocol as { title?: string } | { title?: string }[] | null;
  const protocolTitle = (Array.isArray(protocol) ? protocol[0]?.title : protocol?.title) ?? null;

  // Existing deliverable → revision mode. Letter: body/scope only — recipients
  // are NEVER read into this function's prompt path.
  const { data: existingRow } = await supabase
    .from(config.table)
    .select("content")
    .eq("audit_id", auditId)
    .maybeSingle();
  const existingContent = (existingRow?.content ?? null) as Record<string, unknown> | null;

  const existing = extractExisting(kind, existingContent);
  let letterCurrent: { body_text: string; scope: string[] } | null = null;
  if (config.shape === "letter" && existingContent) {
    const bodyText = typeof existingContent.body_text === "string" ? existingContent.body_text : "";
    const scope = Array.isArray(existingContent.scope)
      ? existingContent.scope.filter((sLine): sLine is string => typeof sLine === "string")
      : [];
    if (bodyText.trim().length > 0 || scope.length > 0) letterCurrent = { body_text: bodyText, scope };
  }
  const mode: "generate" | "revise" = existing.length > 0 || letterCurrent ? "revise" : "generate";

  // Evidence register — JWT/RLS-gated. Ordered so the gap listing's cap cuts
  // deterministically (matches the client's listAuditEvidence ordering).
  const { data: registerRows, error: registerErr } = await supabase
    .from("audit_source_documents")
    .select("document_id, source_type, include_in_generation, documents(title, status, content_hash, kind)")
    .eq("audit_id", auditId)
    .order("added_at", { ascending: false });

  if (registerErr) {
    log("warn", "audit_deliverable_draft.register_read_error", {
      request_id: requestId, deliverable: kind, error: String(registerErr.message),
    });
    // For the gap summary an unreadable register is NOT an empty register:
    // rendering the failure as "(no evidence documents filed yet)" would
    // invert the deliverable ("nothing on file, all outstanding"). Other
    // kinds keep the pre-existing degradation (fewer evidence passages).
    if (kind === "evidence_gap_summary") {
      return new Response(
        JSON.stringify({ error: "Evidence register could not be read — try again" }),
        { status: 503, headers: jsonHeaders });
    }
  }

  const register = normalizeRegister(registerRows);
  const evidenceDocs = register.filter((d) => d.included && d.status === "ready");

  // Gap-summary coverage basis — fired here (register in hand) and awaited
  // after retrieval, so its round trips hide behind the embedding fan-out.
  const gapContextPromise: Promise<GapSummaryContext | null> =
    kind === "evidence_gap_summary"
      ? loadGapSummaryContext(supabase, auditId, register, requestId)
      : Promise.resolve(null);

  log("info", "audit_deliverable_draft.request", {
    request_id: requestId,
    audit_id: auditId,
    deliverable: kind,
    mode,
    existing_count: existing.length,
    evidence_doc_count: evidenceDocs.length,
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  req.signal.addEventListener("abort", () => controller.abort());

  // ---------------------------------------------------------------------------
  // Retrieval — service role, ONLY after the JWT audit fetch proved ownership.
  // ---------------------------------------------------------------------------

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let protocolDocIds: string[] = [];
  let protocolSource: "ready" | "unavailable" = "unavailable";
  let candidates: { protocol: ProtocolCandidate[]; evidence: ProtocolCandidate[] } =
    { protocol: [], evidence: [] };

  if (serviceRoleKey) {
    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });
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
      const reviseQuery = existing.length > 0
        ? existing.map((e) => e.text).join("\n")
        : letterCurrent
          ? `${letterCurrent.scope.join("\n")}\n${letterCurrent.body_text}`
          : null;
      candidates = await retrieveCandidates(
        serviceClient, openaiKey, protocolDocIds, evidenceDocIds,
        reviseQuery, controller.signal, requestId,
      );
    }
  }

  const docTitles = new Map(evidenceDocs.map((d) => [d.document_id, d.title]));
  const gapContext = await gapContextPromise;
  if (gapContext) {
    log("info", "audit_deliverable_draft.gap_context", {
      request_id: requestId,
      register_doc_count: gapContext.registerSnapshot.length,
      register_listed_count: gapContext.registerListing.length,
      register_truncated_count: gapContext.truncatedCount,
      withheld_count: gapContext.registerListing.filter((e) => e.withheld).length,
      scope_area_count: gapContext.scopeAreas.length,
      checklist_item_count: gapContext.checklistItems.length,
    });
  }

  // ---------------------------------------------------------------------------
  // OpenAI call — JSON mode, low temperature.
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
          { role: "system", content: config.systemPrompt },
          {
            role: "user",
            content: buildUserMessage(
              kind, protocolTitle, (audit.audit_type as string | null) ?? null,
              candidates.protocol, candidates.evidence, docTitles, existing, letterCurrent,
              gapContext,
            ),
          },
        ],
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    const aborted = (err as Error).name === "AbortError";
    log("error", "audit_deliverable_draft.openai.fetch_failed", {
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
    log("error", "audit_deliverable_draft.openai.error", {
      request_id: requestId, status: openaiRes.status, error_preview: errText.slice(0, 200),
    });
    return new Response(JSON.stringify({ error: "AI service error" }),
      { status: 502, headers: jsonHeaders });
  }

  const payload = await openaiRes.json();
  const content = payload?.choices?.[0]?.message?.content;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(typeof content === "string" ? content : "");
  } catch {
    log("error", "audit_deliverable_draft.openai.unparseable", {
      request_id: requestId,
      // A finish_reason of "length" means the JSON was cut mid-object by the
      // max_tokens ceiling, not malformed by the model.
      finish_reason: payload?.choices?.[0]?.finish_reason ?? null,
      content_chars: typeof content === "string" ? content.length : 0,
    });
    return new Response(JSON.stringify({ error: "AI service returned unparseable output" }),
      { status: 502, headers: jsonHeaders });
  }

  // ---------------------------------------------------------------------------
  // Gates + shaping. Counts only in logs.
  // ---------------------------------------------------------------------------

  const allCandidates = [...candidates.protocol, ...candidates.evidence];
  const evidenceLabelSet = new Set(candidates.evidence.map((c) => c.label));
  const existingByLabel = new Map(existing.map((e) => [e.label, e]));

  interface OutRef {
    item_id: string;
    chunk_id: string;
    document_id: string;
    source: "PROTOCOL" | "EVIDENCE";
    quote: string;
    doc_title: string | null;
    section_heading: string | null;
    page_start: number | null;
    page_end: number | null;
  }
  const generationRefs: OutRef[] = [];
  let droppedCount = 0;
  let strippedRefCount = 0;

  const gateRefs = (rawRefs: unknown, itemId: string) => {
    const refs = Array.isArray(rawRefs) ? rawRefs.slice(0, MAX_REFS_PER_ENTRY) : [];
    for (const rawRef of refs) {
      const r = rawRef as Record<string, unknown> | null;
      const snapshot = materializeRef(r?.passage, r?.quote, allCandidates);
      if (!snapshot) { strippedRefCount++; continue; }
      const label = String(r?.passage ?? "").trim();
      generationRefs.push({
        item_id: itemId,
        chunk_id: snapshot.chunk_id,
        document_id: snapshot.document_id,
        source: evidenceLabelSet.has(label) ? "EVIDENCE" : "PROTOCOL",
        quote: snapshot.quote,
        doc_title: docTitles.get(snapshot.document_id) ?? null,
        section_heading: snapshot.section_heading,
        page_start: snapshot.page_start,
        page_end: snapshot.page_end,
      });
    }
  };

  // Shaped per deliverable. `content_patch` is what the client merges into the
  // deliverable's content at apply time (letter: recipients merged client-side).
  let contentPatch: Record<string, unknown>;
  let outCount = 0;
  let bodyTruncated = false;
  const keptExistingIds = new Set<string>();

  if (config.shape === "letter") {
    const bodyCap = config.maxBodyChars ?? MAX_BODY_TEXT_CHARS;
    const rawBody = typeof parsed.body_text === "string" ? parsed.body_text.trim() : "";
    const bodyText = rawBody.slice(0, bodyCap);
    bodyTruncated = rawBody.length > bodyCap;
    const scope = (Array.isArray(parsed.scope) ? parsed.scope : [])
      .filter((sLine): sLine is string => typeof sLine === "string" && sLine.trim().length > 0)
      .map((sLine) => sLine.trim().slice(0, MAX_PROMPT_CHARS))
      .slice(0, 20);
    if (bodyText.length === 0) {
      // Never apply an empty body: in revise mode it would wipe the auditor's
      // persisted text (apply is automatic client-side).
      log("error", "audit_deliverable_draft.empty_body", { request_id: requestId, deliverable: kind });
      return new Response(JSON.stringify({ error: "AI service returned an empty draft" }),
        { status: 502, headers: jsonHeaders });
    }
    // Blob-level refs: the kind's configured item_id (see DeliverableGenerationRef).
    gateRefs(parsed.refs, config.blobRefId);
    contentPatch = { body_text: bodyText, scope };
    outCount = 1;
  } else {
    interface OutItem { id: string; [k: string]: unknown }
    const items: OutItem[] = [];
    const rawOut = Array.isArray(parsed.items) ? parsed.items : [];
    for (const raw of rawOut) {
      if (items.length >= config.maxItems) break;
      if (!raw || typeof raw !== "object") { droppedCount++; continue; }
      const it = raw as Record<string, unknown>;

      const existingLabel = typeof it.existing === "string" ? it.existing.trim() : null;
      const kept = existingLabel ? existingByLabel.get(existingLabel) : undefined;
      if (existingLabel && !kept) {
        log("warn", "audit_deliverable_draft.unknown_existing_label", {
          request_id: requestId, label: existingLabel,
        });
      }
      if (kept && keptExistingIds.has(kept.id)) { droppedCount++; continue; }

      const textField = kind === "checklist" ? "prompt" : "topic";
      const textValue = typeof it[textField] === "string" ? (it[textField] as string).trim() : "";
      if (!kept && (textValue.length === 0 || textValue.length > MAX_PROMPT_CHARS)) {
        droppedCount++;
        continue;
      }
      const textOrKept = textValue.length > 0 && textValue.length <= MAX_PROMPT_CHARS
        ? textValue
        : String(kept?.raw[textField] ?? "");

      let item: OutItem;
      if (kind === "checklist") {
        item = kept
          ? {
            id: kept.id,
            prompt: textOrKept,
            checkpoint_ref: (kept.raw.checkpoint_ref as string | null) ?? null,
            evidence_expected: typeof it.evidence_expected === "boolean"
              ? it.evidence_expected
              : kept.raw.evidence_expected === true,
          }
          : {
            id: crypto.randomUUID(),
            prompt: textOrKept,
            checkpoint_ref: null,
            evidence_expected: it.evidence_expected === true,
          };
      } else {
        // Agenda: a kept item's time and owner are the auditor's — never
        // model-updated (prompt says so; this enforces it).
        const timeValue = typeof it.time === "string" ? it.time.trim().slice(0, 40) : "";
        const ownerValue = typeof it.owner === "string" ? it.owner.trim().slice(0, 60) : "";
        const notesValue = typeof it.notes === "string" && it.notes.trim().length > 0
          ? it.notes.trim().slice(0, MAX_PROMPT_CHARS)
          : null;
        item = kept
          ? {
            id: kept.id,
            time: String(kept.raw.time ?? ""),
            topic: textOrKept,
            owner: String(kept.raw.owner ?? "Auditor"),
            notes: notesValue ?? ((kept.raw.notes as string | null) ?? null),
          }
          : {
            id: crypto.randomUUID(),
            time: timeValue || "TBD",
            topic: textOrKept,
            owner: ownerValue || "Auditor",
            notes: notesValue,
          };
      }
      if (kept) keptExistingIds.add(kept.id);

      gateRefs(it.refs, item.id);
      items.push(item);
    }
    if (items.length === 0) {
      // Never apply an empty item set: in revise mode it would wipe the
      // auditor's persisted items on the strength of a garbage model reply
      // (apply is automatic client-side — no human sits between proposal and
      // apply). In generate mode an empty draft is useless anyway.
      log("error", "audit_deliverable_draft.empty_items", {
        request_id: requestId, deliverable: kind, mode,
      });
      return new Response(JSON.stringify({ error: "AI service returned an empty draft" }),
        { status: 502, headers: jsonHeaders });
    }
    contentPatch = { items };
    outCount = items.length;
  }

  const grounding = {
    protocol_document_ids: protocolDocIds,
    evidence: evidenceDocs.map((d) => ({
      document_id: d.document_id,
      content_hash: d.content_hash,
      title: d.title,
      source_type: d.source_type,
    })),
    // Gap kind only: the extra axes this deliverable depends on (full register
    // incl. withheld rows, checklist item identity), persisted so a kind-aware
    // currency check can diff them. Today's computeDeliverableCurrency ignores
    // unknown snapshot fields; the client slice wires the comparison.
    ...(gapContext ? {
      register: gapContext.registerSnapshot,
      checklist_item_ids: gapContext.checklistItemIds,
    } : {}),
  };

  log("info", "audit_deliverable_draft.response", {
    request_id: requestId,
    audit_id: auditId,
    deliverable: kind,
    mode,
    out_count: outCount,
    kept_existing_count: keptExistingIds.size,
    dropped_count: droppedCount,
    stripped_ref_count: strippedRefCount,
    ref_count: generationRefs.length,
    protocol_source: protocolSource,
    body_truncated: bodyTruncated,
  });

  return new Response(JSON.stringify({
    mode,
    deliverable: kind,
    content_patch: contentPatch,
    generation_refs: generationRefs,
    grounding,
    dropped_count: droppedCount,
    stripped_ref_count: strippedRefCount,
    body_truncated: bodyTruncated,
    protocol_source: protocolSource,
    evidence_doc_count: evidenceDocs.length,
  }), { status: 200, headers: jsonHeaders });
});
