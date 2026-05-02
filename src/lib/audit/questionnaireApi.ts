import { supabase } from '../supabase';
import type {
  MockQuestion,
  MockQuestionnaireBundle,
  MockQuestionnaireInstance,
  MockResponse,
} from './mockQuestionnaire';
import type {
  QuestionAnswerType,
  QuestionOrigin,
  QuestionnaireInstanceStatus,
  ResponseSource,
  ResponseStatus,
} from '../../types/audit';

// =============================================================================
// Questionnaire (Stage 3) API
//
// Reads: direct SELECT (RLS scoped). Writes: RPCs in
// supabase/migrations/20260430150000_audit_mode_questionnaire_rpcs.sql.
// =============================================================================

interface QuestionnaireInstanceRow {
  id: string;
  audit_id: string;
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

interface QuestionRow {
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
}

interface QuestionnaireResponseRow {
  id: string;
  instance_id: string;
  question_id: string;
  audit_id: string;
  vendor_service_mapping_id: string | null;
  response_text: string | null;
  response_status: ResponseStatus;
  source: ResponseSource;
  source_reference: string | null;
  confidence_flag: boolean;
  inconsistency_flag: boolean;
  inconsistency_note: string | null;
  responded_by: string | null;
  responded_at: string | null;
}

function flattenQuestion(row: QuestionRow): MockQuestion {
  return {
    id: row.id,
    origin: row.origin,
    question_number: row.question_number,
    section_code: row.section_code,
    section_title: row.section_title,
    prompt: row.prompt,
    answer_type: row.answer_type,
    evidence_expected: row.evidence_expected,
    domain_tag: row.domain_tag,
    ordinal: row.ordinal,
  };
}

function flattenResponse(row: QuestionnaireResponseRow): MockResponse {
  return {
    id: row.id,
    instance_id: row.instance_id,
    question_id: row.question_id,
    response_text: row.response_text,
    response_status: row.response_status,
    source: row.source,
    source_reference: row.source_reference,
    inconsistency_flag: row.inconsistency_flag,
    inconsistency_note: row.inconsistency_note,
  };
}

async function flattenInstance(row: QuestionnaireInstanceRow): Promise<MockQuestionnaireInstance> {
  let approvedByName: string | null = null;
  if (row.approved_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('id', row.approved_by)
      .maybeSingle();
    approvedByName = (profile as { name?: string } | null)?.name ?? null;
  }

  return {
    id: row.id,
    audit_id: row.audit_id,
    status: row.status,
    vendor_contact_name: row.vendor_contact_name,
    vendor_contact_email: row.vendor_contact_email,
    vendor_contact_title: row.vendor_contact_title,
    addenda_generated_at: row.addenda_generated_at,
    sent_to_vendor_at: row.sent_to_vendor_at,
    vendor_responded_at: row.vendor_responded_at,
    completed_at: row.completed_at,
    approved_at: row.approved_at,
    approved_by_name: approvedByName,
  };
}

// ============================================================================
// Reads
// ============================================================================

export async function fetchQuestionnaireBundle(
  auditId: string
): Promise<MockQuestionnaireBundle | null> {
  const { data: instanceData, error: instanceError } = await supabase
    .from('questionnaire_instances')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (instanceError) {
    console.error('[questionnaireApi] fetchQuestionnaireBundle instance error:', instanceError);
    return null;
  }
  if (!instanceData) return null;

  const instanceRow = instanceData as QuestionnaireInstanceRow;

  // Template + addendum questions for this instance.
  // Template questions hang off template_version_id; addenda hang off instance_id.
  const [templateQs, addendumQs] = await Promise.all([
    supabase
      .from('questionnaire_questions')
      .select('*')
      .eq('template_version_id', instanceRow.template_version_id)
      .eq('origin', 'TEMPLATE')
      .order('ordinal', { ascending: true }),
    supabase
      .from('questionnaire_questions')
      .select('*')
      .eq('instance_id', instanceRow.id)
      .eq('origin', 'ADDENDUM')
      .order('ordinal', { ascending: true }),
  ]);

  if (templateQs.error) {
    console.error('[questionnaireApi] template questions error:', templateQs.error);
    return null;
  }
  if (addendumQs.error) {
    console.error('[questionnaireApi] addendum questions error:', addendumQs.error);
    return null;
  }

  const questions: MockQuestion[] = [
    ...((templateQs.data ?? []) as QuestionRow[]),
    ...((addendumQs.data ?? []) as QuestionRow[]),
  ].map(flattenQuestion).sort((a, b) => a.ordinal - b.ordinal);

  const { data: respData, error: respError } = await supabase
    .from('questionnaire_response_objects')
    .select('*')
    .eq('instance_id', instanceRow.id);

  if (respError) {
    console.error('[questionnaireApi] responses error:', respError);
    return null;
  }

  const responses: Record<string, MockResponse> = {};
  for (const row of (respData ?? []) as QuestionnaireResponseRow[]) {
    responses[row.question_id] = flattenResponse(row);
  }

  const instance = await flattenInstance(instanceRow);

  return { instance, questions, responses };
}

// Back-compat alias used by callers that still import the old name.
export const fetchQuestionnaireInstance = fetchQuestionnaireBundle;

// ============================================================================
// Mutations
// ============================================================================

export async function createQuestionnaireInstance(
  auditId: string,
  templateVersionId?: string
): Promise<MockQuestionnaireInstance | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_questionnaire_instance', {
    p_audit_id: auditId,
    p_template_version_id: templateVersionId ?? null,
  });

  if (error) {
    console.error('[questionnaireApi] createQuestionnaireInstance error:', error);
    return null;
  }

  return flattenInstance(data as QuestionnaireInstanceRow);
}

