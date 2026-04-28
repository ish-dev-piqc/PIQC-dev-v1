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
  ClinicalTrialPhase,
  CompliancePosture,
  DeliverableApprovalStatus,
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
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
  vendor_id: string;
  protocol_id: string;
  protocol_version_id: string;
  audit_name: string;
  audit_type: AuditType;
  status: AuditStatus;
  current_stage: AuditStage;
  lead_auditor_id: string;          // auth.users.id
  scheduled_date: string | null;    // yyyy-mm-dd
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
  checkpoint_ref: string | null;                // [D-004 STUB] plain text
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
