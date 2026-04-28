// =============================================================================
// Mock data for QUESTIONNAIRE_REVIEW stage.
//
// One canonical Standard GCP Vendor Questionnaire template seeds every
// instance. Each audit has its own QuestionnaireInstance forked from the
// template version, plus per-instance addenda (section 5.3.x) generated from
// vendor service mappings.
//
// Sponsor-name-free by rule.
// =============================================================================

import type {
  QuestionAnswerType,
  QuestionOrigin,
  QuestionnaireInstanceStatus,
  ResponseSource,
  ResponseStatus,
} from '../../types/audit';

// -----------------------------------------------------------------------------
// Question shape (template + addenda merged in one shape per the schema)
// -----------------------------------------------------------------------------
export interface MockQuestion {
  id: string;
  origin: QuestionOrigin;                  // TEMPLATE or ADDENDUM
  question_number: string;                 // e.g. "1.1.1", "5.3.2"
  section_code: string;                    // e.g. "1.1", "5.3"
  section_title: string;
  prompt: string;
  answer_type: QuestionAnswerType;
  evidence_expected: boolean;
  domain_tag: string | null;
  ordinal: number;
}

export interface MockResponse {
  id: string;
  instance_id: string;
  question_id: string;
  response_text: string | null;
  response_status: ResponseStatus;
  source: ResponseSource;
  source_reference: string | null;
  inconsistency_flag: boolean;
  inconsistency_note: string | null;
}

export interface MockQuestionnaireInstance {
  id: string;
  audit_id: string;
  status: QuestionnaireInstanceStatus;
  vendor_contact_name: string | null;
  vendor_contact_email: string | null;
  vendor_contact_title: string | null;
  addenda_generated_at: string | null;
  sent_to_vendor_at: string | null;
  vendor_responded_at: string | null;
  completed_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
}

// -----------------------------------------------------------------------------
// Standard GCP template questions
// -----------------------------------------------------------------------------
export const TEMPLATE_QUESTIONS: MockQuestion[] = [
  // Section 1.1 — Vendor Background
  {
    id: 'tq-1-1-1',
    origin: 'TEMPLATE',
    question_number: '1.1.1',
    section_code: '1.1',
    section_title: 'Vendor background',
    prompt: 'Provide your full registered legal name, primary office address, and country of incorporation.',
    answer_type: 'NARRATIVE',
    evidence_expected: false,
    domain_tag: null,
    ordinal: 1,
  },
  {
    id: 'tq-1-1-2',
    origin: 'TEMPLATE',
    question_number: '1.1.2',
    section_code: '1.1',
    section_title: 'Vendor background',
    prompt: 'List all certifications and accreditations currently held (ISO, HITRUST, SOC, etc.).',
    answer_type: 'LIST',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 2,
  },
  // Section 1.2 — Organisation
  {
    id: 'tq-1-2-1',
    origin: 'TEMPLATE',
    question_number: '1.2.1',
    section_code: '1.2',
    section_title: 'Organisation and personnel',
    prompt: 'Provide an organisational chart showing the chain of accountability for the contracted services.',
    answer_type: 'EVIDENCE_REQUEST',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 3,
  },
  {
    id: 'tq-1-2-2',
    origin: 'TEMPLATE',
    question_number: '1.2.2',
    section_code: '1.2',
    section_title: 'Organisation and personnel',
    prompt: 'How many staff are GCP-trained organisation-wide? Provide the most recent count.',
    answer_type: 'NUMERIC',
    evidence_expected: false,
    domain_tag: null,
    ordinal: 4,
  },
  // Section 4.1 — Data Protection
  {
    id: 'tq-4-1-1',
    origin: 'TEMPLATE',
    question_number: '4.1.1',
    section_code: '4.1',
    section_title: 'Data protection and privacy',
    prompt: 'Describe your conformance approach to 21 CFR Part 11 (electronic records and signatures).',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 5,
  },
  {
    id: 'tq-4-1-2',
    origin: 'TEMPLATE',
    question_number: '4.1.2',
    section_code: '4.1',
    section_title: 'Data protection and privacy',
    prompt: 'Do you have a current GDPR Data Processing Agreement available? If yes, summarise the lawful basis used.',
    answer_type: 'YES_NO_QUALIFY',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 6,
  },
  // Section 5.1 — Quality Management
  {
    id: 'tq-5-1-1',
    origin: 'TEMPLATE',
    question_number: '5.1.1',
    section_code: '5.1',
    section_title: 'Quality management system',
    prompt: 'Provide a current copy of your QMS top-level document or quality manual.',
    answer_type: 'EVIDENCE_REQUEST',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 7,
  },
  {
    id: 'tq-5-1-2',
    origin: 'TEMPLATE',
    question_number: '5.1.2',
    section_code: '5.1',
    section_title: 'Quality management system',
    prompt: 'Describe your CAPA process, including how systemic issues are escalated.',
    answer_type: 'NARRATIVE',
    evidence_expected: false,
    domain_tag: null,
    ordinal: 8,
  },
  {
    id: 'tq-5-2-1',
    origin: 'TEMPLATE',
    question_number: '5.2.1',
    section_code: '5.2',
    section_title: 'Validation and change control',
    prompt: 'Summarise your computer system validation lifecycle for systems supporting clinical trials.',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: null,
    ordinal: 9,
  },
];

