// =============================================================================
// types/deliverables — Protocol Deliverable Engine (shared, non-mode).
//
// The engine turns already-extracted protocol facts (SOTR's
// protocol_extracted_items + protocol_source_evidence) into structured,
// evidence-linked, reviewable draft artifacts. "Parse once, generate many":
// role lenses (Sponsor intelligence, CRA focus, SIV packages) are configs
// over this one layer — never a second extraction pipeline.
//
// DB mirrors: supabase/migrations/*_protocol_deliverables_schema.sql.
// Design + decisions: plans/fable/monitoring-prep-checklist.md.
//
// Isolation note: this file is self-contained on purpose. It does NOT import
// from src/types/sotr — clients read server-denormalized packets, so the
// tiny enums SOTR shares (confidence) are re-declared here rather than
// coupling the namespaces.
// =============================================================================

// -----------------------------------------------------------------------------
// Enums (mirror Postgres enums exactly)
// -----------------------------------------------------------------------------

/** Mirror of deliverable_artifact_type. Future kinds (siv_package, ...)
 *  extend the enum — never fork tables. */
export type DeliverableArtifactType =
  | 'monitoring_prep_checklist'
  | 'risk_overview'
  | 'cra_monitoring_focus'
  | 'siv_package'
  | 'site_training_priorities';

export const ARTIFACT_TYPE_LABELS: Record<DeliverableArtifactType, string> = {
  monitoring_prep_checklist: 'Monitoring Prep Checklist',
  risk_overview: 'Risk Overview',
  cra_monitoring_focus: 'CRA Monitoring Focus',
  siv_package: 'SIV Package',
  site_training_priorities: 'Site Training Priorities',
};

/**
 * Mirror of deliverable_content_origin — the 3-way taxonomy. Never blurred:
 * - protocol_fact: selected verbatim/near-verbatim from an extracted item;
 *   MUST carry evidence linkage + confidence.
 * - derived_operational_framing: deterministic template prose organizing
 *   facts (section intros, coverage-gap notices, window prose, site
 *   questions); carries NO confidence and no false provenance.
 * - human_editorial: user-authored; never overwritten by regeneration.
 */
export type DeliverableContentOrigin =
  | 'protocol_fact'
  | 'derived_operational_framing'
  | 'human_editorial';

/**
 * Mirror of deliverable_review_state. Draft-only vocabulary — there is no
 * "approved" state anywhere in the engine (PIQC is not a system of record).
 * - draft: as generated, untouched.
 * - needs_review: flagged by a human.
 * - reviewed: human sign-off that the draft item is ready (NOT approval).
 * - edited: text modified (version bumped; current_text set).
 * - rejected: removed from render/export but preserved in DB so
 *   regeneration does not resurrect it. (Parser-origin blocks are rejected,
 *   not deleted; hard delete is reserved for human_added blocks.)
 * - human_added: created by a human (content_origin = human_editorial).
 */
export type DeliverableReviewState =
  | 'draft'
  | 'needs_review'
  | 'reviewed'
  | 'edited'
  | 'rejected'
  | 'human_added';

/** Block roles inside an artifact. */
export type DeliverableBlockType =
  | 'checklist_item'
  | 'section_intro'
  | 'site_question'
  /** Teaching prose for the SIV deck's notes band — reviewable like any
   *  other block, always carrying the sponsor-confirmation warning. */
  | 'speaker_note';

/** Re-declaration of SOTR's confidence_state values (see isolation note). */
export type DeliverableConfidenceState =
  | 'high'
  | 'medium'
  | 'low'
  | 'needs_review';

/** Audit-trail actions recorded in deliverable_block_edits. */
export type DeliverableEditAction =
  | 'mark_reviewed'
  | 'unmark_reviewed'
  | 'edit_text'
  | 'add_note'
  | 'flag'
  | 'reject_block'
  | 'add_block'
  | 'delete_block';

/** Review actions accepted by deliverable_set_block_review. */
export type DeliverableReviewAction =
  | 'mark_reviewed'
  | 'unmark_reviewed'
  | 'flag'
  | 'add_note'
  | 'reject_block';

