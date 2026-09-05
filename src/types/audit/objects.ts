// =============================================================================
// Audit Mode — DB row interfaces (1:1 with Postgres tables)
// Mirrors supabase/migrations/20260427120000_audit_mode_phase_1_schema.sql
//
// Conventions:
//   - Field names match DB column names (snake_case) so Supabase SELECT results
//     can be assigned without conversion.
//   - Postgres TIMESTAMPTZ → string (ISO 8601). DATE → string (yyyy-mm-dd).
//   - Postgres JSONB columns get a typed shape where useful, otherwise
//     Record<string, unknown>.
//   - Nullable columns are typed as `T | null`.
// =============================================================================

import type {
  AuditStage,
  AuditStatus,
  AuditType,
  AuditWorkflowType,
  CapaStatus,
  ClinicalTrialPhase,
  DocumentKind,
  EndpointTier,
  ImpactSurface,
  IsaDomain,
  DerivedCriticality,
  IsaFindingOrigin,
  IsaResponseOwner,
  IsaSeverity,
  IsaSiteVerdict,
  ProtocolVersionStatus,
  ProvisionalImpact,
  QuestionnaireInstanceStatus,
  UserRole,
} from './enums';

// -----------------------------------------------------------------------------
// User profile (wraps auth.users)
// -----------------------------------------------------------------------------
export interface UserProfile {
  id: string;          // matches auth.users.id
  name: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Reference data
// -----------------------------------------------------------------------------
export interface Vendor {
  id: string;
  name: string;
  legal_name: string | null;
  country: string;
  website: string | null;
  created_at: string;
  updated_at: string;
}

// Investigator Site Audit auditee — mirrors Vendor (shared namespace).
// 1:1 with the `sites` table (20260709000000).
export interface Site {
  id: string;
  name: string;
  site_number: string | null;
  principal_investigator: string | null;
  country: string;
  created_at: string;
  updated_at: string;
}

export interface Protocol {
  id: string;
  study_number: string | null;
  title: string;
  sponsor: string;
  created_at: string;
  updated_at: string;
}

export interface ProtocolVersion {
  id: string;
  protocol_id: string;
  version_number: number;
  amendment_label: string | null;
  status: ProtocolVersionStatus;
  effective_date: string | null;            // yyyy-mm-dd
  clinical_trial_phase: ClinicalTrialPhase;
  piqc_protocol_id: string;                 // [PIQC] D-009 — format TBD
  raw_piqc_payload: Record<string, unknown>; // [PIQC] D-009 — opaque
  received_at: string;
  created_at: string;
}

// -----------------------------------------------------------------------------
// Audit
// -----------------------------------------------------------------------------
export interface Audit {
  id: string;
  // Auditee FKs are workflow-exclusive (audits_auditee_matches_workflow CHECK):
  // vendor audits carry vendor_id, investigator site audits carry site_id.
  vendor_id: string | null;
  site_id: string | null;
  protocol_id: string;
  protocol_version_id: string;
  audit_name: string;
  audit_type: AuditType;
  workflow_type: AuditWorkflowType; // which workflow (vendor vs investigator site)
  status: AuditStatus;
  current_stage: AuditStage;
  lead_auditor_id: string;          // auth.users.id
  scheduled_date: string | null;    // yyyy-mm-dd
  scheduled_end_date: string | null; // yyyy-mm-dd; null = single-day (or unscheduled)
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped read model: parse status of the audit protocol's documents.
// Mirrors audit_mode_protocol_document_status(uuid) RETURNS jsonb
// (20260913000000). Counts span every PROTOCOL document pinned to the
// protocol, whoever uploaded it; the own_* fields are the caller's.
// -----------------------------------------------------------------------------
export interface ProtocolDocumentStatus {
  protocol_id: string;
  any_ready: number;
  own_ready: number;
  any_pending: number;
  /** The caller's most recent in-flight upload, or null. The Stage-1 card
   *  polls it, so a parse started elsewhere (new-audit drawer) resumes. */
  own_pending_document_id: string | null;
  /** The caller's most recent failed upload's error_message, or null. */
  own_failed_error: string | null;
  /** Worksheet items across the protocol's ready documents. */
  visible_item_count: number;
}

// -----------------------------------------------------------------------------
// Audit-scoped: vendor risk summary (D-010)
// -----------------------------------------------------------------------------
// Snapshot of protocol context captured at risk-summary creation. Stable across
// later protocol amendments — does not silently update if the version changes.
export interface RiskSummaryStudyContext {
  therapeutic_space: string;
  primary_endpoints: string[];
  secondary_endpoints: string[];
  clinical_trial_phase: ClinicalTrialPhase;
  captured_at: string; // ISO 8601
  /** Where the snapshot came from. Absent on rows created before the
   *  generate-from-protocol flow (hand-typed stub). */
  source?: 'parsed_document' | 'manual';
  /** The ready document the snapshot was captured from; null when manual. */
  source_document_id?: string | null;
}

// -----------------------------------------------------------------------------
// Protocol-version-scoped: how a PIQC-assisted risk was proposed.
// Mirrors protocol_risk_objects.suggestion_provenance (JSONB) as written by
// audit_mode_create_protocol_risk_from_candidate (20260914000000). Identifiers
// and the proposal only — never quoted protocol text — so the History drawer
// can show what PIQC proposed against what the auditor saved. Rows tagged
// MANUAL carry null.
// -----------------------------------------------------------------------------
/** The deterministic rule that produced a candidate (src/lib/audit/riskCandidates.ts). */
export type RiskCandidateRule =
  | 'endpoint_primary'
  | 'endpoint_secondary'
  | 'dosing'
  | 'visit'
  | 'criterion';

export interface SuggestionProvenance {
  source: 'sotr_item';
  rule: RiskCandidateRule;
  /** SOTR item coordinates at derivation time (snapshot, not a live join). */
  field_path: string;
  field_type: string;
  confidence_state: string;
  document_id: string;
  /** What PIQC proposed; the saved row holds what the auditor confirmed. */
  proposed: {
    section_identifier: string;
    section_title: string;
    endpoint_tier: EndpointTier;
    impact_surface: ImpactSurface;
    time_sensitivity: boolean;
  };
  derived_at: string; // ISO 8601
}

// -----------------------------------------------------------------------------
// Audit-scoped: questionnaire instance
// -----------------------------------------------------------------------------
export interface QuestionnaireInstance {
  id: string;
  audit_id: string;                             // 1:1 with Audit (Phase 1)
  template_version_id: string;
  status: QuestionnaireInstanceStatus;
  vendor_contact_name: string | null;
  vendor_contact_email: string | null;
  vendor_contact_title: string | null;
  addenda_generated_at: string | null;
  sent_to_vendor_at: string | null;
  vendor_responded_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: source evidence register (PR-B)
//
// One row per document attached to an audit as grounding evidence
// (audit_source_documents). Register rows point at documents+chunks rows
// (kind='AUDIT_EVIDENCE'), which is what PR-C's grounded generation
// retrieves over.
// -----------------------------------------------------------------------------
export interface AuditSourceDocument {
  audit_id: string;
  document_id: string;
  added_by: string;
  added_at: string;
  source_type: string;            // what it is (free text; UI offers preset chips)
  source_system: string | null;   // where the human obtained it (null = not recorded)
  source_locator: string | null;  // doc number / binder path / URL
  include_in_generation: boolean; // withhold-never-delete lever for PR-C
}

// List-row DTO for the evidence drawer: join row + the document facts the UI
// shows. Status mirrors documents.status (text path resolves synchronously,
// so 'pending' is only ever a transient read).
export interface AuditEvidenceListRow extends AuditSourceDocument {
  title: string;
  status: 'pending' | 'ready' | 'failed';
  // documents.kind, carried so the client can enforce the AUDIT_EVIDENCE
  // invariant in its own mapper (same-language mirror of the engine's
  // normalizeRegister filter) instead of trusting the PostgREST embed
  // filter alone.
  kind: DocumentKind;
}

// -----------------------------------------------------------------------------
// Audit-scoped: grounded deliverable generation (PR-C1 checklist, PR-C2 fan-out)
//
// Mirrors generation_refs / grounding_snapshot on checklist_objects,
// agenda_objects, and confirmation_letter_objects (20260831000000 +
// 20260901000000). Snapshot semantics — refs and grounding may outlive the
// chunks/documents they name (breadcrumbs, not dependencies), so display code
// must never join back to live rows.
// -----------------------------------------------------------------------------
export interface DeliverableGenerationRef {
  item_id: string;                    // item id the ref supports ('letter'/'notification'/'gap_summary'/'findings_report'/'certificate' for blob-level refs)
  chunk_id: string;
  document_id: string;
  source: 'PROTOCOL' | 'EVIDENCE';
  quote: string;                      // verbatim excerpt, gate-verified server-side
  doc_title: string | null;           // evidence docs only; protocol passages use section/pages
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface DeliverableGroundingSnapshot {
  protocol_document_ids: string[];
  evidence: Array<{
    document_id: string;
    content_hash: string | null;
    title: string;
    source_type: string;
  }>;
  // Gap-summary kind only (PR-D3): the extra axes that deliverable depends on
  // — the FULL register (withheld rows included) and checklist item identity.
  // Absent on every other kind and on pre-D3 snapshots; currency logic gates
  // on presence, so legacy behavior is untouched.
  register?: Array<{
    document_id: string;
    title: string;
    status: string;
    included: boolean;
  }>;
  checklist_item_ids?: string[];
  // Findings-report kind only (PR-D4): the Stage-6 entry tuples the narrative
  // was drafted against — the same fields audit_mode_entry_set_digest hashes,
  // so the currency axis and the approve basis pin measure the same identity.
  // Absent on every other kind; currency logic gates on presence.
  entries?: Array<{
    id: string;
    vendor_domain: string;
    observation_text: string;
    checkpoint_ref: string | null;
    provisional_impact: string;
    provisional_classification: string;
  }>;
}

// -----------------------------------------------------------------------------
// Issues & CAPA (Phase 3) — triage a Stage 6 finding into an Issue; the Issue
// carries at most one draft-only CAPA (DRAFT → NEEDS_REVISION → ACCEPTED).
// Issue lifecycle is deliberately column-free: derived from its CAPA's state.
// -----------------------------------------------------------------------------
export interface IssueObject {
  id: string;
  audit_id: string;
  workspace_entry_id: string | null; // the finding this was triaged from
  title: string;
  description: string;
  severity: ProvisionalImpact;       // UI constrains to CRITICAL/MAJOR/MINOR
  regulatory_reportable: boolean;
  sponsor_reportable: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CapaObject {
  id: string;
  issue_id: string;                  // 1:1 with IssueObject
  audit_id: string;                  // denormalized for RLS + fast queries
  root_cause_text: string;
  corrective_action_text: string;
  preventive_action_text: string;
  status: CapaStatus;
  piqc_prefilled: boolean;           // TRUE until the first auditor edit
  accepted_at: string | null;
  accepted_by: string | null;
  exported_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Freeform fieldwork note — the ISA_CONDUCT pad and, since the vendor
// fieldwork lane (20260908000000), the vendor AUDIT_CONDUCT pad share this
// row. Working papers, not findings: freely editable and soft-deletable,
// unlike the append-only workspace-entry rows. Soft delete keeps the note's
// state-history deltas resolvable and protects the evidence trails of
// whatever record cited it. 1:1 with audit_note_objects
// (20260723000000_audit_mode_isa_notes_schema.sql).
export interface AuditNoteObject {
  id: string;
  audit_id: string;
  body: string;
  isa_domain: IsaDomain | null;      // ISA optional tag; always null for vendor notes
  is_positive: boolean;              // feeds the report's positive-observations section
  deleted_at: string | null;
  /** Set when an ISA finding's evidence cites this note (S2). Promoted notes
   *  are excluded from later drafting rounds. */
  promoted_finding_id: string | null;
  /** Vendor lane: set when an accepted candidate observation consumed this
   *  note (audit_workspace_entry_objects backlink). At most one of the two
   *  promotion backlinks is ever set (DB CHECK). */
  promoted_entry_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// One evidence instance under a finding: a specific fact, traced to the pad
// notes it came from. The generalized deficiency lives in `observation`;
// evidence carries the instances (Observation Form contract).
export interface IsaFindingEvidence {
  text: string;
  source_note_ids: string[];
}

// A citation of the site's OWN uploaded protocol — the requirement the
// finding breaches, quoted from the document itself (S4 bridge). SNAPSHOT
// semantics: quote/section/pages are denormalized at attach time and never
// re-resolved; chunk_id/document_id are provenance breadcrumbs, not live FKs
// (a protocol re-parse must not orphan a finding's citation).
export interface IsaProtocolRef {
  chunk_id: string | null;
  document_id: string | null;
  quote: string;
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}

// Site audit module mapping — which site audit modules (the isa_domain
// vocabulary) a tagged protocol risk lands in on an Investigator Site Audit.
// 1:1 with site_module_mapping_objects (20260917000000). The ISA counterpart
// of MockServiceMapping: keyed on the audit (no service object), criticality
// and rationale derived server-side by the same rule the vendor lane uses.
export interface SiteModuleMapping {
  id: string;
  audit_id: string;
  protocol_risk_id: string;          // references ProtocolRiskObject (TaggedSection) ids
  isa_domain: IsaDomain;
  derived_criticality: DerivedCriticality;
  criticality_rationale: string;     // always derived; NOT NULL
  created_at: string;
  updated_at: string;
}

// Site audit scope — the risk-based scope of an Investigator Site Audit,
// derived deterministically from SiteModuleMapping rows (lib/audit/siteScope.ts)
// and stored as the content of site_scope_objects (20260918000000). Every
// item is one mapping: `id` IS the mapping id, so a scope line traces to the
// mapping, the protocol risk and the module it came from. criticality and
// rationale are the mapping's server-derived values copied at build time,
// so an approved scope reads the same later even if the mappings move on.
export interface SiteScopeItem {
  id: string;                        // site_module_mapping_objects.id
  protocol_risk_id: string;
  isa_domain: IsaDomain;
  section_identifier: string;
  section_title: string;
  criticality: DerivedCriticality;
  rationale: string;
}

export interface SiteScopeModule {
  isa_domain: IsaDomain;
  criticality: DerivedCriticality;   // the highest over its items
  items: SiteScopeItem[];
}

export interface SiteScopeContent {
  /** The live mapping set is diffed against this to show drift. */
  built_from: {
    mapping_ids: string[];           // sorted
    built_at: string;
  };
  modules: SiteScopeModule[];
}

// Formal ISA finding. Append-only (update-with-delta, no delete), like the
// vendor lane's workspace entries but site-shaped. 1:1 with
// isa_finding_objects (20260724000000_audit_mode_isa_findings_schema.sql).
export interface IsaFindingObject {
  id: string;
  audit_id: string;
  title: string;
  isa_domain: IsaDomain;
  subcategory: string | null;
  severity: IsaSeverity;
  /** Which severity decision/escalation rule fired — auditable rating. */
  severity_rule: string | null;
  observation: string;               // generalized deficiency statement
  evidence: IsaFindingEvidence[];    // JSONB column; instances with note trail
  /** Closed-world regulatory citation (citationMap.ts) or null. */
  reference: string | null;
  /** Citations of the site's own protocol (S4 bridge). JSONB column. */
  protocol_refs: IsaProtocolRef[];
  response_owner: IsaResponseOwner;
  origin: IsaFindingOrigin;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// Provenance of a STORED prose section (S5). NULL prose ⇒ NULL source
// (templated); stored prose carries who authored it — the ladder is
// templated → llm → auditor_edited and the chip never lies.
export type IsaStoredSectionSource = 'llm' | 'auditor_edited';

// Auditor-owned pieces of the ISA report; everything else derives at render
// time. NULL prose columns mean "still templated" — the client renders the
// derived template until the auditor takes the pen (see the schema migration
// header). 1:1 with isa_report_draft_objects
// (20260725000000_audit_mode_isa_report_schema.sql; source columns from
// 20260728000000_audit_mode_isa_report_narrative.sql).
export interface IsaReportDraftObject {
  id: string;
  audit_id: string;                  // 1:1 with Audit
  exec_summary: string | null;
  exec_summary_source: IsaStoredSectionSource | null;
  auditee_background: string | null;
  auditee_background_source: IsaStoredSectionSource | null;
  opening_meeting: string | null;
  opening_meeting_source: IsaStoredSectionSource | null;
  closing_meeting: string | null;
  closing_meeting_source: IsaStoredSectionSource | null;
  site_verdict: IsaSiteVerdict | null;
  site_verdict_text: string | null;
  response_due_days: number;
  response_due_basis: 'CALENDAR' | 'BUSINESS';
  /** Sealed at sign-off (isa-review-export, 20260919000000): md5 over
   *  everything the export renders from stored state. Server-computed; the
   *  client never compares it — verify_isa_export_readiness reports
   *  divergence as a gate code. */
  readiness_fingerprint: string | null;
  final_signed_off_by: string | null;
  final_signed_off_at: string | null;
  /** When the signed-off version last left PIQC; cleared by a re-sign. */
  exported_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}
