// =============================================================================
// Visit Execution Workspace — TypeScript types.
//
// Sprint 1: these types are implemented by the mock fixture
// (src/lib/visit-execution/mockVisitWorkspace.ts) behind the
// piq-visit-execution-mock-v1 localStorage toggle. The mock IS the Sprint 2
// schema spec — every field here maps to a future column on
// protocol_visit_templates or JSONB key on protocol_extracted_items.
//
// Naming uses "draft" / "execution prep" language deliberately. PIQC is a
// protocol-intelligence and draft-generation aid — not a final source
// document authoring system, not e-signature, not Part 11 / GxP.
// =============================================================================


// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * The execution phase a checklist item belongs to. Phases mirror how a
 * site coordinator actually runs a visit — pre-visit prep, check-in,
 * assessments, dosing, etc. Empty phases are hidden from the UI.
 *
 * For non-dosing visits, `pre_dose` renders as "Pre-Procedure Requirements"
 * via PHASE_LABELS_NON_DOSING below.
 */
export type ExecutionPhase =
  | 'pre_visit'
  | 'check_in'
  | 'assessment'
  | 'dosing'
  | 'post_dose'
  | 'safety_ae_conmed'
  | 'close_out';

/**
 * Classification of a single execution item. Drives the per-item badge
 * (ExecutionItemClassificationBadge) and informs the navigator-level
 * endpoint-critical / conditional-count indicators.
 */
export type ItemClassification =
  | 'required'
  | 'conditional'
  | 'if_applicable'
  | 'primary_endpoint'
  | 'secondary_endpoint'
  | 'safety_critical';

/**
 * Review state for a single execution item.
 *
 * Sprint 1: client-local state in VisitExecutionTab (useState<Map>).
 * Sprint 2: persisted via a new visit_execution_item_reviews table
 * following the worksheet_review_events append-only event log pattern.
 *
 * Semantically distinct from SOTR's DraftReviewStatus — that tracks
 * "is the parser output accurate?". This tracks "has the site coordinator
 * reviewed this visit requirement for execution readiness?".
 */
export type ExecutionReviewStatus =
  | 'not_reviewed'
  | 'needs_review'
  | 'reviewed'
  | 'edited'
  | 'site_note_added';


// ---------------------------------------------------------------------------
// Phase label maps — visit-type-aware so non-dosing visits don't show
// "Pre-Dose" sections. The component picks the right map based on
// VisitSnapshot.is_dosing_visit.
// ---------------------------------------------------------------------------

export const PHASE_LABELS_DOSING: Record<ExecutionPhase, string> = {
  pre_visit:        'Pre-Visit Preparation',
  check_in:         'Subject Arrival / Check-In',
  assessment:       'Core Visit Procedures',
  dosing:           'Dosing / IMP Administration',
  post_dose:        'Post-Dose Observation',
  safety_ae_conmed: 'Safety / AE / Conmed Review',
  close_out:        'Visit Closeout & Next-Visit Planning',
};

export const PHASE_LABELS_NON_DOSING: Record<ExecutionPhase, string> = {
  pre_visit:        'Pre-Visit Preparation',
  check_in:         'Subject Arrival / Check-In',
  assessment:       'Core Visit Procedures',
  dosing:           'Pre-Procedure Requirements',
  post_dose:        'Post-Procedure Observation',
  safety_ae_conmed: 'Safety / AE / Conmed Review',
  close_out:        'Visit Closeout & Next-Visit Planning',
};

/**
 * Phase render order. Used by ExecutionChecklist to iterate consistently
 * regardless of which phases have items.
 */
export const EXECUTION_PHASE_ORDER: ExecutionPhase[] = [
  'pre_visit',
  'check_in',
  'assessment',
  'dosing',
  'post_dose',
  'safety_ae_conmed',
  'close_out',
];


// ---------------------------------------------------------------------------
// Nested object types
// ---------------------------------------------------------------------------

/**
 * If/then rule derived from protocol footnotes or cross-references.
 *
 * Sprint 1: mock-only — no parser extraction. Sprint 2: either added to
 * CLINICAL_EXTRACT_SCHEMA in the ingest function or derived from
 * protocol_visit_templates.cross_references[].snippet in a post-process step.
 */
export interface ConditionalRule {
  condition_text: string;
  consequence_text: string;
  source_section: string | null;
  source_page: number | null;
}

/**
 * Per-assessment timing constraint. The visit-level window
 * (protocol_visit_templates.window_minus_days / window_plus_days) is
 * separate — this is for finer-grained constraints like
 * "PK sample within 30 min of dosing".
 *
 * Sprint 1: mock-only. Sprint 2: ingest schema extension.
 */
export interface AssessmentTimingConstraint {
  label: string;
  window_before_minutes: number | null;
  window_after_minutes: number | null;
  is_hard_constraint: boolean;
  source_section: string | null;
}