// -----------------------------------------------------------------------------
// Monitoring Preparation Checklist — section vocabulary
// -----------------------------------------------------------------------------

export type MonitoringChecklistSectionKey =
  | 'eligibility_verification'
  | 'exclusion_prohibited_med_review'
  | 'visit_window_verification'
  | 'endpoint_critical_checks'
  | 'arm_cohort_randomization_deps'
  | 'safety_specimen_imaging_vendor_checks'
  | 'source_doc_focus'
  | 'amendment_sensitive'
  | 'site_questions';

/** Stable render + export order for checklist sections. */
export const MONITORING_SECTION_ORDER: readonly MonitoringChecklistSectionKey[] = [
  'eligibility_verification',
  'exclusion_prohibited_med_review',
  'visit_window_verification',
  'endpoint_critical_checks',
  'arm_cohort_randomization_deps',
  'safety_specimen_imaging_vendor_checks',
  'source_doc_focus',
  'amendment_sensitive',
  'site_questions',
];

export const MONITORING_SECTION_LABELS: Record<MonitoringChecklistSectionKey, string> = {
  eligibility_verification: 'Eligibility Verification Focus',
  exclusion_prohibited_med_review: 'Exclusion & Prohibited Medication Review',
  visit_window_verification: 'Visit Window Verification',
  endpoint_critical_checks: 'Endpoint-Critical Procedure Checks',
  arm_cohort_randomization_deps: 'Arm / Cohort / Randomization Dependencies',
  safety_specimen_imaging_vendor_checks: 'Safety, Specimen, Imaging & Vendor Checks',
  source_doc_focus: 'Source Documentation Focus Areas',
  amendment_sensitive: 'Amendment-Sensitive Requirements',
  site_questions: 'Site Questions to Consider',
};

// -----------------------------------------------------------------------------
// Risk Overview — section vocabulary (handover §6.1-A: explainable
// complexity factors, never opaque risk scores)
// -----------------------------------------------------------------------------

export type RiskOverviewSectionKey =
  | 'eligibility_complexity'
  | 'visit_window_pressure'
  | 'endpoint_critical_procedures'
  | 'vendor_lab_imaging_dependencies'
  | 'coordination_burden'
  | 'amendment_sensitivity';

/** Stable render order for risk-overview sections. */
export const RISK_SECTION_ORDER: readonly RiskOverviewSectionKey[] = [
  'eligibility_complexity',
  'visit_window_pressure',
  'endpoint_critical_procedures',
  'vendor_lab_imaging_dependencies',
  'coordination_burden',
  'amendment_sensitivity',
];

export const RISK_SECTION_LABELS: Record<RiskOverviewSectionKey, string> = {
  eligibility_complexity: 'Eligibility Complexity',
  visit_window_pressure: 'Visit Window Pressure',
  endpoint_critical_procedures: 'Endpoint-Critical Procedures',
  vendor_lab_imaging_dependencies: 'Vendor, Lab & Imaging Dependencies',
  coordination_burden: 'Coordination Burden',
  amendment_sensitivity: 'Amendment Sensitivity',
};

// -----------------------------------------------------------------------------
// CRA Monitoring Focus — section vocabulary (handover §6.1-D: attention
// allocation for a monitor's limited on-site time, never opaque risk scores)
// -----------------------------------------------------------------------------

export type CraFocusSectionKey =
  | 'eligibility_verification_emphasis'
  | 'fragile_visit_windows'
  | 'endpoint_critical_verification'
  | 'vendor_specimen_workflows'
  | 'amendment_sensitive_requirements';

/** Stable render order for CRA-focus sections. */
export const CRA_FOCUS_SECTION_ORDER: readonly CraFocusSectionKey[] = [
  'eligibility_verification_emphasis',
  'fragile_visit_windows',
  'endpoint_critical_verification',
  'vendor_specimen_workflows',
  'amendment_sensitive_requirements',
];

export const CRA_FOCUS_SECTION_LABELS: Record<CraFocusSectionKey, string> = {
  eligibility_verification_emphasis: 'Eligibility Verification Emphasis',
  fragile_visit_windows: 'Fragile Visit Windows',
  endpoint_critical_verification: 'Endpoint-Critical Verification',
  vendor_specimen_workflows: 'Vendor & Specimen Workflows',
  amendment_sensitive_requirements: 'Amendment-Sensitive Requirements',
};

