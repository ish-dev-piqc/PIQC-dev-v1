import type { IsaDomain } from '../../types/audit';

// =============================================================================
// ISA document request vocabulary — the CLOSED WORLD of standard documents an
// investigator-site auditor asks the site to have ready (isa-document-request).
//
// The request builder SELECTS from these lists; nothing composes document
// names at runtime and no model is involved. Rationale (citationMap.ts
// precedent): every title renders verbatim in the request letter that leaves
// PIQC, so a free-generated line would eventually name a document that does
// not exist or, worse, a subject. Closed-world selection makes that
// impossible; the auditor still includes, excludes, annotates and adds lines.
//
// Rules:
//   - BASELINE WINS. A domain set never re-lists a baseline document; it adds
//     the distinct documents that module needs.
//   - Subjects are selected DURING the audit (the owner's rule as the QA
//     auditor): subject-level lines read "for the subjects selected during
//     the audit (subject numbers only)" and never "sampled subjects". No line
//     asks for names, initials, dates of birth, medical record numbers or
//     the subject identification code list.
//   - No sponsor, vendor, product or brand names — the letter is generic by
//     construction.
//   - Keys are the merge identity across rebuilds (an auditor's include /
//     note survives by key). Adding a line = a new key; never re-key a line.
//   - Titles are display-ready; `detail` is the one-line instruction printed
//     under the title.
//
// Provenance: ICH E6(R3) essential records and site-audit practice under
// 21 CFR Parts 50, 56 and 312; baseline and phrasing reviewed by the product
// owner (a practising QA auditor) on 2026-09-06.
// =============================================================================

export interface StandardDocument {
  key: string;
  title: string;
  detail?: string;
}

/** Requested on every site audit, whatever the scope. */
export const BASELINE_DOCUMENTS: readonly StandardDocument[] = [
  {
    key: 'baseline:isf_index',
    title: 'Investigator site file (regulatory binder) with its current index',
    detail:
      'The complete essential-document file as maintained at the site, with the table of contents in use.',
  },
  {
    key: 'baseline:protocol_and_amendments',
    title: 'Current protocol and all amendments, with signed protocol signature pages',
    detail: 'Every version in effect during the site’s participation.',
  },
  {
    key: 'baseline:delegation_log',
    title: 'Delegation of authority log, all versions, with start and end dates',
    detail: 'Including delegations for staff who have since left the study.',
  },
  {
    key: 'baseline:form_1572_investigator_agreement',
    title: 'Form FDA 1572 (all versions) or the signed investigator agreement, as applicable',
  },
  {
    key: 'baseline:irb_approvals',
    title:
      'IRB/EC approval letters for the protocol, each amendment and each informed consent form version',
    detail: 'Including the initial approval and all continuing-review approvals.',
  },
  {
    key: 'baseline:screening_enrollment_log',
    title: 'Subject screening and enrollment log',
    detail: 'Subject numbers only. Do not send the subject identification code list.',
  },
  {
    key: 'baseline:deviation_log',
    title: 'Protocol deviation log with the site’s deviation reports',
    detail: 'All deviations since site activation, with IRB/EC notifications where required.',
  },
  {
    key: 'baseline:monitoring_visit_log',
    title: 'Monitoring visit log and monitoring follow-up letters',
  },
  {
    key: 'baseline:drug_accountability_pharmacy',
    title: 'Investigational product accountability and pharmacy records, as applicable',
    detail:
      'Shipment and receipt, dispensing and return, accountability logs, and return or destruction records.',
  },
];

