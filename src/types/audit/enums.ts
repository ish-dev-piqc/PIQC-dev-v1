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

// D-011: Which audit workflow an Audit follows. Audit Mode is a two-workflow
// Audit Workspace: VENDOR_AUDIT is the only live workflow today;
// INVESTIGATOR_SITE_AUDIT is the seam for the deferred investigator/site audit
// initiative (its stage set is defined there). 1:1 with the Postgres
// `audit_workflow_type` enum (20260705000000_audit_mode_workflow_type.sql).
export type AuditWorkflowType = 'VENDOR_AUDIT' | 'INVESTIGATOR_SITE_AUDIT';

// Ordered array — hub segmentation + workflow chooser rendering.
export const AUDIT_WORKFLOW_TYPES: readonly AuditWorkflowType[] = [
  'VENDOR_AUDIT',
  'INVESTIGATOR_SITE_AUDIT',
] as const;

export type AuditStatus = 'DRAFT' | 'IN_PROGRESS' | 'REVIEW' | 'CLOSED';

// D-010: Authoritative workflow position for an Audit. The first 8 are the
// VENDOR_AUDIT pipeline; the ISA_* values are the INVESTIGATOR_SITE_AUDIT
// pipeline (20260709000000). An audit only ever occupies stages from its own
// workflow's set (stagesForWorkflow); the union is flat because current_stage is
// a single audit_stage column shared by both workflows.
export type AuditStage =
  | 'INTAKE'
  | 'VENDOR_ENRICHMENT'
  | 'QUESTIONNAIRE_REVIEW'
  | 'SCOPE_AND_RISK_REVIEW'
  | 'PRE_AUDIT_DRAFTING'
  | 'AUDIT_CONDUCT'
  | 'REPORT_DRAFTING'
  | 'FINAL_REVIEW_EXPORT'
  // Investigator Site Audit pipeline
  | 'ISA_SITE_INTAKE'
  | 'ISA_RISK_ASSESSMENT'
  | 'ISA_SCOPE_BUILDER'
  | 'ISA_PREP'
  | 'ISA_CONDUCT'
  | 'ISA_REPORT'
  | 'ISA_EXPORT';

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

// CAPA review loop — draft-only posture. ACCEPTED means "ready to export";
// there is deliberately no approve/final state (finalization happens in the
// QMS after export). 1:1 with Postgres capa_status
// (20260707000200_audit_mode_issue_capa_schema.sql).
export type CapaStatus = 'DRAFT' | 'NEEDS_REVISION' | 'ACCEPTED';

export type AmendmentAlertStatus =
  | 'PENDING'
  | 'REVIEWED'
  | 'ADOPTED'
  | 'DISMISSED';

export type AmendmentDecision = 'ADOPT_NEW_VERSION' | 'STAY_ON_CURRENT';

export type TaggingMode = 'MANUAL' | 'PIQC_ASSISTED' | 'LLM_ASSISTED';

// Investigator Site Audit observation domains — the site-audit analogue of
// the vendor lane's freetext vendor_domain, but closed-world: the 15 values
// come from the S0 writing contract (standard ISA report templates' category
// matrix). 1:1 with Postgres isa_domain
// (20260723000000_audit_mode_isa_notes_schema.sql).
export type IsaDomain =
  | 'INFORMED_CONSENT'
  | 'INVESTIGATOR_OVERSIGHT_DELEGATION'
  | 'INVESTIGATIONAL_PRODUCT'
  | 'SAFETY_AE_SAE'
  | 'SOURCE_DATA_VERIFICATION'
  | 'RECORDKEEPING_SOURCE_DOCS'
  | 'ESSENTIAL_DOCUMENTS'
  | 'IRB_EC'
  | 'STAFF_QUALIFICATIONS_TRAINING'
  | 'FACILITIES_EQUIPMENT'
  | 'ELECTRONIC_SYSTEMS'
  | 'STUDY_CONDUCT_GCP'
  | 'CLINICAL_MONITORING'
  | 'SOP_REVIEW'
  | 'OTHER';

// ISA finding severity — the templates' 4-tier axis. Deliberately NOT
// ProvisionalImpact: site-audit reports rate Critical/Major/Minor/
// Recommendation on one axis; reusing the vendor 5-value enum would leave
// dead values and split Recommendation across two columns. 1:1 with Postgres
// isa_severity (20260724000000_audit_mode_isa_findings_schema.sql).
export type IsaSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'RECOMMENDATION';

// Provenance honesty for ISA findings: PIQC_DRAFTED means accepted verbatim;
// ANY content edit (pre- or post-accept) flips to PIQC_EDITED.
export type IsaFindingOrigin = 'AUDITOR' | 'PIQC_DRAFTED' | 'PIQC_EDITED';

// Who owns the response to a finding (from the Audit Observation Form).
export type IsaResponseOwner = 'SITE' | 'CLIENT' | 'CRO';

// The site-continuation ruling — the most consequential sentence in the ISA
// report. Never machine-drafted, never defaulted: the auditor sets it, and
// export is blocked while it is unset. 1:1 with Postgres isa_site_verdict
// (20260725000000_audit_mode_isa_report_schema.sql).
export type IsaSiteVerdict =
  | 'CONTINUE'
  | 'CONTINUE_INCREASED_MONITORING'
  | 'DO_NOT_CONTINUE';

// Polymorphic discriminator for state_history_deltas.
export type TrackedObjectType =
  | 'PROTOCOL_RISK_OBJECT'
  | 'VENDOR_SERVICE_OBJECT'
  | 'VENDOR_SERVICE_MAPPING_OBJECT'
  | 'TRUST_ASSESSMENT_OBJECT'
  | 'QUESTIONNAIRE_INSTANCE'
  | 'QUESTIONNAIRE_RESPONSE_OBJECT'
  | 'AUDIT_WORKSPACE_ENTRY_OBJECT'
  | 'AUDIT_NOTE_OBJECT'
  | 'ISA_FINDING_OBJECT'
  | 'ISA_REPORT_DRAFT_OBJECT'
  | 'AUDIT'
  | 'AMENDMENT_ALERT'
  | 'VENDOR_RISK_SUMMARY_OBJECT'
  | 'CONFIRMATION_LETTER_OBJECT'
  | 'AGENDA_OBJECT'
  | 'CHECKLIST_OBJECT'
  | 'REPORT_DRAFT_OBJECT'
  | 'ISSUE_OBJECT'
  | 'CAPA_OBJECT';