// -----------------------------------------------------------------------------
// SIV Knowledge Transfer Package — section vocabulary (handover §6.4: a
// protocol-specific teaching outline, never a generic table-of-contents deck;
// every block sponsor-reviewable before anything is presented)
// -----------------------------------------------------------------------------

export type SivSectionKey =
  | 'study_overview'
  | 'participant_journey'
  | 'eligibility_emphasis'
  | 'endpoint_critical'
  | 'windows_and_timing'
  | 'vendor_lab_workflows'
  | 'safety_expectations'
  | 'amendment_changes'
  | 'before_first_patient';

/** Stable slide order for the SIV package (teaching order). */
export const SIV_SECTION_ORDER: readonly SivSectionKey[] = [
  'study_overview',
  'participant_journey',
  'eligibility_emphasis',
  'endpoint_critical',
  'windows_and_timing',
  'vendor_lab_workflows',
  'safety_expectations',
  'amendment_changes',
  'before_first_patient',
];

export const SIV_SECTION_LABELS: Record<SivSectionKey, string> = {
  study_overview: 'Study Purpose & Design',
  participant_journey: 'Participant Journey & Visit Schedule',
  eligibility_emphasis: 'Eligibility & Prohibited Medications',
  endpoint_critical: 'Endpoint-Critical Procedures',
  windows_and_timing: 'Visit Windows & Timing',
  vendor_lab_workflows: 'Laboratory, Specimen & Vendor Workflows',
  safety_expectations: 'Safety & Reporting Expectations',
  amendment_changes: 'Amendment Changes',
  before_first_patient: 'Before the First Patient',
};

// -----------------------------------------------------------------------------
// Site Training Priorities — section vocabulary (handover §6.1: what the site
// must be trained on before activation, in an instructional register — never
// the checklist's imperative "verify" voice or a numeric readiness score)
// -----------------------------------------------------------------------------

export type SiteTrainingSectionKey =
  | 'eligibility_screening_training'
  | 'visit_schedule_training'
  | 'procedure_specimen_training'
  | 'endpoint_data_training'
  | 'safety_oversight_training'
  | 'amendment_retraining'
  | 'training_logistics_questions';

/** Stable render order for site-training-priorities sections (training order:
 *  screening → schedule → procedures → data → safety → change → logistics). */
export const SITE_TRAINING_SECTION_ORDER: readonly SiteTrainingSectionKey[] = [
  'eligibility_screening_training',
  'visit_schedule_training',
  'procedure_specimen_training',
  'endpoint_data_training',
  'safety_oversight_training',
  'amendment_retraining',
  'training_logistics_questions',
];

export const SITE_TRAINING_SECTION_LABELS: Record<SiteTrainingSectionKey, string> = {
  eligibility_screening_training: 'Eligibility & Screening Training',
  visit_schedule_training: 'Visit Schedule & Timing Training',
  procedure_specimen_training: 'Procedure, Specimen & Vendor Training',
  endpoint_data_training: 'Endpoint Data & Source-Documentation Training',
  safety_oversight_training: 'Safety Reporting & Oversight Training',
  amendment_retraining: 'Amendment Retraining',
  training_logistics_questions: 'Training Logistics — Questions for the Site',
};

// -----------------------------------------------------------------------------
// UI label maps
// -----------------------------------------------------------------------------

export const CONTENT_ORIGIN_LABELS: Record<DeliverableContentOrigin, string> = {
  protocol_fact: 'Protocol fact',
  derived_operational_framing: 'PIQC framing',
  human_editorial: 'Human note',
};

export const REVIEW_STATE_LABELS: Record<DeliverableReviewState, string> = {
  draft: 'Draft',
  needs_review: 'Needs review',
  reviewed: 'Reviewed',
  edited: 'Edited',
  rejected: 'Removed',
  human_added: 'Added by reviewer',
};

export const CONFIDENCE_LABELS: Record<DeliverableConfidenceState, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  needs_review: 'Needs review',
};

