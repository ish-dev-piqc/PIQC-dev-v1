// =============================================================================
// Questionnaire shapes + canonical template for QUESTIONNAIRE_REVIEW stage.
//
// One canonical Standard GCP Vendor Questionnaire template (TEMPLATE_QUESTIONS)
// seeds every instance. Each audit has its own QuestionnaireInstance forked
// from the template version, plus per-instance addenda (section 5.3.x)
// generated from vendor service mappings.
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
  // Row version from the touch trigger; approve compare-and-swaps on this.
  updated_at: string;
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
