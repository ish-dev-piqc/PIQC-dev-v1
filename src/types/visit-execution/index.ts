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

/**
 * Parser/LLM confidence for an extracted artifact ("how sure is the parser
 * that this thing is correct"). Same string values as SOTR's ConfidenceState
 * but DUPLICATED here rather than imported — per CLAUDE.md mode-isolation
 * rule, the visit-execution namespace doesn't import from sotr/. Keep these
 * in sync by convention.
 *
 * Used by:
 *   - VisitSnapshot.confidence_state    (visit-level extraction)
 *   - VisitExecutionItem.confidence_state (per-requirement extraction)
 *   - VisitCompletenessSignal.detection_confidence (DIFFERENT semantic —
 *     answers "is this detected gap real?" not "is this correct?". Same enum
 *     values for now; kept under a distinct field name to avoid confusion.)
 *
 * Sprint 3.5a: NULL on the wire is allowed (pre-Sprint-3.5b rows have no
 * confidence yet). Callers handle the nullable case.
 */
export type VisitConfidenceState = 'high' | 'medium' | 'low' | 'needs_review';


/**
 * Resolution state of a `visit_completeness_signals` row. Mirrors the
 * `visit_signal_resolution` Postgres enum (Sprint 3.5a migration
 * 20260615000100_visit_signal_resolution_enum.sql).
 *
 * `pending` is the only state the parser writes. Sprint 4c's
 * resolveSignal mutation transitions a row to one of the two human-chosen
 * terminal states.
 */
export type VisitSignalResolution =
  | 'pending'
  | 'added_as_requirement'
  | 'dismissed_not_real';

/**
 * The two human-driven resolutions resolveSignal accepts. The DB-level
 * enum includes 'pending' as a third value but it's never a valid input —
 * the RPC rejects it. Modeling that constraint at the type layer prevents
 * a class of UI bugs (e.g. a default `resolution: 'pending'` slipping
 * through from a stale state).
 */
export type VisitSignalHumanResolution = Exclude<VisitSignalResolution, 'pending'>;


/**
 * Action enum mirroring the DB-level `visit_requirement_edit_action` enum
 * (Sprint 2.5 migration 20260601000500_visit_requirement_human_edits_table.sql).
 * Each value corresponds to a row in `visit_requirement_human_edits.action`.
 *
 * Used by the Sprint 4c EditLogDrawer to drive event-row rendering:
 *   - edit_text uses previous_text/new_text for a before/after diff
 *   - add_site_note shows reviewer_note as the body
 *   - All others render as a single-line status change
 */
export type VisitRequirementHumanEditAction =
  | 'mark_reviewed'
  | 'unmark_reviewed'
  | 'edit_text'
  | 'add_site_note'
  | 'flag_for_review'
  | 'mark_needs_clarification';


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
/**
 * A gap flagged by the Sprint 3.5b missing-requirement detection pass — a
 * requirement the second-pass LLM believes the protocol mandates for this
 * visit but the first-pass extract didn't surface.
 *
 * Sprint 3.5a: the RPC returns an empty array on every visit until 3.5b's
 * ingest pipeline writes to visit_completeness_signals. Frontend renders
 * nothing when empty.
 *
 * PIQC never auto-promotes a signal to a real requirement — that's a
 * future Sprint 4 human action.
 */
export interface VisitCompletenessSignal {
  id: string;
  gap_text: string;
  source_section: string | null;
  source_page: number | null;
  detection_confidence: VisitConfidenceState;
  detection_reason: string | null;
  /** ISO 8601 timestamp from the server. */
  detected_at: string;
}

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
  /**
   * The row's display text: COALESCE(current_text, derived_text). Always
   * populated. When `current_text` exists and differs from `derived_text`,
   * this is the human-edited version.
   */
  label: string;
  /**
   * Sprint 4b addition. The parser's frozen `derived_text` — distinct from
   * `label` (which may be the human-edited current_text). UI uses
   * derived_text to render the drift hint when label !== derived_text.
   *
   * Null in mock-mode rows from before Sprint 4b's fixture update, and
   * null on rows where the RPC didn't surface the field (defensive — the
   * v3 RPC always populates it, but front-end shouldn't crash on legacy
   * payloads).
   */
  derived_text: string | null;
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
  /**
   * Parser/LLM confidence in this item's extraction. NULL when no extracted
   * item is linked (e.g. mock-mode rows or human-promoted from a signal).
   * Surfaced on the row by Sprint 4 — Sprint 3.5a is type-only.
   */
  confidence_state: VisitConfidenceState | null;
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
  /**
   * Parser/LLM confidence in this visit's structured extraction
   * (procedures_structured, window, purpose). NULL until Sprint 3.5b populates
   * the column. Surfaced on the snapshot card by Sprint 4 — 3.5a is type-only.
   *
   * Same SOTR enum as `VisitExecutionItem.confidence_state` and the existing
   * `protocol_extracted_items.confidence_state`. Visit-level reflects pipeline
   * confidence; item-level reflects extracted_item confidence. When they
   * disagree, the snapshot card shows this one (visit-level rollup).
   */
  confidence_state: VisitConfidenceState | null;
  /**
   * Count rollup of pending completeness signals — saves consumers from
   * filtering the array for chip badges and navigator counters. Same
   * count-then-array pattern as `conditional_item_count`.
   */
  completeness_signal_count: number;
  /**
   * Detected gaps for this visit that haven't been resolved yet. Empty array
   * until Sprint 3.5b's missing-requirement detection pass writes rows.
   * Surfaced on the snapshot by Sprint 4.
   */
  completeness_signals: VisitCompletenessSignal[];
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

/**
 * One row in `visit_requirement_human_edits` as surfaced by
 * `visit_execution_get_human_edit_log`. The RPC returns events newest-first.
 *
 * `previous_text` / `new_text` are only populated when `action === 'edit_text'`;
 * `reviewer_note` may be populated on any action (the audit pattern allows
 * a coordinator to attach a note to a flag, clarification request, etc.).
 *
 * `reviewer_id` is the raw `auth.users.id` UUID — Sprint 4c renders it
 * as-is (no display-name lookup yet; that's a follow-up that may join
 * to a `user_profiles` table).
 */
export interface VisitRequirementHumanEditEvent {
  id: string;
  action: VisitRequirementHumanEditAction;
  reviewer_id: string;
  previous_text: string | null;
  new_text: string | null;
  reviewer_note: string | null;
  requirement_version: number;
  amendment_version: string | null;
  /** ISO 8601 timestamp from the server. */
  created_at: string;
}


/**
 * Return shape of `visit_execution_resolve_completeness_signal`.
 *
 * `requirement_id` is non-null only for the `added_as_requirement`
 * resolution. `already_resolved` is `true` when the RPC observed the
 * signal was no longer pending (idempotency guard against double-click
 * races) — in that case the surfaced `resolution` reflects whatever
 * terminal state the signal was already in.
 */
export interface VisitSignalResolutionResult {
  signal_id: string;
  resolution: VisitSignalResolution;
  requirement_id: string | null;
  already_resolved: boolean;
}


export function defaultExpandedPhases(snapshot: VisitSnapshot): ExecutionPhase[] {
  if (snapshot.is_dosing_visit) {
    return ['dosing', 'post_dose'];
  }
  if (snapshot.has_safety_critical) {
    return ['safety_ae_conmed'];
  }
  return ['assessment'];
}