// -----------------------------------------------------------------------------
// DB row mirrors
// -----------------------------------------------------------------------------

/** Mirror of protocol_deliverables. One row per (protocol, artifact_type). */
export interface DeliverableRecord {
  id: string;
  protocol_id: string;
  artifact_type: DeliverableArtifactType;
  title: string;
  /** Protocol version label stamped at generate time (nullable — parser may
   *  not have extracted one). */
  protocol_version: string | null;
  generated_by: string | null;
  generated_at: string;
  regenerated_at: string | null;
  /** Incremented by every generate; blocks born in the latest run carry the
   *  same value (the "new since previous generation" signal). */
  generation_seq: number;
  created_at: string;
  updated_at: string;
}

/** Mirror of protocol_deliverable_blocks. */
export interface DeliverableBlockRecord {
  id: string;
  deliverable_id: string;
  section_key: string;
  block_type: DeliverableBlockType;
  content_origin: DeliverableContentOrigin;
  /** Parser/framing text, frozen at generate time. NULL for human_added. */
  derived_text: string | null;
  /** Human edit overlay. Display text = COALESCE(current_text, derived_text). */
  current_text: string | null;
  /** FK to protocol_extracted_items — protocol_fact blocks only. */
  extracted_item_id: string | null;
  /** FK to protocol_source_evidence (primary evidence) — facts only. */
  source_evidence_id: string | null;
  /** Denormalized at generate time (SECURITY DEFINER) so INVOKER read RPCs
   *  never need to join owner-gated SOTR tables. SENSITIVE — never log. */
  source_quote: string | null;
  source_page_number: number | null;
  source_section: string | null;
  /** NULL for framing / human blocks — framing never claims confidence. */
  confidence_state: DeliverableConfidenceState | null;
  review_state: DeliverableReviewState;
  review_note: string | null;
  protocol_version: string | null;
  sort_order: number;
  /** Starts at 1; bumped by edit_text. */
  version: number;
  /** The deliverable generation this block was born in (matched blocks keep
   *  their birth seq across regenerates). */
  generation_seq: number;
  created_at: string;
  updated_at: string;
}

/** Mirror of deliverable_block_edits (append-only audit trail). */
export interface DeliverableBlockEditRecord {
  id: string;
  block_id: string;
  reviewer_id: string;
  action: DeliverableEditAction;
  previous_text: string | null;
  new_text: string | null;
  /** SENSITIVE — never log. */
  reviewer_note: string | null;
  block_version: number;
  protocol_version: string | null;
  created_at: string;
}

// -----------------------------------------------------------------------------
// Packet shapes — what deliverable_get_packet returns (self-contained JSON;
// the client never touches SOTR tables or types).
// -----------------------------------------------------------------------------

export interface DeliverablePacketBlock {
  id: string;
  section_key: string;
  block_type: DeliverableBlockType;
  content_origin: DeliverableContentOrigin;
  /** COALESCE(current_text, derived_text) — resolved server-side. */
  display_text: string;
  derived_text: string | null;
  current_text: string | null;
  source_evidence_id: string | null;
  /** SENSITIVE — never log. */
  source_quote: string | null;
  source_page_number: number | null;
  source_section: string | null;
  confidence_state: DeliverableConfidenceState | null;
  review_state: DeliverableReviewState;
  review_note: string | null;
  version: number;
  sort_order: number;
  /** Birth generation. New-in-latest-run iff equal to the packet's
   *  generation_seq (and that is > 1 — the first generation is birth, not
   *  change). Degrades to 1 when the DB predates the amendment-refresh
   *  migration. */
  generation_seq: number;
}

export interface DeliverablePacket {
  deliverable_id: string;
  protocol_id: string;
  artifact_type: DeliverableArtifactType;
  title: string;
  protocol_version: string | null;
  generated_at: string;
  regenerated_at: string | null;
  /** Current generation number (see block-level generation_seq). Degrades
   *  to 1 on pre-migration packets. */
  generation_seq: number;
  /** Rejected blocks are EXCLUDED server-side — they exist only in the DB
   *  (and the edit log) so regeneration will not resurrect them. */
  blocks: DeliverablePacketBlock[];
}

