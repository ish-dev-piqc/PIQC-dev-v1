// =============================================================================
// Source of Truth Reviewer — Reducto → SOTR adapter.
//
// Pure mapping function: takes a Reducto Extract response (with citations)
// and produces normalized NewExtractedItem + NewSourceEvidence records ready
// for DB insertion. No I/O, no side effects.
//
// Design principles:
// - Missing fields are handled gracefully — never throws.
// - If a citation is absent, the item is stored with confidence_state =
//   needs_review and an appropriate missing_source_reason.
// - quoted_text is treated as sensitive: do not log it.
// - The adapter does not modify the parser — it reads whatever Reducto
//   returns via the _reducto_citations key injected by ingest.ts.
// =============================================================================

import type {
  ReductoExtractResponse,
  ReductoCitation,
  NewSourceEvidence,
  NewExtractedItem,
  NewItemEvidenceLink,
  AdapterOutput,
  ConfidenceState,
  EvidenceSupportType,
  MissingSourceReason,
  BoundingBox,
} from '../../types/sotr';
import { normalizeVisitName } from './visitNameNormalize';

// ---------------------------------------------------------------------------
// Visit deduplication
//
// Reducto's schedule_of_events extract often returns two entries for the same
// logical visit — one from the inline visit-description section (Source B,
// e.g. "6.3.x Visit N (Week X, Day Y±Z)") and one from the Schedule of
// Assessments appendix table (Source A). Source A typically has
// window_minus_days/plus_days = 0 because merged-cell parsing drops the ±
// notation; Source B carries the correct window values.
//
// The dedup step picks the inline-section entry as canonical (winner) and
// preserves the table entry as additional evidence:
//   - support_type='conflict' when non-zero values disagree (e.g. winner
//     says study_day=14, loser says study_day=15)
//   - support_type='secondary' when values agree (just a duplicate source)
//
// This keeps every citation Reducto produced — nothing is silently dropped —
// so the SOTR reviewer and any downstream worksheet export see full
// provenance for each visit.
// ---------------------------------------------------------------------------

interface ScheduleEntry {
  visit_name?: unknown;
  study_day?: unknown;
  window_minus_days?: unknown;
  window_plus_days?: unknown;
  schedule_variant?: unknown;
  [key: string]: unknown;
}

interface ExtraEvidenceRef {
  /** Index into the ORIGINAL schedule_of_events array. */
  sourceIndex: number;
  supportType: 'secondary' | 'conflict';
}

export interface VisitDedupResult {
  /** Indices (in the original array, in original order) of winning entries. */
  winningIndices: number[];
  /** For each winning index, the losing entries that should attach as extra evidence. */
  extraEvidenceFor: Map<number, ExtraEvidenceRef[]>;
}

// normalizeVisitName is imported from ./visitNameNormalize (shared, parity-tested).

function toNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return 0;
}

function hasWindow(entry: ScheduleEntry): boolean {
  return toNumber(entry.window_minus_days) > 0 || toNumber(entry.window_plus_days) > 0;
}

function isConflict(winner: ScheduleEntry, other: ScheduleEntry): boolean {
  const winnerDay  = toNumber(winner.study_day);
  const otherDay   = toNumber(other.study_day);
  // study_day disagrees with both sides asserting a non-zero value
  if (otherDay !== 0 && winnerDay !== 0 && otherDay !== winnerDay) return true;

  const winnerMinus = toNumber(winner.window_minus_days);
  const otherMinus  = toNumber(other.window_minus_days);
  if (otherMinus > 0 && otherMinus !== winnerMinus) return true;

  const winnerPlus = toNumber(winner.window_plus_days);
  const otherPlus  = toNumber(other.window_plus_days);
  if (otherPlus > 0 && otherPlus !== winnerPlus) return true;

  return false;
}

/**
 * Groups schedule_of_events entries by normalized visit_name, picks the
 * inline-section entry (window > 0) as winner per group, and classifies the
 * remaining entries as conflict or secondary evidence.
 *
 * Pure function — no I/O, never throws. Entries without a recognizable
 * visit_name are treated as singletons and pass through unchanged.
 *
 * Exported for direct testing.
 */
