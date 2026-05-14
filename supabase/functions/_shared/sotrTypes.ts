// =============================================================================
// SOTR types — Deno copy.
//
// Mirrors the subset of src/types/sotr/index.ts needed by the adapter. Kept
// minimal: only the types mapReductoExtractToSotr actually references. The
// canonical types file in src/types/sotr/index.ts is the source of truth;
// when adding fields, update both.
//
// Why duplicate: Supabase edge functions run on Deno and cannot import from
// the Vite/React src/ tree at deploy time. The adapter is pure, so a literal
// copy is safer and simpler than wiring import maps.
// =============================================================================

export type EvidenceSupportType = 'primary' | 'secondary' | 'context' | 'conflict';

export type ConfidenceState = 'high' | 'medium' | 'low' | 'needs_review';

export type MissingSourceReason =
  | 'parser_output_missing_citation'
  | 'source_text_not_found'
  | 'protocol_version_mismatch'
  | 'coordinates_unavailable'
  | 'evidence_conflict'
  | 'unknown';

export interface BoundingBox {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ReductoCitation {
  /** Quoted source text from the protocol. Treat as sensitive — do not log. */
  text?: string;
  pages?: number[];
  confidence?: 'high' | 'medium' | 'low';
  section?: string;
  bbox?: BoundingBox[];
}

export interface ReductoExtractResponse {
  [field: string]: unknown;
  _reducto_citations?: Record<string, ReductoCitation | ReductoCitation[] | null>;
}

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
  missing_source_reason: MissingSourceReason | null;
}

export interface NewItemEvidenceLink {
  /** 0-based index into AdapterOutput.items. */
  item_index: number;
  /** 0-based index into AdapterOutput.evidence. */
  evidence_index: number;
  is_primary_source: boolean;
  relevance_score?: number | null;
}

export interface AdapterOutput {
  items: NewExtractedItem[];
  evidence: NewSourceEvidence[];
  links: NewItemEvidenceLink[];
}
