// =============================================================================
// audit-observation-draft — server-side gates over the model's raw output.
//
// GUARANTEES, not prompt requests (isa-finding-draft/gates.ts precedent):
//
//   Gate 1 (cite-or-drop): a candidate survives only if it carries ≥1
//   evidence item and EVERY item keeps ≥1 verifiable citation after
//   filtering — a live note id that was actually sent to the model, OR an
//   evidence-passage label from the set actually sent. An item whose
//   citations ALL fail is fabricated-or-mistraced, so the whole candidate is
//   withheld (counted, disclosed), never rendered. Evidence-only candidates
//   are legitimate: the owner scoped grounding as notes + filed evidence.
//
//   Gate 3 (protocol citation): protocol_ref must name a protocol passage
//   from the candidate set AND quote it verbatim (whitespace-tolerant
//   substring). Fails → stripped, the candidate survives, the honesty
//   counter increments. Same materializeRef as every other engine.
//
//   No Gate 2: there is no vendor closed-world regulatory map. Deliberate.
//
// What the output CANNOT carry — schema-level absence, not prompt-level
// restraint: no severity, no impact, no classification. The GatedCandidate
// shape has no such field, and raw keys are never copied through. Grading is
// the auditor's act at accept time (D4 doctrine).
//
// Passage citations are materialized to the retrieved row's facts (chunk /
// document ids, section, pages). The model's E-labels never leave the
// function.
//
// Pure module — no Deno APIs, no imports beyond the shared pure module. Unit
// tested from src/lib/audit/__tests__/vendorObservationGates.test.ts.
// =============================================================================

import {
  materializeRef,
  type ProtocolCandidate,
  type ProtocolRefSnapshot,
} from "../_shared/protocolCandidates.ts";

export interface RawCandidateEvidence {
  text?: unknown;
  source_note_ids?: unknown;
  source_passages?: unknown;
}

export interface RawCandidate {
  vendor_domain?: unknown;
  observation_text?: unknown;
  checkpoint_ref?: unknown;
  evidence?: unknown;
  protocol_ref?: unknown;
}

/** Row facts of a cited evidence passage — no model text. */
export interface PassageRef {
  chunk_id: string;
  document_id: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface GatedCandidateEvidence {
  text: string;
  source_note_ids: string[];
  source_passages: PassageRef[];
}

export interface GatedCandidate {
  vendor_domain: string;
  observation_text: string;
  checkpoint_ref: string | null;
  evidence: GatedCandidateEvidence[];
  protocol_ref: ProtocolRefSnapshot | null;
}

export interface CandidateGateResult {
  accepted: GatedCandidate[];
  withheldCount: number;
  strippedProtocolRefCount: number;
}

const MAX_CANDIDATES = 15;
const MAX_EVIDENCE_ITEMS = 12;
const MAX_PASSAGES_PER_ITEM = 4;
const MAX_DOMAIN_CHARS = 80;
const MAX_OBSERVATION_CHARS = 2_000;
const MAX_EVIDENCE_TEXT_CHARS = 1_000;
const MAX_CHECKPOINT_CHARS = 200;

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

function toPassageRef(c: ProtocolCandidate): PassageRef {
  return {
    chunk_id: c.id,
    document_id: c.document_id,
    section_heading: c.section_heading,
    page_start: c.page_start,
    page_end: c.page_end,
  };
}

/**
 * Apply the gates to the model's raw candidates.
 *
 * @param rawCandidates      whatever the model returned under `candidates`
 * @param liveNoteIds        the note ids actually sent in the prompt — the
 *                           only ids evidence may cite
 * @param evidenceCandidates the evidence passages (E-labels) actually sent —
 *                           the only passages evidence may cite
 * @param protocolCandidates the protocol passages (P-labels) actually sent —
 *                           the only passages protocol_ref may cite
 */
export function gateCandidates(
  rawCandidates: unknown,
  liveNoteIds: Set<string>,
  evidenceCandidates: ProtocolCandidate[] = [],
  protocolCandidates: ProtocolCandidate[] = [],
): CandidateGateResult {
  const accepted: GatedCandidate[] = [];
  let withheldCount = 0;
  let strippedProtocolRefCount = 0;

  if (!Array.isArray(rawCandidates)) {
    return { accepted, withheldCount, strippedProtocolRefCount };
  }

  const evidenceByLabel = new Map(evidenceCandidates.map((c) => [c.label, c]));

  for (const raw of rawCandidates.slice(0, MAX_CANDIDATES) as RawCandidate[]) {
    if (raw === null || typeof raw !== "object") {
      withheldCount++;
      continue;
    }

    const vendorDomain = asTrimmedString(raw.vendor_domain, MAX_DOMAIN_CHARS);
    const observationText = asTrimmedString(raw.observation_text, MAX_OBSERVATION_CHARS);
    if (!vendorDomain || !observationText) {
      withheldCount++;
      continue;
    }

    // Gate 1 — cite-or-drop.
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) {
      withheldCount++;
      continue;
    }
    const evidence: GatedCandidateEvidence[] = [];
    let evidenceValid = true;
    for (const item of raw.evidence.slice(0, MAX_EVIDENCE_ITEMS) as RawCandidateEvidence[]) {
      const text = asTrimmedString(item?.text, MAX_EVIDENCE_TEXT_CHARS);
      const ids = Array.isArray(item?.source_note_ids)
        ? (item.source_note_ids as unknown[]).filter(
            (id): id is string => typeof id === "string" && liveNoteIds.has(id),
          )
        : [];
      const passages: PassageRef[] = [];
      const seenChunks = new Set<string>();
      if (Array.isArray(item?.source_passages)) {
        for (const label of item.source_passages as unknown[]) {
          if (typeof label !== "string") continue;
          const c = evidenceByLabel.get(label.trim());
          if (!c || seenChunks.has(c.id)) continue;
          seenChunks.add(c.id);
          passages.push(toPassageRef(c));
          if (passages.length >= MAX_PASSAGES_PER_ITEM) break;
        }
      }
      if (!text || (ids.length === 0 && passages.length === 0)) {
        evidenceValid = false;
        break;
      }
      evidence.push({ text, source_note_ids: [...new Set(ids)], source_passages: passages });
    }
    if (!evidenceValid || evidence.length === 0) {
      withheldCount++;
      continue;
    }

    // Gate 3 — protocol citation: candidate-set membership + verbatim quote.
    let protocolRef: ProtocolRefSnapshot | null = null;
    if (raw.protocol_ref !== undefined && raw.protocol_ref !== null) {
      const claim = raw.protocol_ref as { passage?: unknown; quote?: unknown };
      protocolRef = typeof claim === "object"
        ? materializeRef(claim.passage, claim.quote, protocolCandidates)
        : null;
      if (protocolRef === null) strippedProtocolRefCount++;
    }

    accepted.push({
      vendor_domain: vendorDomain,
      observation_text: observationText,
      checkpoint_ref: asTrimmedString(raw.checkpoint_ref, MAX_CHECKPOINT_CHARS),
      evidence,
      protocol_ref: protocolRef,
    });
  }

  return { accepted, withheldCount, strippedProtocolRefCount };
}