/** The standard set of each site audit module. Keyed `${domain}:${slug}`. */
export const DOMAIN_DOCUMENTS: Record<IsaDomain, readonly StandardDocument[]> = {
  INFORMED_CONSENT: [
    {
      key: 'INFORMED_CONSENT:icf_versions',
      title:
        'All informed consent form versions, with IRB/EC approval dates and the period each was in use',
    },
    {
      key: 'INFORMED_CONSENT:signed_icfs_selected',
      title:
        'Signed and dated informed consent forms, including any re-consents, for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'INFORMED_CONSENT:consent_process_source',
      title:
        'Source documentation of the consent process for the subjects selected during the audit (subject numbers only)',
      detail: 'When, by whom and how consent was obtained, and that a copy was given to the subject.',
    },
    {
      key: 'INFORMED_CONSENT:consent_procedure',
      title: 'Site procedure for obtaining and documenting informed consent, if one exists',
    },
    {
      key: 'INFORMED_CONSENT:translated_short_form',
      title: 'Translated or short-form consent documents and translator or witness records, where used',
    },
    {
      key: 'INFORMED_CONSENT:assent_lar',
      title: 'Assent forms and legally authorized representative documentation, where applicable',
    },
  ],
  INVESTIGATOR_OVERSIGHT_DELEGATION: [
    {
      key: 'INVESTIGATOR_OVERSIGHT_DELEGATION:pi_oversight_records',
      title:
        'Records of investigator oversight (review and sign-off of visits, eligibility and safety data) for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'INVESTIGATOR_OVERSIGHT_DELEGATION:team_communication',
      title: 'Study team meeting minutes or other records of investigator communication with delegated staff',
    },
    {
      key: 'INVESTIGATOR_OVERSIGHT_DELEGATION:sub_investigator_records',
      title: 'Sub-investigator listing and, where applicable, their appointment or agreement records',
    },
    {
      key: 'INVESTIGATOR_OVERSIGHT_DELEGATION:third_party_agreements',
      title:
        'Agreements with third parties performing delegated trial activities (local laboratory, pharmacy, imaging)',
    },
  ],
  // Accountability and pharmacy records are baseline; this set adds what the
  // module needs beyond them.
  INVESTIGATIONAL_PRODUCT: [
    {
      key: 'INVESTIGATIONAL_PRODUCT:storage_temperature',
      title: 'Storage temperature logs and excursion reports for the investigational product storage area',
    },
    {
      key: 'INVESTIGATIONAL_PRODUCT:randomization_unblinding',
      title: 'Randomization and unblinding records, including any emergency unblinding documentation',
    },
    {
      key: 'INVESTIGATIONAL_PRODUCT:subject_dispensing_compliance',
      title:
        'Dispensing, return and compliance records for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'INVESTIGATIONAL_PRODUCT:ip_handling_procedure',
      title:
        'Site or pharmacy procedure for investigational product receipt, storage, dispensing and return, if one exists',
    },
  ],
  SAFETY_AE_SAE: [
    {
      key: 'SAFETY_AE_SAE:ae_source_selected',
      title:
        'Adverse event listings and supporting source records for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'SAFETY_AE_SAE:sae_reports',
      title: 'SAE report forms with submission dates and follow-up reports for all SAEs at the site',
    },
    {
      key: 'SAFETY_AE_SAE:irb_safety_submissions',
      title: 'IRB/EC safety submissions and acknowledgments (SAEs, unanticipated problems, safety letters)',
    },
    {
      key: 'SAFETY_AE_SAE:safety_letter_log',
      title: 'Log of safety reports received, with investigator review and acknowledgment',
    },
    {
      key: 'SAFETY_AE_SAE:ae_procedure',
      title: 'Site procedure for adverse event identification, assessment and reporting, if one exists',
    },
  ],
  SOURCE_DATA_VERIFICATION: [
    {
      key: 'SOURCE_DATA_VERIFICATION:source_records_selected',
      title:
        'Complete source records (medical records, study worksheets, visit notes) for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'SOURCE_DATA_VERIFICATION:crf_access_selected',
      title:
        'Read-only access to, or printouts of, the case report forms for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'SOURCE_DATA_VERIFICATION:eligibility_selected',
      title:
        'Eligibility documentation (inclusion and exclusion checklists with supporting source) for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'SOURCE_DATA_VERIFICATION:lab_ecg_imaging_selected',
      title:
        'Laboratory, ECG and imaging reports with investigator review and clinical significance assessment for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'SOURCE_DATA_VERIFICATION:query_history_selected',
      title: 'Data query history for the subjects selected during the audit (subject numbers only)',
    },
  ],
  RECORDKEEPING_SOURCE_DOCS: [
    {
      key: 'RECORDKEEPING_SOURCE_DOCS:source_location_list',
      title: 'Source document location list (what constitutes source at the site and where it is held)',
    },
    {
      key: 'RECORDKEEPING_SOURCE_DOCS:notes_to_file',
      title: 'Notes to file and memoranda in the site file',
    },
    {
      key: 'RECORDKEEPING_SOURCE_DOCS:correction_procedure',
      title: 'Site procedure for source data corrections, if one exists',
    },
    {
      key: 'RECORDKEEPING_SOURCE_DOCS:retention_archive',
      title: 'Record retention policy and archive arrangements for trial records',
    },
    {
      key: 'RECORDKEEPING_SOURCE_DOCS:confidentiality_controls',
      title:
        'Procedure for protecting subject confidentiality in trial records, including where the subject identification code list is held',
    },
  ],
  ESSENTIAL_DOCUMENTS: [
    {
      key: 'ESSENTIAL_DOCUMENTS:investigator_brochure',
      title: 'Investigator’s brochure, all versions, with documentation of receipt and investigator review',
    },
    {
      key: 'ESSENTIAL_DOCUMENTS:financial_disclosure',
      title: 'Financial disclosure forms for the investigator and sub-investigators',
    },
    {
      key: 'ESSENTIAL_DOCUMENTS:lab_certifications_ranges',
      title:
        'Laboratory certifications or accreditations, normal ranges (all versions) and laboratory director CV for each laboratory used',
    },
    {
      key: 'ESSENTIAL_DOCUMENTS:subject_facing_materials',
      title:
        'Subject-facing materials (diaries, questionnaires, recruitment advertisements) with their IRB/EC approvals',
    },
    {
      key: 'ESSENTIAL_DOCUMENTS:trial_correspondence',
      title: 'Relevant trial correspondence with the IRB/EC, the monitor and regulatory authorities',
    },
  ],
  IRB_EC: [
    {
      key: 'IRB_EC:roster_assurance',
      title: 'IRB/EC membership roster and registration or written assurance in effect during the trial',
    },
    {
      key: 'IRB_EC:continuing_review',
      title: 'Continuing review approvals and the progress reports submitted for them',
    },
    {
      key: 'IRB_EC:submissions_log',
      title:
        'Log of all IRB/EC submissions (amendments, consent changes, deviations, safety reports) with acknowledgment dates',
    },
    {
      key: 'IRB_EC:correspondence_conditions',
      title: 'IRB/EC correspondence, including any conditions of approval and the site’s responses',
    },
  ],
  STAFF_QUALIFICATIONS_TRAINING: [
    {
      key: 'STAFF_QUALIFICATIONS_TRAINING:cvs_licenses',
      title:
        'Current, signed and dated CVs and professional licenses for the investigator, sub-investigators and delegated staff',
    },
    {
      key: 'STAFF_QUALIFICATIONS_TRAINING:gcp_training',
      title: 'GCP training certificates for all delegated staff',
    },
    {
      key: 'STAFF_QUALIFICATIONS_TRAINING:protocol_training',
      title: 'Protocol and amendment training records for delegated staff, with dates',
    },
    {
      key: 'STAFF_QUALIFICATIONS_TRAINING:system_training',
      title:
        'Study-specific system training records (EDC, IWRS, ePRO, laboratory manual) for delegated staff',
    },
    {
      key: 'STAFF_QUALIFICATIONS_TRAINING:training_matrix',
      title: 'Site training log or matrix mapping staff to delegated tasks',
    },
  ],
  FACILITIES_EQUIPMENT: [
    {
      key: 'FACILITIES_EQUIPMENT:equipment_list',
      title: 'List of equipment used for protocol assessments, with location and responsible person',
    },
    {
      key: 'FACILITIES_EQUIPMENT:calibration_maintenance',
      title:
        'Calibration, maintenance and service records for study equipment (scales, ECG machines, centrifuges, freezers, thermometers)',
    },
    {
      key: 'FACILITIES_EQUIPMENT:storage_temperature_monitoring',
      title:
        'Temperature monitoring records for biological sample storage areas, including alarm and excursion handling',
    },
    {
      key: 'FACILITIES_EQUIPMENT:emergency_provisions',
      title: 'Emergency equipment checks and procedures for the study area',
    },
    {
      key: 'FACILITIES_EQUIPMENT:access_security',
      title: 'Facility access and security arrangements for study areas and record storage',
    },
  ],
  ELECTRONIC_SYSTEMS: [
    {
      key: 'ELECTRONIC_SYSTEMS:system_inventory',
      title:
        'List of electronic systems holding trial data (EHR, EDC, ePRO, eSource, IWRS) with the site’s role in each',
    },
    {
      key: 'ELECTRONIC_SYSTEMS:user_access_records',
      title:
        'User access lists and account management records for trial systems (creation, role changes, deactivation)',
    },
    {
      key: 'ELECTRONIC_SYSTEMS:audit_trail_selected',
      title:
        'Access to audit trails for the electronic records of the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'ELECTRONIC_SYSTEMS:site_system_controls',
      title: 'Validation, backup and disaster-recovery documentation for site-owned systems used as source',
    },
    {
      key: 'ELECTRONIC_SYSTEMS:certified_copy_procedure',
      title: 'Procedure for producing certified copies from electronic source, if one exists',
    },
  ],
  STUDY_CONDUCT_GCP: [
    {
      key: 'STUDY_CONDUCT_GCP:visit_window_compliance',
      title:
        'Visit schedule and visit-window compliance records for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'STUDY_CONDUCT_GCP:procedure_records_selected',
      title:
        'Records of protocol-required assessments and procedures for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'STUDY_CONDUCT_GCP:withdrawal_discontinuation',
      title:
        'Withdrawal, discontinuation and lost-to-follow-up documentation for the subjects selected during the audit (subject numbers only)',
    },
    {
      key: 'STUDY_CONDUCT_GCP:deviation_capa',
      title: 'Corrective and preventive actions taken in response to protocol deviations',
    },
    {
      key: 'STUDY_CONDUCT_GCP:sample_handling',
      title: 'Biological sample collection, processing, storage and shipment records',
    },
  ],
  CLINICAL_MONITORING: [
    {
      key: 'CLINICAL_MONITORING:finding_resolution',
      title: 'Site records of monitoring findings and the actions taken to resolve them',
    },
    {
      key: 'CLINICAL_MONITORING:monitor_correspondence',
      title: 'Correspondence with the monitor on open issues, data queries and action items',
    },
    {
      key: 'CLINICAL_MONITORING:sdv_status',
      title: 'Status of source data verification (subjects and visits monitored) as recorded at the site',
    },
    {
      key: 'CLINICAL_MONITORING:prior_audits_inspections',
      title: 'Reports of previous audits or regulatory inspections at the site, with responses',
    },
  ],
  SOP_REVIEW: [
    {
      key: 'SOP_REVIEW:sop_index',
      title: 'Index of site SOPs applicable to clinical research, with version and effective dates',
    },
    {
      key: 'SOP_REVIEW:key_sops',
      title:
        'Current SOPs covering informed consent, adverse event reporting, investigational product handling, source documentation and training',
    },
    {
      key: 'SOP_REVIEW:sop_training',
      title: 'Staff SOP training and acknowledgment records',
    },
    {
      key: 'SOP_REVIEW:revision_history',
      title: 'SOP review and revision history with change-control records',
    },
  ],
  // "Other" has no standard set — the auditor adds lines by hand.
  OTHER: [],
};

/** Prefilled into every new request; the auditor edits it per audit and the
 *  letter states it. Free text on purpose — a structured rule is ledgered. */
export const DEFAULT_SAMPLING_APPROACH =
  'Subjects are selected by the auditor during the audit from the screening and enrollment log: all subjects with a serious adverse event or a protocol deviation, plus a representative sample of the remaining enrolled subjects.';

/** The fixed subject-level paragraph of every request letter. One home; the
 *  HTML, plain-text and .docx renderers all print it verbatim. */
export const SUBJECT_SELECTION_NOTICE =
  'Subject-level records: the auditor will select subjects for review during the audit from the screening and enrollment log. Please ensure the records of all enrolled subjects are accessible during the visit. Identify subjects by subject number only — no names, initials, dates of birth, medical record numbers or other direct identifiers. The subject identification code list remains at the site and must not be sent to the auditor.';
