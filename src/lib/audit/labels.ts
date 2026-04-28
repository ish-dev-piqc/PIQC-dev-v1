// =============================================================================
// Audit Mode — UI label maps for enums
//
// Centralizes the human-friendly strings shown in the UI so they don't drift
// between StageNav, Navbar picker, RiskSummaryPanel, etc.
// =============================================================================

import type {
  AuditStage,
  AuditStatus,
  AuditType,
  CompliancePosture,
  DerivedCriticality,
  EndpointTier,
  ImpactSurface,
  MaturityPosture,
  ProvisionalClassification,
  ProvisionalImpact,
  QuestionAnswerType,
  QuestionnaireInstanceStatus,
  ResponseSource,
  ResponseStatus,
  TrustPosture,
} from '../../types/audit';

export const STAGE_LABELS: Record<AuditStage, string> = {
  INTAKE: 'Intake',
  VENDOR_ENRICHMENT: 'Vendor enrichment',
  QUESTIONNAIRE_REVIEW: 'Questionnaire review',
  SCOPE_AND_RISK_REVIEW: 'Scope & risk review',
  PRE_AUDIT_DRAFTING: 'Pre-audit drafting',
  AUDIT_CONDUCT: 'Audit conduct',
  REPORT_DRAFTING: 'Report drafting',
  FINAL_REVIEW_EXPORT: 'Final review & export',
};

// Brief description shown under each stage in the StageNav and elsewhere.
// Phase 1 phrasing — adjust as the workflow stabilises.
export const STAGE_DESCRIPTIONS: Record<AuditStage, string> = {
  INTAKE: 'Tag protocol risks for vendor relevance.',
  VENDOR_ENRICHMENT: 'Define vendor service and trust assessment.',
  QUESTIONNAIRE_REVIEW: 'Review and pre-fill the standard questionnaire.',
  SCOPE_AND_RISK_REVIEW: 'Confirm scope and approve the risk summary.',
  PRE_AUDIT_DRAFTING: 'Draft confirmation letter, agenda, and checklist.',
  AUDIT_CONDUCT: 'Capture observations during the audit.',
  REPORT_DRAFTING: 'Compose the final audit report.',
  FINAL_REVIEW_EXPORT: 'Approve and export deliverables.',
};

export const AUDIT_STATUS_LABELS: Record<AuditStatus, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In progress',
  REVIEW: 'In review',
  CLOSED: 'Closed',
};

export const AUDIT_TYPE_LABELS: Record<AuditType, string> = {
  REMOTE: 'Remote',
  ONSITE: 'Onsite',
  HYBRID: 'Hybrid',
};

export const RESPONSE_STATUS_LABELS: Record<ResponseStatus, string> = {
  ANSWERED: 'Answered',
  UNANSWERED: 'Unanswered',
  PARTIAL: 'Partial',
  DEFERRED: 'Deferred',
};

export const RESPONSE_SOURCE_LABELS: Record<ResponseSource, string> = {
  PENDING: 'Pending',
  AUDITOR_PREFILL_WEB: 'Pre-filled from web',
  AUDITOR_PREFILL_PRIOR_AUDIT: 'Pre-filled from prior audit',
  AUDITOR_AUTHORED: 'Auditor authored',
  VENDOR: 'Vendor response',
  NOT_APPLICABLE: 'Not applicable',
};

// =============================================================================
// Risk-tagging vocabularies (INTAKE stage)
// =============================================================================

export const ENDPOINT_TIER_LABELS: Record<EndpointTier, string> = {
  PRIMARY: 'Primary',
  SECONDARY: 'Secondary',
  SAFETY: 'Safety',
  SUPPORTIVE: 'Supportive',
};

export const ENDPOINT_TIER_DESCRIPTIONS: Record<EndpointTier, string> = {
  PRIMARY: 'Drives the protocol’s primary efficacy or pivotal endpoint.',
  SECONDARY: 'Supports a secondary endpoint or supplementary analysis.',
  SAFETY: 'Captures safety, AE, or pharmacovigilance data.',
  SUPPORTIVE: 'Supports trial conduct without directly producing endpoint data.',
};

export const IMPACT_SURFACE_LABELS: Record<ImpactSurface, string> = {
  DATA_INTEGRITY: 'Data integrity',
  PATIENT_SAFETY: 'Patient safety',
  BOTH: 'Both',
};

// Operational domain — controlled vocab. Phase 2 may extend this list as more
// vendor categories are encountered. Free-text "other" not allowed in Phase 1.
export const OPERATIONAL_DOMAIN_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'central_lab', label: 'Central laboratory' },
  { value: 'ECG', label: 'ECG / cardiac safety' },
  { value: 'imaging', label: 'Medical imaging' },
  { value: 'ePRO', label: 'ePRO platform' },
  { value: 'IVRS', label: 'IVRS / IWRS' },
  { value: 'randomization', label: 'Randomization' },
  { value: 'EDC', label: 'EDC / data capture' },
  { value: 'eTMF', label: 'eTMF' },
  { value: 'biostats', label: 'Biostatistics' },
  { value: 'pharmacovigilance', label: 'Pharmacovigilance' },
  { value: 'cro_full_service', label: 'Full-service CRO' },
];

