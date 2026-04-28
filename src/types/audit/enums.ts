// =============================================================================
// Audit Mode — enum string-literal unions (1:1 with Postgres enums)
// Mirrors the 26 enums defined in
// supabase/migrations/20260427120000_audit_mode_phase_1_schema.sql
//
// Snake_case rule: TS values match Postgres enum labels exactly so a Supabase
// SELECT result can be assigned without conversion. UI labels are mapped at
// the component layer (e.g. "PHASE_1_2" → "Phase 1/2").
// =============================================================================

export type UserRole = 'AUDITOR' | 'LEAD_AUDITOR' | 'OBSERVER';

export type ProtocolVersionStatus = 'DRAFT' | 'ACTIVE' | 'SUPERSEDED';

export type ClinicalTrialPhase =
  | 'PHASE_1'
  | 'PHASE_1_2'
  | 'PHASE_2'
  | 'PHASE_2_3'
  | 'PHASE_3'
  | 'PHASE_4'
  | 'NOT_APPLICABLE';

export type EndpointTier = 'PRIMARY' | 'SECONDARY' | 'SAFETY' | 'SUPPORTIVE';

export type ImpactSurface = 'DATA_INTEGRITY' | 'PATIENT_SAFETY' | 'BOTH';

export type VersionChangeType = 'ADDED' | 'MODIFIED' | 'UNCHANGED';

export type AuditType = 'REMOTE' | 'ONSITE' | 'HYBRID';

export type AuditStatus = 'DRAFT' | 'IN_PROGRESS' | 'REVIEW' | 'CLOSED';

// D-010: Authoritative workflow position for an Audit.
export type AuditStage =
  | 'INTAKE'
  | 'VENDOR_ENRICHMENT'
  | 'QUESTIONNAIRE_REVIEW'
  | 'SCOPE_AND_RISK_REVIEW'
  | 'PRE_AUDIT_DRAFTING'
  | 'AUDIT_CONDUCT'
  | 'REPORT_DRAFTING'
  | 'FINAL_REVIEW_EXPORT';

// Ordered array — useful for stage navigation rendering and "next stage" logic.
export const AUDIT_STAGES: readonly AuditStage[] = [
  'INTAKE',
  'VENDOR_ENRICHMENT',
  'QUESTIONNAIRE_REVIEW',
  'SCOPE_AND_RISK_REVIEW',
  'PRE_AUDIT_DRAFTING',
  'AUDIT_CONDUCT',
  'REPORT_DRAFTING',
  'FINAL_REVIEW_EXPORT',
] as const;

export type RiskSummaryApprovalStatus = 'DRAFT' | 'APPROVED';
export type DeliverableApprovalStatus = 'DRAFT' | 'APPROVED';

export type DerivedCriticality = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

// [D-005] Qualitative posture enums — may be replaced once decided.
export type CompliancePosture = 'STRONG' | 'ADEQUATE' | 'WEAK' | 'UNKNOWN';
export type MaturityPosture = 'MATURE' | 'DEVELOPING' | 'EARLY' | 'UNKNOWN';
export type TrustPosture = 'HIGH' | 'MODERATE' | 'LOW' | 'UNKNOWN';

export type ResponseStatus = 'ANSWERED' | 'UNANSWERED' | 'PARTIAL' | 'DEFERRED';

export type QuestionAnswerType =
  | 'NARRATIVE'
  | 'YES_NO_QUALIFY'
  | 'EVIDENCE_REQUEST'
  | 'LIST'
  | 'NUMERIC';

export type ResponseSource =
  | 'PENDING'
  | 'AUDITOR_PREFILL_WEB'
  | 'AUDITOR_PREFILL_PRIOR_AUDIT'
  | 'AUDITOR_AUTHORED'
  | 'VENDOR'
  | 'NOT_APPLICABLE';

export type QuestionnaireInstanceStatus =
  | 'DRAFT'
  | 'PREFILL_IN_PROGRESS'
  | 'READY_TO_SEND'
  | 'SENT_TO_VENDOR'
  | 'VENDOR_RESPONDED'
  | 'COMPLETE';

export type QuestionOrigin = 'TEMPLATE' | 'ADDENDUM';

export type ProvisionalImpact =
  | 'CRITICAL'
  | 'MAJOR'
  | 'MINOR'
  | 'OBSERVATION'
  | 'NONE';

export type ProvisionalClassification =
  | 'FINDING'
  | 'OBSERVATION'
  | 'OPPORTUNITY_FOR_IMPROVEMENT'
  | 'NOT_YET_CLASSIFIED';

export type AmendmentAlertStatus =
  | 'PENDING'
  | 'REVIEWED'
  | 'ADOPTED'
  | 'DISMISSED';

export type AmendmentDecision = 'ADOPT_NEW_VERSION' | 'STAY_ON_CURRENT';

export type TaggingMode = 'MANUAL' | 'PIQC_ASSISTED' | 'LLM_ASSISTED';

// Polymorphic discriminator for state_history_deltas.
export type TrackedObjectType =
  | 'PROTOCOL_RISK_OBJECT'
  | 'VENDOR_SERVICE_OBJECT'
  | 'VENDOR_SERVICE_MAPPING_OBJECT'
  | 'TRUST_ASSESSMENT_OBJECT'
  | 'QUESTIONNAIRE_INSTANCE'
  | 'QUESTIONNAIRE_RESPONSE_OBJECT'
  | 'AUDIT_WORKSPACE_ENTRY_OBJECT'
  | 'AUDIT'
  | 'AMENDMENT_ALERT'
  | 'VENDOR_RISK_SUMMARY_OBJECT'
  | 'CONFIRMATION_LETTER_OBJECT'
  | 'AGENDA_OBJECT'
  | 'CHECKLIST_OBJECT';
