// =============================================================================
// Source of Truth Reviewer (SOTR) — TypeScript types.
//
// DB row types mirror the schema in 20260508000000_sotr_schema.sql.
// Adapter types describe the pure mapping layer between Reducto output and
// the normalized records that get written to the DB.
// =============================================================================


// ---------------------------------------------------------------------------
// Enums (lowercase values match the Postgres enum values)
// ---------------------------------------------------------------------------

export type EvidenceSupportType = 'primary' | 'secondary' | 'context' | 'conflict';

export type ConfidenceState = 'high' | 'medium' | 'low' | 'needs_review';

export type MissingSourceReason =
  | 'parser_output_missing_citation'
  | 'source_text_not_found'
  | 'protocol_version_mismatch'
  | 'coordinates_unavailable'
  | 'evidence_conflict'
  | 'unknown';


// ---------------------------------------------------------------------------
// Bounding box — Reducto spatial metadata for a cited region of the PDF.
// ---------------------------------------------------------------------------

export interface BoundingBox {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}


// ---------------------------------------------------------------------------
// DB row types
// ---------------------------------------------------------------------------

export interface SourceEvidenceRecord {
  id: string;
  document_id: string;
  protocol_version: string | null;
  page_number: number | null;
  section_number: string | null;
  section_title: string | null;
  /** Sensitive — do not log, do not expose raw storage URLs. */
  quoted_text: string | null;
  text_start_offset: number | null;
  text_end_offset: number | null;
  bounding_boxes: BoundingBox[] | null;
  confidence_score: number | null;
  support_type: EvidenceSupportType;
  extraction_run_id: string | null;
  created_at: string;
}

export interface ExtractedItemRecord {
  id: string;
  document_id: string;
  /** Dot-bracket path into CLINICAL_EXTRACT_SCHEMA, e.g. "primary_endpoints[0]". */
  field_path: string;
  /** Human-readable category: "endpoint" | "criterion" | "visit" | "dosing" | "metadata". */
  field_type: string;
  extracted_value: unknown;
  confidence_state: ConfidenceState;
  confidence_score: number | null;
  confidence_reason: string | null;
  ambiguity_reason: string | null;
  missing_source_reason: MissingSourceReason | null;
  created_at: string;
  updated_at: string;
}

export interface ItemEvidenceLink {
  id: string;
  extracted_item_id: string;
  source_evidence_id: string;
  is_primary_source: boolean;
  relevance_score: number | null;
  created_at: string;
}

/** Return type of sotr_get_item_evidence RPC. */
export interface ItemWithEvidence {
  item: ExtractedItemRecord;
  evidence: Array<{
    link: ItemEvidenceLink;
    evidence: SourceEvidenceRecord;
  }>;
}


// ---------------------------------------------------------------------------
// Reducto Extract response shape.
//
// The ingest function calls Reducto Extract with citations: { enabled: true }.
// The response merges the extracted field values with a _reducto_citations key
// added by our ingest function before it stores extractedFields. Field names
// should be verified against the live Reducto API response if the API version
// changes.
// ---------------------------------------------------------------------------

export interface ReductoCitation {
  /** Quoted source text from the protocol. Treat as sensitive — do not log. */
  text?: string;
  /** 1-based page numbers where the cited text appears. */
  pages?: number[];
  /** Categorical confidence (numerical_confidence: false in the ingest call). */
  confidence?: 'high' | 'medium' | 'low';
  /** Section heading as labelled in the document. */
  section?: string;
  /** Bounding box coordinates if Reducto includes them. */
  bbox?: BoundingBox[];
}

export interface ReductoExtractResponse {
  [field: string]: unknown;
  /**
   * Citation provenance keyed by field name, injected by the ingest function
   * before storing extractedFields. Null/absent when Reducto returned no
   * citations or an older parse run predates this feature.
   */
  _reducto_citations?: Record<string, ReductoCitation | ReductoCitation[] | null>;
}


// ---------------------------------------------------------------------------
// Adapter output — what mapReductoExtractToSotr produces before DB writes.
// ---------------------------------------------------------------------------

export interface NewSourceEvidence {
  document_id: string;
  protocol_version?: string | null;
  page_number?: number | null;
  section_number?: string | null;
  section_title?: string | null;
  /** Sensitive — do not log. */
  quoted_text?: string | null;
  text_start_offset?: number | null;
  text_end_offset?: number | null;
  bounding_boxes?: BoundingBox[] | null;
  confidence_score?: number | null;
  support_type: EvidenceSupportType;
  extraction_run_id?: string | null;
}

export interface NewExtractedItem {
  document_id: string;
  field_path: string;
  field_type: string;
  extracted_value: unknown;
  confidence_state: ConfidenceState;
  confidence_score?: number | null;
  confidence_reason?: string | null;
  ambiguity_reason?: string | null;
  missing_source_reason?: MissingSourceReason | null;
}

export interface NewItemEvidenceLink {
  /** Index into AdapterOutput.items. */
  item_index: number;
  /** Index into AdapterOutput.evidence. */
  evidence_index: number;
  is_primary_source: boolean;
  relevance_score?: number | null;
}

export interface AdapterOutput {
  items: NewExtractedItem[];
  evidence: NewSourceEvidence[];
  links: NewItemEvidenceLink[];
}


// ---------------------------------------------------------------------------
// Review-screen API response shapes (PR-2).
//
// These are the response shapes returned by sotr_get_worksheet_item_evidence
// and sotr_get_worksheet_items_evidence_batch. They use snake_case to match
// the JSON the RPCs produce; the worksheet review UI renders them directly.
// ---------------------------------------------------------------------------

/** Single source evidence record as it appears in the review-screen response. */
export interface SourceEvidenceForReview {
  id: string;
  support_type: EvidenceSupportType;
  protocol_document_id: string;
  protocol_version: string | null;
  page_number: number | null;
  section_number: string | null;
  section_title: string | null;
  /** Sensitive — never log. Returned to the authorized caller for display. */
  source_text: string | null;
  text_start_offset: number | null;
  text_end_offset: number | null;
  /** Always an array — empty when Reducto did not provide coordinates. */
  bounding_boxes: BoundingBox[];
  extraction_confidence: number | null;
  relevance_score: number | null;
  is_primary: boolean;
}

/** Worksheet item + its source evidence list. */
export interface WorksheetItemSourceEvidence {
  worksheet_item_id: string;
  confidence_state: ConfidenceState;
  confidence_score: number | null;
  confidence_reason: string | null;
  ambiguity_reason: string | null;
  /**
   * Sources sorted by support_type (primary → secondary → context → conflict),
   * then relevance_score DESC, then created_at ASC. Empty when no evidence
   * has been linked yet.
   */
  sources: SourceEvidenceForReview[];
  missing_source_reason: MissingSourceReason | null;
}

/** Batch response — items returned in DB order; missing/inaccessible IDs omitted. */
export interface WorksheetItemsSourceEvidenceBatch {
  items: WorksheetItemSourceEvidence[];
}

/** Maximum worksheet item IDs accepted by the batch endpoint. */
export const MAX_WORKSHEET_ITEM_BATCH_SIZE = 100;