// -----------------------------------------------------------------------------
// Per-audit instance + responses + addenda
// -----------------------------------------------------------------------------
export interface MockQuestionnaireBundle {
  instance: MockQuestionnaireInstance;
  questions: MockQuestion[];   // template + addenda merged (instance-scoped view)
  responses: Record<string, MockResponse>; // keyed by question_id
}

// audit-001 — BRIGHTEN-2 — PREFILL_IN_PROGRESS, addenda generated, several
// responses pre-filled from web research.
const BRIGHTEN_ADDENDA: MockQuestion[] = [
  {
    id: 'aq-001-1',
    origin: 'ADDENDUM',
    question_number: '5.3.1',
    section_code: '5.3',
    section_title: 'Service-specific (Full-service CRO)',
    prompt: 'Describe your data management plan workflow from EDC capture through database lock, including query resolution SLAs.',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: 'cro_full_service',
    ordinal: 10,
  },
  {
    id: 'aq-001-2',
    origin: 'ADDENDUM',
    question_number: '5.3.2',
    section_code: '5.3',
    section_title: 'Service-specific (Full-service CRO)',
    prompt: 'How is randomization independence enforced? Describe the audit trail and access controls.',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: 'IVRS',
    ordinal: 11,
  },
  {
    id: 'aq-001-3',
    origin: 'ADDENDUM',
    question_number: '5.3.3',
    section_code: '5.3',
    section_title: 'Service-specific (Full-service CRO)',
    prompt: 'Describe your pharmacovigilance pipeline: AE intake, MedDRA coding, regulatory submission timing.',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: 'pharmacovigilance',
    ordinal: 12,
  },
];

const IMMUNE_ADDENDA: MockQuestion[] = [
  {
    id: 'aq-003-1',
    origin: 'ADDENDUM',
    question_number: '5.3.1',
    section_code: '5.3',
    section_title: 'Service-specific (ePRO platform)',
    prompt: 'Describe your platform validation evidence for the scoring engine on the endpoint critical path.',
    answer_type: 'NARRATIVE',
    evidence_expected: true,
    domain_tag: 'ePRO',
    ordinal: 10,
  },
  {
    id: 'aq-003-2',
    origin: 'ADDENDUM',
    question_number: '5.3.2',
    section_code: '5.3',
    section_title: 'Service-specific (ePRO platform)',
    prompt: 'Provide your device hygiene SOP and last training/refresh schedule.',
    answer_type: 'EVIDENCE_REQUEST',
    evidence_expected: true,
    domain_tag: 'ePRO',
    ordinal: 11,
  },
];

