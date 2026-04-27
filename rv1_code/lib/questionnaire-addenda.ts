// =============================================================================
// Questionnaire addendum rule table (D-003)
//
// Deterministic rule table that produces section 5.3.x candidate questions
// from upstream-derived dimensions:
//   - vendorServiceType        (VendorServiceObject.serviceType)
//   - derivedCriticality       (VendorServiceMappingObject.derivedCriticality)
//   - clinicalTrialPhase       (ProtocolVersion.clinicalTrialPhase)
//   - operationalDomainTag     (ProtocolRiskObject.operationalDomainTag)
//
// All inputs come from existing data — no auditor re-entry. The output is a
// "best quality first draft" the auditor edits, deletes, or augments.
//
// Phase awareness: early-phase studies (PHASE_1, PHASE_1_2) emphasize safety
// reporting, PK assay validation, FIH dose escalation oversight. Late-phase
// studies (PHASE_3, PHASE_4) emphasize data integrity at scale, ICH E6(R3)
// / 21 CFR Part 11 controls, and registration-grade traceability.
//
// This rule table is the Phase 1 build. Phase 2 (PIQC-assisted) and Phase 3
// (LLM-assisted) layer suggestion sources on top of the same shape — the
// AddendumQuestionCandidate contract does not change.
//
// Editable: rules are exported as a static array. Adding a rule requires only
// appending to the array — no migrations, no schema changes.
// =============================================================================

import { ClinicalTrialPhase, QuestionAnswerType } from "@prisma/client";
import {
  AddendumQuestionCandidate,
  AddendumRuleInput,
} from "@/lib/types/questionnaire";

// Match condition for a rule. Any field left undefined matches all values.
// Arrays match if the input value is included.
interface RuleMatch {
  serviceType?: string[];
  derivedCriticality?: string[];          // CRITICAL | HIGH | MODERATE | LOW
  clinicalTrialPhase?: ClinicalTrialPhase[];
  operationalDomainTag?: string[];
}

interface AddendumRule {
  // Stable key for traceability — recorded on the generated question.
  // Format: "<service>.<criticality?>.<phase?>.<topic>"
  key: string;
  match: RuleMatch;
  prompt: string;
  answerType: QuestionAnswerType;
  evidenceExpected: boolean;
  domainTag: string;
}

const EARLY_PHASE = [ClinicalTrialPhase.PHASE_1, ClinicalTrialPhase.PHASE_1_2];
const LATE_PHASE = [ClinicalTrialPhase.PHASE_3, ClinicalTrialPhase.PHASE_4];
const HIGH_OR_CRITICAL = ["CRITICAL", "HIGH"];

