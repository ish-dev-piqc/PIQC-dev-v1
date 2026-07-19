// =============================================================================
// isa-finding-draft — server-side gates over the model's raw draft output.
//
// These are GUARANTEES, not prompt requests:
//
//   Gate 1 (cite-or-drop): a draft survives only if it carries ≥1 evidence
//   item and EVERY evidence item cites ≥1 note id that belongs to the set of
//   live notes actually sent to the model. A draft that cannot be traced to
//   the auditor's own notes is withheld — never rendered.
//
//   Gate 2 (closed-world citation): `reference` must be an exact entry of the
//   citation map row for the draft's domain. Anything else is stripped to
//   null (the draft survives; the field is left for the auditor). A wrong
//   regulatory cite must be impossible, not unlikely.
//
//   Gate 3 (protocol citation, S4): `protocol_ref` must name a passage from
//   the candidate set actually sent to the model AND carry a verbatim quote
//   of it (whitespace-tolerant substring). Fails → the ref is stripped, the
//   draft survives, the honesty counter increments. Same closed-world
//   doctrine as Gate 2 — except the closed world is the site's own protocol.
//
// Pure module — no Deno APIs, no imports beyond sibling pure modules. Unit
// tested from src/lib/audit/__tests__/isaFindingGates.test.ts.
// =============================================================================

import { CITATION_MAP, ISA_DOMAINS, type IsaDomainKey } from "./citationMap.ts";
import {
  materializeRef,
  type ProtocolCandidate,
  type ProtocolRefSnapshot,
} from "./protocolCandidates.ts";

const SEVERITIES = ["CRITICAL", "MAJOR", "MINOR", "RECOMMENDATION"] as const;
export type IsaSeverityKey = (typeof SEVERITIES)[number];

export interface RawEvidence {
  text?: unknown;
  source_note_ids?: unknown;
}

export interface RawDraft {
  title?: unknown;
  isa_domain?: unknown;
  subcategory?: unknown;
  severity?: unknown;
  severity_rule?: unknown;
  observation?: unknown;
  evidence?: unknown;
  reference?: unknown;
  protocol_ref?: unknown;
}

export interface GatedEvidence {
  text: string;
  source_note_ids: string[];
}

export interface GatedDraft {
  title: string;
  isa_domain: IsaDomainKey;
  subcategory: string | null;
  severity: IsaSeverityKey;
  severity_rule: string | null;
  observation: string;
  evidence: GatedEvidence[];
  reference: string | null;
  protocol_ref: ProtocolRefSnapshot | null;
}

export interface GateResult {
  accepted: GatedDraft[];
  withheldCount: number;
  strippedReferenceCount: number;
  strippedProtocolRefCount: number;
}

const MAX_TITLE_CHARS = 200;
const MAX_OBSERVATION_CHARS = 2_000;
const MAX_EVIDENCE_TEXT_CHARS = 1_000;
const MAX_EVIDENCE_ITEMS = 12;
const MAX_DRAFTS = 15;

function asTrimmedString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.slice(0, max);
}

function isDomain(v: unknown): v is IsaDomainKey {
  return typeof v === "string" && (ISA_DOMAINS as readonly string[]).includes(v);
}

function isSeverity(v: unknown): v is IsaSeverityKey {
  return typeof v === "string" && (SEVERITIES as readonly string[]).includes(v);
}

/**
 * Apply the gates to the model's raw drafts.
 *
 * @param rawDrafts   whatever the model returned under `drafts`
 * @param liveNoteIds the note ids that were actually sent in the prompt —
 *                    the only ids evidence is allowed to cite
 * @param candidates  the protocol passages actually sent in the prompt — the
 *                    only passages protocol_ref is allowed to cite. Empty
 *                    when the bridge is unavailable (no parsed protocol):
 *                    any ref the model volunteers anyway is stripped.
 */
export function gateDrafts(
  rawDrafts: unknown,
  liveNoteIds: Set<string>,
  candidates: ProtocolCandidate[] = [],
): GateResult {
  const accepted: GatedDraft[] = [];
  let withheldCount = 0;
  let strippedReferenceCount = 0;
  let strippedProtocolRefCount = 0;

  if (!Array.isArray(rawDrafts)) {
    return { accepted, withheldCount, strippedReferenceCount, strippedProtocolRefCount };
  }

  for (const raw of rawDrafts.slice(0, MAX_DRAFTS) as RawDraft[]) {
    if (raw === null || typeof raw !== "object") {
      withheldCount++;
      continue;
    }

    const title = asTrimmedString(raw.title, MAX_TITLE_CHARS);
    const observation = asTrimmedString(raw.observation, MAX_OBSERVATION_CHARS);
    if (!title || !observation || !isDomain(raw.isa_domain) || !isSeverity(raw.severity)) {
      withheldCount++;
      continue;
    }

    // Gate 1 — cite-or-drop.
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) {
      withheldCount++;
      continue;
    }
    const evidence: GatedEvidence[] = [];
    let evidenceValid = true;
    for (const item of raw.evidence.slice(0, MAX_EVIDENCE_ITEMS) as RawEvidence[]) {
      const text = asTrimmedString(item?.text, MAX_EVIDENCE_TEXT_CHARS);
      const ids = Array.isArray(item?.source_note_ids)
        ? (item.source_note_ids as unknown[]).filter(
            (id): id is string => typeof id === "string" && liveNoteIds.has(id),
          )
        : [];
      // Every item must keep ≥1 verifiable citation after filtering. An item
      // whose citations ALL fail is fabricated-or-mistraced → the whole draft
      // is untrustworthy, not just the item.
      if (!text || ids.length === 0) {
        evidenceValid = false;
        break;
      }
      evidence.push({ text, source_note_ids: [...new Set(ids)] });
    }
    if (!evidenceValid || evidence.length === 0) {
      withheldCount++;
      continue;
    }

    // Gate 2 — closed-world citation, scoped to the draft's own domain.
    let reference = asTrimmedString(raw.reference, 200);
    if (reference !== null && !CITATION_MAP[raw.isa_domain].includes(reference)) {
      reference = null;
      strippedReferenceCount++;
    }

    // Gate 3 — protocol citation: candidate-set membership + verbatim quote.
    // Strip-not-withhold, like Gate 2: a bad protocol cite must be
    // impossible, but it never costs the auditor the draft itself.
    let protocolRef: ProtocolRefSnapshot | null = null;
    if (raw.protocol_ref !== undefined && raw.protocol_ref !== null) {
      const claim = raw.protocol_ref as { passage?: unknown; quote?: unknown };
      protocolRef = typeof claim === "object"
        ? materializeRef(claim.passage, claim.quote, candidates)
        : null;
      if (protocolRef === null) strippedProtocolRefCount++;
    }

    accepted.push({
      title,
      isa_domain: raw.isa_domain,
      subcategory: asTrimmedString(raw.subcategory, 200),
      severity: raw.severity,
      severity_rule: asTrimmedString(raw.severity_rule, 300),
      observation,
      evidence,
      reference,
      protocol_ref: protocolRef,
    });
  }

  return { accepted, withheldCount, strippedReferenceCount, strippedProtocolRefCount };
}