export const MOCK_QUESTIONNAIRES: Record<string, MockQuestionnaireBundle | null> = {
  // ---------------------------------------------------------------------------
  'audit-001': {
    instance: {
      id: 'qi-001',
      audit_id: 'audit-001',
      status: 'PREFILL_IN_PROGRESS',
      vendor_contact_name: 'Maya Khoury',
      vendor_contact_email: 'maya.khoury@aurora-cs.example',
      vendor_contact_title: 'Quality Director',
      addenda_generated_at: '2026-04-23T11:30:00Z',
      sent_to_vendor_at: null,
      vendor_responded_at: null,
      completed_at: null,
      approved_at: null,
      approved_by_name: null,
    },
    questions: [...TEMPLATE_QUESTIONS, ...BRIGHTEN_ADDENDA],
    responses: {
      'tq-1-1-1': {
        id: 'qr-001-1',
        instance_id: 'qi-001',
        question_id: 'tq-1-1-1',
        response_text: 'Aurora Clinical Services Ltd, registered in the United Kingdom; primary office London with delivery centres in Bengaluru and Boston.',
        response_status: 'ANSWERED',
        source: 'AUDITOR_PREFILL_WEB',
        source_reference: 'https://aurora-cs.example/about',
        inconsistency_flag: false,
        inconsistency_note: null,
      },
      'tq-1-1-2': {
        id: 'qr-001-2',
        instance_id: 'qi-001',
        question_id: 'tq-1-1-2',
        response_text: 'ISO 9001:2015, ISO 27001:2022, GCP-trained staff (organisation-wide).',
        response_status: 'ANSWERED',
        source: 'AUDITOR_PREFILL_WEB',
        source_reference: 'https://aurora-cs.example/quality',
        inconsistency_flag: false,
        inconsistency_note: null,
      },
      'tq-4-1-1': {
        id: 'qr-001-3',
        instance_id: 'qi-001',
        question_id: 'tq-4-1-1',
        response_text: '',
        response_status: 'UNANSWERED',
        source: 'PENDING',
        source_reference: null,
        inconsistency_flag: false,
        inconsistency_note: null,
      },
    },
  },
  // ---------------------------------------------------------------------------
  // audit-002 — CARDIAC-7, INTAKE stage. No questionnaire yet.
  'audit-002': null,
  // ---------------------------------------------------------------------------
  'audit-003': {
    instance: {
      id: 'qi-003',
      audit_id: 'audit-003',
      status: 'COMPLETE',
      vendor_contact_name: 'Aman Patel',
      vendor_contact_email: 'aman.patel@patientpulse.example',
      vendor_contact_title: 'Compliance Lead',
      addenda_generated_at: '2026-04-12T09:15:00Z',
      sent_to_vendor_at: '2026-04-15T13:00:00Z',
      vendor_responded_at: '2026-04-22T16:45:00Z',
      completed_at: '2026-04-25T10:20:00Z',
      approved_at: '2026-04-26T08:30:00Z',
      approved_by_name: 'Kiara Patel',
    },
    questions: [...TEMPLATE_QUESTIONS, ...IMMUNE_ADDENDA],
    responses: Object.fromEntries(
      [...TEMPLATE_QUESTIONS, ...IMMUNE_ADDENDA].map((q, i) => [
        q.id,
        {
          id: `qr-003-${i + 1}`,
          instance_id: 'qi-003',
          question_id: q.id,
          response_text:
            q.origin === 'ADDENDUM'
              ? 'Vendor provided full response with supporting documentation; reviewed and accepted.'
              : 'Vendor response received and reviewed.',
          response_status: 'ANSWERED' as ResponseStatus,
          source: 'VENDOR' as ResponseSource,
          source_reference: null,
          inconsistency_flag: false,
          inconsistency_note: null,
        } satisfies MockResponse,
      ]),
    ),
  },
};