// =============================================================================
// Rule set
// Grouped by service type for editability. Order is preserved within service
// type for stable ordinals on regeneration.
// =============================================================================
export const ADDENDUM_RULES: AddendumRule[] = [
  // ---------------------------------------------------------------------------
  // Central laboratory
  // ---------------------------------------------------------------------------
  {
    key: "central_lab.base.sample_chain_of_custody",
    match: { serviceType: ["central_lab"] },
    prompt:
      "Describe the sample chain-of-custody process from collection site through receipt, accessioning, and analysis. Include temperature monitoring and deviations handling.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "central_lab",
  },
  {
    key: "central_lab.base.assay_validation",
    match: { serviceType: ["central_lab"] },
    prompt:
      "List the assays in scope for this study and provide validation status (validated / fit-for-purpose / qualified) for each.",
    answerType: QuestionAnswerType.LIST,
    evidenceExpected: true,
    domainTag: "central_lab",
  },
  {
    key: "central_lab.early_phase.pk_bioanalytical",
    match: { serviceType: ["central_lab"], clinicalTrialPhase: EARLY_PHASE },
    prompt:
      "For PK bioanalytical assays in scope, describe method validation against FDA/EMA bioanalytical method validation guidance. Provide validation reports.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "central_lab",
  },
  {
    key: "central_lab.critical.subcontractor_oversight",
    match: { serviceType: ["central_lab"], derivedCriticality: HIGH_OR_CRITICAL },
    prompt:
      "If specialty testing is subcontracted (e.g. flow cytometry, biomarker assays), list each subcontractor and describe your qualification and ongoing oversight process.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "central_lab",
  },

  // ---------------------------------------------------------------------------
  // ECG / cardiac safety
  // ---------------------------------------------------------------------------
  {
    key: "ecg.base.over_read_workflow",
    match: { serviceType: ["ecg", "cardiac_safety"] },
    prompt:
      "Describe the ECG over-read workflow including blinding, cardiologist credentialing, adjudication for borderline tracings, and turnaround time SLAs.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "cardiac_safety",
  },
  {
    key: "ecg.early_phase.qt_assessment",
    match: {
      serviceType: ["ecg", "cardiac_safety"],
      clinicalTrialPhase: EARLY_PHASE,
    },
    prompt:
      "For thorough QT or concentration-QT studies, describe procedures for time-matched ECG extraction, replicate handling, and adherence to ICH E14.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "cardiac_safety",
  },

  // ---------------------------------------------------------------------------
  // Imaging (central)
  // ---------------------------------------------------------------------------
  {
    key: "imaging.base.acquisition_standardization",
    match: { serviceType: ["imaging"] },
    prompt:
      "Describe site qualification, scanner standardization, and acquisition protocol enforcement procedures across imaging sites.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "imaging",
  },
  {
    key: "imaging.late_phase.read_paradigm",
    match: { serviceType: ["imaging"], clinicalTrialPhase: LATE_PHASE },
    prompt:
      "Describe the central read paradigm (single, double, double + adjudication), reader credentialing, and reader-locked workflow controls used to support registrational endpoints.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "imaging",
  },

  // ---------------------------------------------------------------------------
  // ePRO / eCOA
  // ---------------------------------------------------------------------------
  {
    key: "epro.base.licensing_translation",
    match: { serviceType: ["epro", "ecoa"] },
    prompt:
      "List the COA instruments licensed for this study and provide evidence of licensor authorization and linguistic validation status for each language pack.",
    answerType: QuestionAnswerType.LIST,
    evidenceExpected: true,
    domainTag: "ecoa",
  },
  {
    key: "epro.base.device_provisioning",
    match: { serviceType: ["epro", "ecoa"] },
    prompt:
      "Describe device provisioning, time-zone handling, offline capture reconciliation, and patient login security model.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "ecoa",
  },

  // ---------------------------------------------------------------------------
  // IRT / IVRS / RTSM (randomization + supply)
  // ---------------------------------------------------------------------------
  {
    key: "irt.base.unblinding_controls",
    match: { serviceType: ["irt", "ivrs", "rtsm"] },
    prompt:
      "Describe the emergency unblinding workflow, who can request, who can approve, and how unblinding events are logged and reported.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "irt",
  },
  {
    key: "irt.base.randomization_validation",
    match: { serviceType: ["irt", "ivrs", "rtsm"] },
    prompt:
      "Describe how the randomization schedule is generated, validated, and protected. Provide UAT artifacts for the study-specific randomization configuration.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "irt",
  },
  {
    key: "irt.late_phase.supply_chain",
    match: {
      serviceType: ["irt", "ivrs", "rtsm"],
      clinicalTrialPhase: LATE_PHASE,
    },
    prompt:
      "Describe drug supply forecasting, expiry management, and depot-to-site shipment controls for the registrational supply scenario.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "irt",
  },

  // ---------------------------------------------------------------------------
  // EDC / data management
  // ---------------------------------------------------------------------------
  {
    key: "edc.base.edit_check_validation",
    match: { serviceType: ["edc", "data_management"] },
    prompt:
      "Describe edit-check authoring, validation, and version control. Provide a sample of UAT scripts and execution evidence for this study's CRF build.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "data_management",
  },
  {
    key: "edc.base.audit_trail_review",
    match: { serviceType: ["edc", "data_management"] },
    prompt:
      "Describe the audit trail review process — frequency, sampling strategy, reviewer role, and escalation path for anomalies.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "data_management",
  },
  {
    key: "edc.critical.part11_assessment",
    match: {
      serviceType: ["edc", "data_management"],
      derivedCriticality: HIGH_OR_CRITICAL,
    },
    prompt:
      "Provide your latest 21 CFR Part 11 / EU Annex 11 self-assessment for the EDC platform, including known gaps and remediation timelines.",
    answerType: QuestionAnswerType.EVIDENCE_REQUEST,
    evidenceExpected: true,
    domainTag: "data_management",
  },

  // ---------------------------------------------------------------------------
  // Pharmacovigilance / safety database
  // ---------------------------------------------------------------------------
  {
    key: "pv.base.icsr_workflow",
    match: { serviceType: ["pharmacovigilance", "safety_db"] },
    prompt:
      "Describe the ICSR intake-to-submission workflow, including triage, medical review, MedDRA coding governance, and regulatory timelines tracking.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "pharmacovigilance",
  },
  {
    key: "pv.early_phase.dose_escalation_safety",
    match: {
      serviceType: ["pharmacovigilance", "safety_db"],
      clinicalTrialPhase: EARLY_PHASE,
    },
    prompt:
      "For first-in-human or dose-escalation studies, describe how safety review committee (SRC/DMC) safety data flows are supported, including expedited reporting paths.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "pharmacovigilance",
  },

  // ---------------------------------------------------------------------------
  // Biostatistics / central statistics
  // ---------------------------------------------------------------------------
  {
    key: "biostats.base.programming_qc",
    match: { serviceType: ["biostatistics", "central_stats"] },
    prompt:
      "Describe the double-programming QC paradigm for SDTM/ADaM datasets and TLF generation, including independence of validators and discrepancy resolution.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "biostatistics",
  },
  {
    key: "biostats.late_phase.sap_change_control",
    match: {
      serviceType: ["biostatistics", "central_stats"],
      clinicalTrialPhase: LATE_PHASE,
    },
    prompt:
      "For registrational analyses, describe SAP change control, blind-data review meeting governance, and database lock pre-checks.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "biostatistics",
  },

  // ---------------------------------------------------------------------------
  // eTMF
  // ---------------------------------------------------------------------------
  {
    key: "etmf.base.completeness_qc",
    match: { serviceType: ["etmf"] },
    prompt:
      "Describe the eTMF completeness, timeliness, and quality (CTQ) review process. Provide your study-level completeness reporting cadence.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "etmf",
  },
  {
    key: "etmf.late_phase.inspection_readiness",
    match: { serviceType: ["etmf"], clinicalTrialPhase: LATE_PHASE },
    prompt:
      "Describe inspection readiness procedures including auto-classification accuracy, document version control, and inspector access workflows.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "etmf",
  },

  // ---------------------------------------------------------------------------
  // CRO (full-service)
  // ---------------------------------------------------------------------------
  {
    key: "cro.base.oversight_plan",
    match: { serviceType: ["cro"] },
    prompt:
      "Provide your study-specific Sponsor Oversight Plan or equivalent governance document, including escalation triggers and joint review meeting cadence.",
    answerType: QuestionAnswerType.EVIDENCE_REQUEST,
    evidenceExpected: true,
    domainTag: "cro",
  },
  {
    key: "cro.critical.staff_continuity",
    match: { serviceType: ["cro"], derivedCriticality: HIGH_OR_CRITICAL },
    prompt:
      "Describe key staff continuity arrangements including succession plans for the project manager, lead CRA, and lead data manager.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: false,
    domainTag: "cro",
  },

  // ---------------------------------------------------------------------------
  // Monitoring / CRA services
  // ---------------------------------------------------------------------------
  {
    key: "monitoring.base.rbqm_strategy",
    match: { serviceType: ["monitoring", "cra_services"] },
    prompt:
      "Describe the risk-based quality management (RBQM) strategy applied to this study, including key risk indicators (KRIs), thresholds, and escalation paths.",
    answerType: QuestionAnswerType.NARRATIVE,
    evidenceExpected: true,
    domainTag: "monitoring",
  },
];

