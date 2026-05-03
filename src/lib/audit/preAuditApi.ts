import { supabase } from '../supabase';
import type {
  MockAgenda,
  MockAgendaContent,
  MockChecklist,
  MockChecklistContent,
  MockConfirmationLetter,
  MockConfirmationLetterContent,
  MockPreAuditBundle,
} from './mockPreAudit';
import type { DeliverableApprovalStatus } from '../../types/audit';

// =============================================================================
// Pre-Audit Drafting (Stage 5) API
//
// Three structurally identical 1:1 deliverables: confirmation_letter_objects,
// agenda_objects, checklist_objects. Each has its own RPCs in
// supabase/migrations/20260430170000_audit_mode_pre_audit_rpcs.sql.
//
// Reads: direct SELECT. Writes: RPCs that mutate + write deltas atomically.
// =============================================================================

interface DeliverableRow<TContent> {
  id: string;
  audit_id: string;
  content: TContent;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
}

async function resolveApprovedByName(approvedBy: string | null): Promise<string | null> {
  if (!approvedBy) return null;
  const { data } = await supabase
    .from('user_profiles')
    .select('name')
    .eq('id', approvedBy)
    .maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

async function flattenConfirmationLetter(
  row: DeliverableRow<MockConfirmationLetterContent>
): Promise<MockConfirmationLetter> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
  };
}

async function flattenAgenda(
  row: DeliverableRow<MockAgendaContent>
): Promise<MockAgenda> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
  };
}

async function flattenChecklist(
  row: DeliverableRow<MockChecklistContent>
): Promise<MockChecklist> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
  };
}

// ============================================================================
// Reads
// ============================================================================

export async function fetchPreAuditDeliverables(auditId: string): Promise<MockPreAuditBundle> {
  const [letterRes, agendaRes, checklistRes] = await Promise.all([
    supabase.from('confirmation_letter_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('agenda_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('checklist_objects').select('*').eq('audit_id', auditId).maybeSingle(),
  ]);

  if (letterRes.error) console.error('[preAuditApi] confirmation_letter fetch error:', letterRes.error);
  if (agendaRes.error) console.error('[preAuditApi] agenda fetch error:', agendaRes.error);
  if (checklistRes.error) console.error('[preAuditApi] checklist fetch error:', checklistRes.error);

  const [confirmationLetter, agenda, checklist] = await Promise.all([
    letterRes.data
      ? flattenConfirmationLetter(letterRes.data as DeliverableRow<MockConfirmationLetterContent>)
      : null,
    agendaRes.data
      ? flattenAgenda(agendaRes.data as DeliverableRow<MockAgendaContent>)
      : null,
    checklistRes.data
      ? flattenChecklist(checklistRes.data as DeliverableRow<MockChecklistContent>)
      : null,
  ]);

  return {
    confirmation_letter: confirmationLetter,
    agenda,
    checklist,
  };
}

// ============================================================================
// Confirmation Letter
// ============================================================================

export async function upsertConfirmationLetter(
  auditId: string,
  content: MockConfirmationLetterContent,
  reason?: string
): Promise<MockConfirmationLetter | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_confirmation_letter', {
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] upsertConfirmationLetter error:', error);
    return null;
  }
  return flattenConfirmationLetter(data as DeliverableRow<MockConfirmationLetterContent>);
}

export async function approveConfirmationLetter(
  id: string,
  reason?: string
): Promise<MockConfirmationLetter | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_confirmation_letter', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] approveConfirmationLetter error:', error);
    return null;
  }
  return flattenConfirmationLetter(data as DeliverableRow<MockConfirmationLetterContent>);
}

// ============================================================================
// Agenda
// ============================================================================

export async function upsertAgenda(
  auditId: string,
  content: MockAgendaContent,
  reason?: string
): Promise<MockAgenda | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_agenda', {
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] upsertAgenda error:', error);
    return null;
  }
  return flattenAgenda(data as DeliverableRow<MockAgendaContent>);
}

export async function approveAgenda(
  id: string,
  reason?: string
): Promise<MockAgenda | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_agenda', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] approveAgenda error:', error);
    return null;
  }
  return flattenAgenda(data as DeliverableRow<MockAgendaContent>);
}

// ============================================================================
// Checklist
// ============================================================================

export async function upsertChecklist(
  auditId: string,
  content: MockChecklistContent,
  reason?: string
): Promise<MockChecklist | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_checklist', {
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] upsertChecklist error:', error);
    return null;
  }
  return flattenChecklist(data as DeliverableRow<MockChecklistContent>);
}

export async function approveChecklist(
  id: string,
  reason?: string
): Promise<MockChecklist | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_checklist', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] approveChecklist error:', error);
    return null;
  }
  return flattenChecklist(data as DeliverableRow<MockChecklistContent>);
}
