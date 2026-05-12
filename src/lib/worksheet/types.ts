// =============================================================================
// worksheet_bundle types — Sprint 1B
// Schema version: "1.0"
//
// Design rules:
//   - Every field uses MaybeCited<T>: either a value with provenance citations,
//     or an explicit null with a reason. Silent defaults are prohibited.
//   - Citations are frozen snapshots at compile time (no chunk_id FK).
//     Stable across re-ingest events.
//   - schedule_variant is a free string — whatever the document says, no enum.
//   - criticality_ref is always null in Sprint 1B; linked in Sprint 1C.
// =============================================================================

export type EndpointTier = 'primary' | 'secondary' | 'safety' | 'exploratory';

// A frozen citation snapshot from a Reducto extract.
// Stored at compile time so the worksheet survives re-ingest without losing provenance.
export interface WorksheetCitation {
  document_id: string;
  document_title: string;
  page: number;                   // bbox.original_page from Reducto
  bbox?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  section_heading: string | null;
  chunk_preview: string;          // citation.content from Reducto — frozen at compile time
  confidence: 'high' | 'low' | 'unverified';
  extract_confidence: number | null;
}

// Every worksheet field is either a cited value or an explicit missing marker.
// Using { value: null } with a reason prevents silent empty-string / 0 defaults.
export type MaybeCited<T> =
  | { value: T; citations: WorksheetCitation[] }
  | { value: null; reason: string; expected_source: string };

export interface SourceDocumentRef {
  document_id: string;
  document_title: string;
  document_status: string;
  included_at: string; // ISO 8601
}

export interface ProtocolMetadata {
  title: MaybeCited<string>;
  study_number: MaybeCited<string>;
  sponsor_name: MaybeCited<string>;
  study_phase: MaybeCited<string>;
  is_amendment: boolean;
  amendment_summary: MaybeCited<string | null>;
}

export interface ObjectiveEntry {
  text: MaybeCited<string>;
  objective_type: 'primary' | 'secondary';
  // null until Sprint 1C links protocol_risk_objects to objectives
  tier: MaybeCited<EndpointTier | null>;
}

export interface EligibilitySection {
  inclusion: MaybeCited<string>[];
  exclusion: MaybeCited<string>[];
}

export interface ProcedureEntry {
  label: string;
  // null until Sprint 1C links procedure labels to protocol_risk_objects
  criticality_ref: EndpointTier | null;
  // document-level provenance only in Sprint 1B; chunk-level citations deferred to Sprint 1C
  citations: WorksheetCitation[];
}

export interface VisitEntry {
  visit_name: MaybeCited<string>;
  study_day: MaybeCited<number>;
  window_minus_days: MaybeCited<number>;
  window_plus_days: MaybeCited<number>;
  // Which SOA schedule variant this visit belongs to (e.g. "All Subjects", "PK Substudy").
  // Null if the document uses a single schedule for all subjects.
  schedule_variant: string | null;
  procedures: ProcedureEntry[];
  source_document_id: string | null;
}

// A QA entry for any field the compiler could not populate, or populated with low confidence.
export interface QaEntry {
  field_path: string;       // dot-notation, e.g. "visits[Visit 3].window_minus_days"
  reason: string;
  expected_source: string;
  recoverable: boolean;     // true if a coordinator override can correct it
}

// Records how a group of duplicate visit entries was resolved.
export interface DeduplicationEvent {
  visit_name: string;
  sources_found: number;
  winning_source: 'inline_section' | 'soa_table' | 'template_only' | 'manual';
  reason: string;
}

// Records when Source A (SOA table) and Source B (inline section) both have
// non-zero values for the same field but they disagree.
// The winning value is always preserved; the discrepancy is surfaced for human review.
export interface DiscrepancyEvent {
  visit_name: string;
  field: string;
  source_a_value: number | string | null;
  source_b_value: number | string | null;
  winning_value: number | string | null;
  context: string;
}

export interface QaLedger {
  missing_fields: QaEntry[];
  low_confidence_fields: QaEntry[];
  deduplication_events: DeduplicationEvent[];
  discrepancy_events: DiscrepancyEvent[];
}

export interface WorksheetBundle {
  bundle_version: '1.0';
  protocol_version_id: string;
  compiled_at: string;         // ISO 8601
  compiler_version: string;    // semver — bump on breaking schema changes
  source_documents: SourceDocumentRef[];
  protocol: ProtocolMetadata;
  objectives: ObjectiveEntry[];
  eligibility: EligibilitySection;
  visits: VisitEntry[];
  qa_ledger: QaLedger;
}