export function dedupeVisitArray(visits: readonly unknown[]): VisitDedupResult {
  const entries: (ScheduleEntry | null)[] = visits.map((v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? (v as ScheduleEntry)
      : null,
  );

  // Group indices by normalized visit_name. Entries without a usable name
  // get a synthetic per-index key so they pass through as singletons.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = e && typeof e.visit_name === 'string' ? e.visit_name : '';
    const key = name.trim().length > 0 ? normalizeVisitName(name) : `__unnamed_${i}__`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }

  const winningIndices: number[] = [];
  const extraEvidenceFor = new Map<number, ExtraEvidenceRef[]>();

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      winningIndices.push(indices[0]);
      continue;
    }
    // Prefer the first entry with a non-zero window (Source B / inline section).
    // Fall back to the first entry if no entry has window data — both are
    // probably from the SOA table and we have no signal to choose between them.
    const winnerIdx =
      indices.find((i) => entries[i] !== null && hasWindow(entries[i]!)) ?? indices[0];
    winningIndices.push(winnerIdx);

    const winner = entries[winnerIdx];
    if (!winner) continue;

    const extras: ExtraEvidenceRef[] = [];
    for (const otherIdx of indices) {
      if (otherIdx === winnerIdx) continue;
      const other = entries[otherIdx];
      if (!other) continue;
      const supportType: 'secondary' | 'conflict' = isConflict(winner, other)
        ? 'conflict'
        : 'secondary';
      extras.push({ sourceIndex: otherIdx, supportType });
    }
    if (extras.length > 0) extraEvidenceFor.set(winnerIdx, extras);
  }

  winningIndices.sort((a, b) => a - b);
  return { winningIndices, extraEvidenceFor };
}

// Maps top-level CLINICAL_EXTRACT_SCHEMA keys to human-readable field types.
const FIELD_TYPE_MAP: Record<string, string> = {
  protocol_title:    'metadata',
  protocol_number:   'metadata',
  protocol_version:  'metadata',
  sponsor_name:      'metadata',
  compound_name:     'metadata',
  therapeutic_area:  'metadata',
  study_phase:       'metadata',
  study_design:      'metadata',
  is_amendment:      'metadata',
  amendment_summary: 'metadata',
  dosing_regimen:    'dosing',
};

function fieldTypeFor(key: string): string {
  if (FIELD_TYPE_MAP[key]) return FIELD_TYPE_MAP[key];
  if (key === 'primary_endpoints' || key === 'secondary_endpoints') return 'endpoint';
  if (key === 'key_inclusion_criteria') return 'inclusion_criterion';
  if (key === 'key_exclusion_criteria') return 'exclusion_criterion';
  if (key === 'prohibited_medications') return 'prohibited_med';
  if (key === 'schedule_of_events') return 'visit';
  return 'other';
}

function citationToConfidenceState(
  citation: ReductoCitation | null | undefined,
  hasMissingReason: boolean,
): ConfidenceState {
  if (hasMissingReason) return 'needs_review';
  if (!citation) return 'needs_review';
  if (citation.confidence === 'high')   return 'high';
  if (citation.confidence === 'medium') return 'medium';
  if (citation.confidence === 'low')    return 'low';
  // Citation present but no confidence field — present but unscored, default medium.
  return 'medium';
}

// Maps categorical Reducto confidence to a numeric midpoint for storage.
function confidenceScoreFor(citation: ReductoCitation): number | null {
  if (citation.confidence === 'high')   return 0.9;
  if (citation.confidence === 'medium') return 0.6;
  if (citation.confidence === 'low')    return 0.3;
  return null;
}

function inferMissingReason(
  citation: ReductoCitation | null | undefined,
): MissingSourceReason | null {
  if (!citation)         return 'parser_output_missing_citation';
  if (!citation.text)    return 'source_text_not_found';
  // Citation has text but no page location — partial.
  if (!citation.pages?.length) return 'coordinates_unavailable';
  return null;
}

function buildEvidence(
  documentId: string,
  extractionRunId: string | null,
  citation: ReductoCitation,
  supportType: EvidenceSupportType,
): NewSourceEvidence {
  const pages = citation.pages ?? [];
  const pageFirst = pages.length > 0 ? pages[0]  : null;

  const bboxes = (citation.bbox?.length ?? 0) > 0
    ? (citation.bbox as BoundingBox[])
    : null;

  return {
    document_id:       documentId,
    page_number:       pageFirst,
    section_title:     citation.section ?? null,
    quoted_text:       citation.text ?? null,  // sensitive — not logged
    bounding_boxes:    bboxes,
    confidence_score:  confidenceScoreFor(citation),
    support_type:      supportType,
    extraction_run_id: extractionRunId,
  };
}

