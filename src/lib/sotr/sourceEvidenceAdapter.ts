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
