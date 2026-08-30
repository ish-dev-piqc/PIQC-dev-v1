// =============================================================================
// Document-passage candidates for grounded generation (shared).
//
// Born in isa-finding-draft; moved to _shared/ when the Stage-5 deliverable
// drafting engine adopted the same citation bridge. The contract is generation-surface
// agnostic:
//
// The model never sees chunk uuids and never composes provenance. It sees
// passages labeled P1..Pn and may cite at most one per draft, with a VERBATIM
// quote. Gate 3 (gates.ts) verifies membership + substring via this module,
// then materializeRef() builds the stored snapshot — quote from the model,
// section/pages/ids from the DB row. The model cannot misattribute a passage
// it did not receive, and it cannot paraphrase: a quote that is not a
// contiguous excerpt of the labeled chunk strips the ref.
//
// Pure module — no Deno APIs. Unit tested from
// src/lib/audit/__tests__/isaProtocolCandidates.test.ts (cross-tree, like
// isa-finding-draft's gates.ts). Consumers: isa-finding-draft (P-labels),
// audit-deliverable-draft (P- and E-labels via the labelPrefix arg).
// =============================================================================

export interface ProtocolChunkRow {
  id: string;
  document_id: string;
  content: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface ProtocolCandidate extends ProtocolChunkRow {
  label: string; // "P1".."Pn" — what the model cites
}

/** The snapshot stored on the finding (isa_finding_objects.protocol_refs). */
export interface ProtocolRefSnapshot {
  chunk_id: string;
  document_id: string;
  quote: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export const MAX_CANDIDATES = 14;
export const MAX_QUOTE_CHARS = 300;

/** Dedupe retrieval rows by chunk id and assign stable labels (P1.. by default). */
export function labelCandidates(rows: ProtocolChunkRow[], prefix = "P"): ProtocolCandidate[] {
  const seen = new Set<string>();
  const out: ProtocolCandidate[] = [];
  for (const row of rows) {
    if (!row || typeof row.id !== "string" || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ ...row, label: `${prefix}${out.length + 1}` });
    if (out.length >= MAX_CANDIDATES) break;
  }
  return out;
}

// Whitespace-tolerant matching: PDFs break lines mid-sentence, so the model's
// quote and the chunk text may differ in whitespace runs but nothing else.
function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Is `quote` a verbatim contiguous excerpt of `content` (whitespace-tolerant)? */
export function quoteInContent(quote: string, content: string): boolean {
  const q = normalize(quote);
  if (q.length === 0) return false;
  return normalize(content).includes(q);
}

/**
 * Turn the model's { passage, quote } claim into a stored snapshot — or null
 * if the claim fails Gate 3 (unknown label, empty/oversized quote, or quote
 * not found verbatim in the labeled passage).
 */
export function materializeRef(
  passage: unknown,
  quote: unknown,
  candidates: ProtocolCandidate[],
): ProtocolRefSnapshot | null {
  if (typeof passage !== "string" || typeof quote !== "string") return null;
  const trimmed = quote.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_QUOTE_CHARS) return null;
  const candidate = candidates.find((c) => c.label === passage.trim());
  if (!candidate) return null;
  if (!quoteInContent(trimmed, candidate.content)) return null;
  return {
    chunk_id: candidate.id,
    document_id: candidate.document_id,
    quote: trimmed,
    section_heading: candidate.section_heading,
    page_start: candidate.page_start,
    page_end: candidate.page_end,
  };
}
