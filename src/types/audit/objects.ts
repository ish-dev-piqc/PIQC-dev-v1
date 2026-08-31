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
  AmendmentAlertStatus,
  AmendmentDecision,
  AuditStage,
  AuditStatus,
  AuditType,
  AuditWorkflowType,
  CapaStatus,
  ClinicalTrialPhase,
  CompliancePosture,
  DeliverableApprovalStatus,
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
  IsaDomain,
  IsaFindingOrigin,
  IsaResponseOwner,
  IsaSeverity,
  IsaSiteVerdict,
  MaturityPosture,
  ProtocolVersionStatus,
  ProvisionalClassification,
  ProvisionalImpact,
  QuestionAnswerType,
  QuestionOrigin,
  QuestionnaireInstanceStatus,
  ResponseSource,
  ResponseStatus,
  RiskSummaryApprovalStatus,
  TaggingMode,
  TrustPosture,
  UserRole,
  VersionChangeType,
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

// suggestion_provenance shape when PIQC_ASSISTED or LLM_ASSISTED.
// Keys are field names on ProtocolRiskObject.
export type SuggestionProvenance = Record<
  string,
  {
    suggested: unknown;
    source: 'piqc' | 'llm';
    confidence: number; // 0.0 – 1.0
  }
>;

export interface ProtocolRiskObject {
  id: string;
  protocol_version_id: string;
  section_identifier: string;     // [PIQC] D-009 — format TBD
  section_title: string;
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  vendor_dependency_flags: string[];
  operational_domain_tag: string; // ECG | imaging | ePRO | randomization | central_lab | IVRS
  tagging_mode: TaggingMode;
  suggestion_provenance: SuggestionProvenance | null;
  previous_version_risk_id: string | null;
  version_change_type: VersionChangeType;
  tagged_by: string;                // auth.users.id
  tagged_at: string;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Questionnaire template / version / question
// -----------------------------------------------------------------------------
export interface QuestionnaireTemplate {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface QuestionnaireTemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  notes: string | null;
  published_at: string;
}

// One row, two parents (template-version OR instance — exactly one set).
// CHECK constraint enforces this at the DB level.
export interface QuestionnaireQuestion {
  id: string;
  origin: QuestionOrigin;
  template_version_id: string | null;
  instance_id: string | null;
  question_number: string;
  section_title: string;
  section_code: string;
  prompt: string;
  answer_type: QuestionAnswerType;
  evidence_expected: boolean;
  domain_tag: string | null;
  generated_from_mapping_id: string | null;
  ordinal: number;
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
// Audit-scoped: vendor service + mapping
// -----------------------------------------------------------------------------
export interface VendorServiceObject {
  id: string;
  audit_id: string;                 // 1:1 with Audit
  service_name: string;
  service_type: string;             // ECG | central_lab | ePRO | IVRS | imaging | randomization
  service_description: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorServiceMappingObject {
  id: string;
  vendor_service_id: string;
  protocol_risk_id: string;
  derived_criticality: DerivedCriticality;
  criticality_rationale: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: trust assessment
// -----------------------------------------------------------------------------
export interface TrustAssessmentObject {
  id: string;
  audit_id: string;                 // 1:1 with Audit
  certifications_claimed: string[];
  regulatory_claims: string[];
  compliance_posture: CompliancePosture;          // [D-005]
  maturity_posture: MaturityPosture;              // [D-005]
  provisional_trust_posture: TrustPosture;        // [D-005]
  risk_hypotheses: string[];
  notes: string | null;
  assessed_by: string;
  assessed_at: string | null;
  created_at: string;
  updated_at: string;
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
}

export interface VendorRiskSummaryObject {
  id: string;
  audit_id: string;                              // 1:1 with Audit
  study_context: RiskSummaryStudyContext;
  vendor_relevance_narrative: string;
  focus_areas: string[];
  approval_status: RiskSummaryApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface VendorRiskSummaryProtocolRiskRef {
  risk_summary_id: string;
  protocol_risk_id: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: questionnaire instance + response
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

export interface QuestionnaireResponseObject {
  id: string;
  instance_id: string;
  question_id: string;
  audit_id: string;                             // denormalized for fast queries + RLS
  vendor_service_mapping_id: string | null;
  response_text: string | null;
  response_status: ResponseStatus;
  source: ResponseSource;
  source_reference: string | null;
  confidence_flag: boolean;
  inconsistency_flag: boolean;
  inconsistency_note: string | null;
  responded_by: string | null;                  // null when source = VENDOR
  responded_at: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: workspace entry (the primary Verify-mode artifact)
// -----------------------------------------------------------------------------
export interface AuditWorkspaceEntryObject {
  id: string;
  audit_id: string;
  protocol_risk_id: string | null;
  vendor_service_mapping_id: string | null;
  questionnaire_response_id: string | null;
  checkpoint_ref: string | null;                // auditor freetext: vendor SOP/section cite (SOPs are not parsed)
  vendor_domain: string;
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  risk_attrs_inherited: boolean;
  inherited_endpoint_tier: EndpointTier | null;
  inherited_impact_surface: ImpactSurface | null;
  inherited_time_sensitivity: boolean | null;
  risk_context_outdated: boolean;
  risk_context_confirmed_at: string | null;
  risk_context_confirmed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: amendment alert
// -----------------------------------------------------------------------------
export interface AmendmentAlert {
  id: string;
  audit_id: string;
  from_version_id: string;
  to_version_id: string;
  status: AmendmentAlertStatus;
  decision: AmendmentDecision | null;
  decision_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: evidence
// -----------------------------------------------------------------------------
export interface EvidenceAttachment {
  id: string;
  filename: string;
  storage_key: string;                          // Supabase Storage object key
  mime_type: string;
  file_size_bytes: number;
  checkpoint_ref: string | null;
  uploaded_by: string;
  uploaded_at: string;
}

export interface EvidenceOnWorkspaceEntry {
  workspace_entry_id: string;
  evidence_id: string;
}

export interface EvidenceOnQuestionnaireResponse {
  questionnaire_response_id: string;
  evidence_id: string;
}

// -----------------------------------------------------------------------------
// Audit-scoped: source evidence register (PR-B)
//
// One row per document attached to an audit as grounding evidence
// (audit_source_documents). Distinct from the unused EvidenceAttachment model
// above: register rows point at documents+chunks rows (kind='AUDIT_EVIDENCE'),
// which is what PR-C's grounded generation retrieves over.
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
  item_id: string;                    // item id the ref supports ('letter'/'notification' for blob-level refs)
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
}

// -----------------------------------------------------------------------------
// Pre-Audit Drafting deliverables (D-010 step 7)
// -----------------------------------------------------------------------------

// Minimum content shape for a confirmation letter — JSONB column. Detail TBD.
export interface ConfirmationLetterContent {
  body_text?: string;
  recipients?: string[];
  scope?: string[];
  [key: string]: unknown;
}

export interface ConfirmationLetterObject {
  id: string;
  audit_id: string;                              // 1:1 with Audit
  content: ConfirmationLetterContent;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgendaItem {
  time?: string;
  topic?: string;
  owner?: string;
  notes?: string;
  [key: string]: unknown;
}

export interface AgendaContent {
  items?: AgendaItem[];
  [key: string]: unknown;
}

export interface AgendaObject {
  id: string;
  audit_id: string;                              // 1:1 with Audit
  content: AgendaContent;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistItem {
  id?: string;
  prompt?: string;
  checkpoint_ref?: string;
  evidence_expected?: boolean;
  [key: string]: unknown;
}

export interface ChecklistContent {
  items?: ChecklistItem[];
  [key: string]: unknown;
}

export interface ChecklistObject {
  id: string;
  audit_id: string;                              // 1:1 with Audit
  content: ChecklistContent;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
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

// Freeform fieldwork note on an Investigator Site Audit (ISA_CONDUCT pad).
// Working papers, not findings: freely editable and soft-deletable, unlike
// the append-only AuditWorkspaceEntryObject. Soft delete keeps the note's
// state-history deltas resolvable and (S2) protects findings' evidence
// trails. 1:1 with audit_note_objects
// (20260723000000_audit_mode_isa_notes_schema.sql).
export interface AuditNoteObject {
  id: string;
  audit_id: string;
  body: string;
  isa_domain: IsaDomain | null;      // optional tag; S2 infers when absent
  is_positive: boolean;              // feeds the report's positive-observations section
  deleted_at: string | null;
  /** Set when a finding's evidence cites this note (S2). Promoted notes are
   *  excluded from later drafting rounds. */
  promoted_finding_id: string | null;
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
  created_by: string;
  created_at: string;
  updated_at: string;
}