/**
 * Form field scaffold for source document capture during the visit.
 *
 * Sprint 1: mock-only. Sprint 2: either a new `visit_source_fields` table
 * keyed by execution_item_id, or JSONB on protocol_extracted_items.
 */
export interface SourceFieldScaffold {
  field_label: string;
  field_type: 'text' | 'number' | 'boolean' | 'select' | 'date';
  units: string | null;
  normal_range: string | null;
  is_required: boolean;
}

/**
 * Per-item provenance reference. Used by the TraceabilityDrawer.
 *
 * Sprint 1: mock data. Sprint 2: source_evidence_id resolves through the
 * existing extracted_item_id → protocol_item_evidence_links →
 * protocol_source_evidence chain.
 */
export interface VisitItemTraceability {
  /** Column in the Schedule of Assessments table (e.g. "V3"). */
  soa_column: string | null;
  /** Protocol section heading (e.g. "7.2.1 Vital Signs"). */
  protocol_section: string | null;
  protocol_page: number | null;
  /** Protocol amendment label (e.g. "Amendment 2.1"). NULL = original. */
  amendment_version: string | null;
  /** FK to protocol_source_evidence.id — null in Sprint 1. */
  source_evidence_id: string | null;
  /** Verbatim cross-reference snippet from another protocol section. */
  cross_reference_source_section: string | null;
  cross_reference_page: number | null;
  cross_reference_snippet: string | null;
}


// ---------------------------------------------------------------------------
// Main objects
// ---------------------------------------------------------------------------

/**
 * One row in the workflow-ordered execution checklist.
 *
 * The label + classification + timing show in the row at rest.
 * Conditions render as inline amber callouts under the row, collapsed.
 * Source fields hint via a small indicator dot (full scaffold UI is
 * Sprint 2 work — Sprint 1 surfaces the count and label only).
 * Traceability opens the drawer.
 */
export interface VisitExecutionItem {
  id: string;
  /** FK to protocol_extracted_items.id. null in Sprint 1 (mock). */
  extracted_item_id: string | null;
  label: string;
  description: string | null;
  phase: ExecutionPhase;
  classification: ItemClassification;
  /** Empty array = unconditional. */
  conditions: ConditionalRule[];
  /** null = no item-specific timing beyond the visit window. */
  timing: AssessmentTimingConstraint | null;
  source_fields: SourceFieldScaffold[];
  traceability: VisitItemTraceability;
  /** Role hint (e.g. "Coordinator", "Nurse", "Pharmacist"). null = unscoped. */
  role_hint: string | null;
  review_status: ExecutionReviewStatus;
  review_note: string | null;
}

/**
 * Above-the-fold summary of a visit. Counts are derived from items by
 * the adapter — not persisted. Non-zero indicators render as chips;
 * zero-value indicators are hidden by the snapshot card.
 */
export interface VisitSnapshot {
  visit_name: string;
  study_day: number;
  window_minus_days: number;
  window_plus_days: number;
  /** 1-2 sentence prose summary of the visit's purpose. */
  purpose: string;
  is_dosing_visit: boolean;
  has_primary_endpoint: boolean;
  has_safety_critical: boolean;
  item_count: number;
  /** Number of items where conditions[] is non-empty. */
  conditional_item_count: number;
  /** Number of items with classification in {primary_endpoint, secondary_endpoint, safety_critical}. */
  endpoint_critical_count: number;
  needs_review_count: number;
  reviewed_count: number;
  flagged_count: number;
  amendment_version: string | null;
}

/**
 * The full workspace for one visit. The Sprint 1 mock fixture returns
 * an array of these for the active protocol. Sprint 2 will derive these
 * from protocol_visit_templates + protocol_extracted_items via the
 * adapter.
 */
export interface VisitExecutionWorkspace {
  /** FK to protocol_visit_templates.id. */
  visit_template_id: string;
  protocol_id: string;
  snapshot: VisitSnapshot;
  /** Ordered by EXECUTION_PHASE_ORDER, then by intra-phase sequence. */
  items: VisitExecutionItem[];
}


// ---------------------------------------------------------------------------
// Default-expansion logic — pure function used by ExecutionChecklist to
// pick which phases auto-expand on visit selection. Keeps the first-screen
// "collapse cognitive load" promise: 7 phases collapsed by default, 1-2
// auto-opened based on visit type.
// ---------------------------------------------------------------------------

export function defaultExpandedPhases(snapshot: VisitSnapshot): ExecutionPhase[] {
  if (snapshot.is_dosing_visit) {
    return ['dosing', 'post_dose'];
  }
  if (snapshot.has_safety_critical) {
    return ['safety_ae_conmed'];
  }
  return ['assessment'];
}