export async function transitionQuestionnaireStatus(
  instanceId: string,
  toStatus: QuestionnaireInstanceStatus,
  reason?: string
): Promise<MockQuestionnaireInstance | null> {
  const { data, error } = await supabase.rpc('audit_mode_transition_questionnaire_status', {
    p_instance_id: instanceId,
    p_to_status: toStatus,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[questionnaireApi] transitionQuestionnaireStatus error:', error);
    return null;
  }

  return flattenInstance(data as QuestionnaireInstanceRow);
}

export async function approveQuestionnaire(
  instanceId: string,
  reason?: string
): Promise<MockQuestionnaireInstance | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_questionnaire', {
    p_instance_id: instanceId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[questionnaireApi] approveQuestionnaire error:', error);
    return null;
  }

  return flattenInstance(data as QuestionnaireInstanceRow);
}

export async function upsertResponse(
  instanceId: string,
  questionId: string,
  responseText: string | null,
  options?: {
    response_status?: ResponseStatus;
    source?: ResponseSource;
    source_reference?: string | null;
    reason?: string;
  }
): Promise<MockResponse | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_questionnaire_response', {
    p_instance_id: instanceId,
    p_question_id: questionId,
    p_response_text: responseText,
    p_response_status: options?.response_status ?? null,
    p_source: options?.source ?? null,
    p_source_reference: options?.source_reference ?? null,
    p_reason: options?.reason ?? null,
  });

  if (error) {
    console.error('[questionnaireApi] upsertResponse error:', error);
    return null;
  }

  return flattenResponse(data as QuestionnaireResponseRow);
}

export async function setResponseInconsistency(
  responseId: string,
  flag: boolean,
  note: string | null,
  reason?: string
): Promise<MockResponse | null> {
  const { data, error } = await supabase.rpc('audit_mode_set_questionnaire_inconsistency', {
    p_response_id: responseId,
    p_flag: flag,
    p_note: note,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[questionnaireApi] setResponseInconsistency error:', error);
    return null;
  }

  return flattenResponse(data as QuestionnaireResponseRow);
}

// Note: addenda generation is intentionally not exposed here in Phase B.
// QuestionnaireReviewWorkspace updates local state synchronously when the
// auditor clicks "Generate addenda". Phase C will port the full
// ADDENDUM_RULES table from rv1_code/lib/questionnaire-addenda.ts into a
// generate_questionnaire_addenda RPC; that's where the API export will land.