// Vendor dependency flags — multi-select. Indicates which vendor categories
// the protocol section depends on. Same controlled vocab as operational
// domain, but a section can flag multiple dependencies (e.g. lab + imaging).
export const VENDOR_DEPENDENCY_FLAG_OPTIONS = OPERATIONAL_DOMAIN_OPTIONS;

// =============================================================================
// Vendor Enrichment vocabularies (VENDOR_ENRICHMENT stage)
// =============================================================================

// Service-type controlled vocab. Mirrors OPERATIONAL_DOMAIN_OPTIONS but is
// stored on VendorServiceObject.service_type. Kept as a separate const because
// the lists may diverge as new vendor categories appear.
export const SERVICE_TYPE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  { value: 'central_lab', label: 'Central laboratory' },
  { value: 'ECG', label: 'ECG / cardiac safety' },
  { value: 'imaging', label: 'Medical imaging' },
  { value: 'ePRO', label: 'ePRO platform' },
  { value: 'IVRS', label: 'IVRS / IWRS' },
  { value: 'randomization', label: 'Randomization' },
  { value: 'EDC', label: 'EDC / data capture' },
  { value: 'eTMF', label: 'eTMF' },
  { value: 'biostats', label: 'Biostatistics' },
  { value: 'pharmacovigilance', label: 'Pharmacovigilance' },
  { value: 'cro_full_service', label: 'Full-service CRO' },
];

export const DERIVED_CRITICALITY_LABELS: Record<DerivedCriticality, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MODERATE: 'Moderate',
  LOW: 'Low',
};

// [D-005] qualitative posture labels — may be replaced if scoring model changes.
export const COMPLIANCE_POSTURE_LABELS: Record<CompliancePosture, string> = {
  STRONG: 'Strong',
  ADEQUATE: 'Adequate',
  WEAK: 'Weak',
  UNKNOWN: 'Unknown',
};

export const MATURITY_POSTURE_LABELS: Record<MaturityPosture, string> = {
  MATURE: 'Mature',
  DEVELOPING: 'Developing',
  EARLY: 'Early',
  UNKNOWN: 'Unknown',
};

export const TRUST_POSTURE_LABELS: Record<TrustPosture, string> = {
  HIGH: 'High',
  MODERATE: 'Moderate',
  LOW: 'Low',
  UNKNOWN: 'Unknown',
};

// =============================================================================
// Questionnaire vocabularies (QUESTIONNAIRE_REVIEW stage)
// =============================================================================

export const QUESTIONNAIRE_INSTANCE_STATUS_LABELS: Record<
  QuestionnaireInstanceStatus,
  string
> = {
  DRAFT: 'Draft',
  PREFILL_IN_PROGRESS: 'Pre-fill in progress',
  READY_TO_SEND: 'Ready to send',
  SENT_TO_VENDOR: 'Sent to vendor',
  VENDOR_RESPONDED: 'Vendor responded',
  COMPLETE: 'Complete',
};

// Linear lifecycle order for the stepper.
export const QUESTIONNAIRE_INSTANCE_STATUS_ORDER: readonly QuestionnaireInstanceStatus[] = [
  'DRAFT',
  'PREFILL_IN_PROGRESS',
  'READY_TO_SEND',
  'SENT_TO_VENDOR',
  'VENDOR_RESPONDED',
  'COMPLETE',
] as const;

export const QUESTION_ANSWER_TYPE_LABELS: Record<QuestionAnswerType, string> = {
  NARRATIVE: 'Narrative',
  YES_NO_QUALIFY: 'Yes/No + qualify',
  EVIDENCE_REQUEST: 'Evidence',
  LIST: 'List',
  NUMERIC: 'Number',
};

// =============================================================================
// Audit Conduct vocabularies (AUDIT_CONDUCT stage)
// =============================================================================

// Provisional impact — how severe the auditor judges this observation.
// Human-assigned only per D-008; never autonomously proposed.
export const PROVISIONAL_IMPACT_LABELS: Record<ProvisionalImpact, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  OBSERVATION: 'Observation',
  NONE: 'None',
};

// Provisional classification — what kind of finding this is. Human-assigned.
export const PROVISIONAL_CLASSIFICATION_LABELS: Record<ProvisionalClassification, string> = {
  FINDING: 'Finding',
  OBSERVATION: 'Observation',
  OPPORTUNITY_FOR_IMPROVEMENT: 'OFI',
  NOT_YET_CLASSIFIED: 'Not yet classified',
};