// =============================================================================
// Resolver
// Returns matching candidates for a given input. Deduplicates by ruleKey.
// =============================================================================
export function resolveAddendumCandidates(
  input: AddendumRuleInput
): AddendumQuestionCandidate[] {
  const matches: AddendumQuestionCandidate[] = [];

  for (const rule of ADDENDUM_RULES) {
    if (!matchesRule(rule.match, input)) continue;
    matches.push({
      prompt: rule.prompt,
      answerType: rule.answerType,
      evidenceExpected: rule.evidenceExpected,
      domainTag: rule.domainTag,
      ruleKey: rule.key,
    });
  }

  return matches;
}

function matchesRule(match: RuleMatch, input: AddendumRuleInput): boolean {
  if (match.serviceType && !match.serviceType.includes(input.serviceType)) {
    return false;
  }
  if (
    match.derivedCriticality &&
    !match.derivedCriticality.includes(input.derivedCriticality)
  ) {
    return false;
  }
  if (
    match.clinicalTrialPhase &&
    !match.clinicalTrialPhase.includes(input.clinicalTrialPhase)
  ) {
    return false;
  }
  if (
    match.operationalDomainTag &&
    !match.operationalDomainTag.includes(input.operationalDomainTag)
  ) {
    return false;
  }
  return true;
}