function processSingleField(
  documentId: string,
  extractionRunId: string | null,
  fieldPath: string,
  fieldType: string,
  value: unknown,
  citation: ReductoCitation | null | undefined,
  items: NewExtractedItem[],
  evidence: NewSourceEvidence[],
  links: NewItemEvidenceLink[],
): void {
  const missingReason = inferMissingReason(citation);

  items.push({
    document_id:          documentId,
    field_path:           fieldPath,
    field_type:           fieldType,
    extracted_value:      value,
    confidence_state:     citationToConfidenceState(citation, missingReason !== null),
    missing_source_reason: missingReason,
  });

  // Only create an evidence record when there is source text to store.
  if (citation?.text) {
    const itemIndex = items.length - 1;
    const evIndex   = evidence.length;
    evidence.push(buildEvidence(documentId, extractionRunId, citation, 'primary'));
    links.push({ item_index: itemIndex, evidence_index: evIndex, is_primary_source: true });
  }
}

/**
 * Maps a Reducto Extract response into normalized SOTR records ready for
 * DB insertion. Pure function — no I/O, never throws.
 *
 * @param documentId       The documents.id this extraction belongs to.
 * @param extractedFields  Full Reducto extract response including the
 *                         _reducto_citations sentinel injected by ingest.ts.
 * @param extractionRunId  Reducto job_id, if available. Stored on evidence
 *                         rows so records can be traced back to a parse run.
 */
export function mapReductoExtractToSotr(
  documentId: string,
  extractedFields: ReductoExtractResponse,
  extractionRunId: string | null = null,
): AdapterOutput {
  const items:    NewExtractedItem[]    = [];
  const evidence: NewSourceEvidence[]   = [];
  const links:    NewItemEvidenceLink[] = [];

  const citations = extractedFields._reducto_citations ?? {};

  // Process every non-null field from the extract response, skipping the
  // internal citations sentinel.
  const fieldKeys = Object.keys(extractedFields).filter(
    (k) => k !== '_reducto_citations' &&
           extractedFields[k] !== null &&
           extractedFields[k] !== undefined,
  );

  for (const key of fieldKeys) {
    const value      = extractedFields[key];
    const rawCitation = citations[key];
    const fieldType  = fieldTypeFor(key);

    if (Array.isArray(value)) {
      // schedule_of_events gets deduped first so duplicate visits collapse
      // into one extracted item with multiple evidence rows. Every other
      // array field expands one-to-one as before.
      if (fieldType === 'visit') {
        const { winningIndices, extraEvidenceFor } = dedupeVisitArray(value);

        for (const i of winningIndices) {
          const fieldPath = `${key}[${i}]`;
          const citationEntry = Array.isArray(rawCitation)
            ? (rawCitation[i] ?? null)
            : (rawCitation ?? null);

          processSingleField(
            documentId, extractionRunId,
            fieldPath, fieldType,
            value[i],
            citationEntry,
            items, evidence, links,
          );

          // Attach losing-source citations as extra evidence on the winner item.
          // is_primary_source=false so SOTR's UI can render them as supporting
          // evidence behind the primary cite.
          const winnerItemIndex = items.length - 1;
          const extras = extraEvidenceFor.get(i);
          if (!extras) continue;

          for (const { sourceIndex, supportType } of extras) {
            const extraCitation = Array.isArray(rawCitation)
              ? (rawCitation[sourceIndex] ?? null)
              : null;
            if (!extraCitation?.text) continue;  // nothing useful to store

            const evIndex = evidence.length;
            evidence.push(buildEvidence(documentId, extractionRunId, extraCitation, supportType));
            links.push({
              item_index:        winnerItemIndex,
              evidence_index:    evIndex,
              is_primary_source: false,
            });
          }
        }
        continue;
      }

      // Expand arrays — each element gets its own item + optional evidence row.
      for (let i = 0; i < value.length; i++) {
        const fieldPath     = `${key}[${i}]`;
        const citationEntry = Array.isArray(rawCitation)
          ? (rawCitation[i] ?? null)
          : (rawCitation ?? null);

        processSingleField(
          documentId, extractionRunId,
          fieldPath, fieldType,
          value[i],
          citationEntry,
          items, evidence, links,
        );
      }
    } else {
      // Scalar field — one item row.
      const citationEntry = Array.isArray(rawCitation)
        ? (rawCitation[0] ?? null)
        : (rawCitation ?? null);

      processSingleField(
        documentId, extractionRunId,
        key, fieldType,
        value,
        citationEntry,
        items, evidence, links,
      );
    }
  }

  return { items, evidence, links };
}