/**
 * Export packet (deliverable_export_packet): trimmed + server-stamped.
 * Deliberately sponsor-name-free — the RPC never selects protocols.sponsor.
 */
export interface DeliverableExportPacket {
  deliverable_id: string;
  protocol_code: string | null;
  protocol_title: string;
  artifact_type: DeliverableArtifactType;
  title: string;
  protocol_version: string | null;
  /** Server-stamped at export-fetch time; used for the filename date. */
  generated_at: string;
  blocks: DeliverablePacketBlock[];
}

// -----------------------------------------------------------------------------
// Amendment-aware refresh — generation log + change summary
// (deliverable_generation_log + deliverable_get_change_summary)
// -----------------------------------------------------------------------------

/** Snapshot of a pristine draft block the regenerate deleted — the only
 *  record it existed. Touched blocks are never deleted, so nothing
 *  human-authored or human-reviewed lives only here. */
export interface RemovedBlockSnapshot {
  section_key: string;
  block_type: DeliverableBlockType;
  derived_text: string;
}

/** Mirror of deliverable_generation_log (append-only, one row per generate). */
export interface DeliverableGenerationLog {
  id: string;
  deliverable_id: string;
  generation_seq: number;
  protocol_version: string | null;
  generated_by: string | null;
  generated_at: string;
  blocks_created: number;
  blocks_matched: number;
  blocks_kept_flagged: number;
  blocks_deleted: number;
  removed_blocks: RemovedBlockSnapshot[];
}

/** One entry in the change summary's new/flagged lists. */
export interface ChangeSummaryBlockRef {
  id: string;
  section_key: string;
  display_text: string;
}

/** deliverable_get_change_summary result. log is null before the first
 *  generate (no deliverable → the RPC itself returns null instead). */
export interface DeliverableChangeSummary {
  log: DeliverableGenerationLog | null;
  new_blocks: ChangeSummaryBlockRef[];
  flagged_blocks: ChangeSummaryBlockRef[];
  removed_blocks: RemovedBlockSnapshot[];
}

// -----------------------------------------------------------------------------
// Mutation results (returned by the review/edit RPC wrappers)
// -----------------------------------------------------------------------------

export interface DeliverableBlockMutationResult {
  block_id: string;
  review_state: DeliverableReviewState;
  version: number;
  edit_id: string;
}

export interface DeliverableGenerateResult {
  deliverable_id: string;
  blocks_created: number;
  blocks_preserved: number;
}

// -----------------------------------------------------------------------------
// Shared Result<T> for the deliverables API layers
// (canonical shape — see src/lib/site/siteApi.ts)
// -----------------------------------------------------------------------------

export type DeliverablesResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Display text for a block row: human edit wins over the frozen derived text. */
export function displayTextForBlock(
  block: Pick<DeliverableBlockRecord, 'current_text' | 'derived_text'>,
): string {
  return block.current_text ?? block.derived_text ?? '';
}

/** Group packet blocks by section in the given order, hiding empty sections
 *  (mirrors the VEW phase-grouping discipline). Generic over the section-key
 *  vocabulary — pass MONITORING_SECTION_ORDER or RISK_SECTION_ORDER; each
 *  artifact type owns its own order + labels. */
export function groupBlocksBySection<K extends string>(
  blocks: DeliverablePacketBlock[],
  order: readonly K[],
): Array<{ sectionKey: K; blocks: DeliverablePacketBlock[] }> {
  const bySection = new Map<string, DeliverablePacketBlock[]>();
  for (const block of blocks) {
    const list = bySection.get(block.section_key);
    if (list) {
      list.push(block);
    } else {
      bySection.set(block.section_key, [block]);
    }
  }
  const grouped: Array<{ sectionKey: K; blocks: DeliverablePacketBlock[] }> = [];
  for (const sectionKey of order) {
    const sectionBlocks = bySection.get(sectionKey);
    if (sectionBlocks && sectionBlocks.length > 0) {
      grouped.push({
        sectionKey,
        blocks: [...sectionBlocks].sort((a, b) => a.sort_order - b.sort_order),
      });
    }
  }
  return grouped;
}
