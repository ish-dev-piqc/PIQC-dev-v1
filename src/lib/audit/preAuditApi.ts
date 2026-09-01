import { supabase } from '../supabase';
import type {
  MockAgenda,
  MockAgendaContent,
  MockChecklist,
  MockChecklistContent,
  MockConfirmationLetter,
  MockConfirmationLetterContent,
  MockEvidenceGapSummary,
  MockEvidenceGapSummaryContent,
  MockInternalNotification,
  MockInternalNotificationContent,
  MockPreAuditBundle,
} from './mockPreAudit';
import type {
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
  DeliverableApprovalStatus,
} from '../../types/audit';

// =============================================================================
// Pre-Audit Drafting (Stage 5) API
//
// Five structurally identical 1:1 deliverables: confirmation_letter_objects,
// agenda_objects, checklist_objects (RPCs in 20260430170000, approve CAS in
// 20260730000000), internal_notification_objects (PR-D1, 20260904000100) and
// evidence_gap_summary_objects (PR-D3, 20260905000100) — the last two
// non-gating, no prefill.
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
  updated_at: string;
  // Prefill provenance — present after the deliverable was agent-bootstrapped.
  // See 20260515020000_audit_mode_stage5_prefill.sql.
  source_risk_summary_id?: string | null;
  source_questionnaire_instance_id?: string | null;
  prefilled_at?: string | null;
  // Grounded-generation provenance (all three deliverables) — see
  // 20260831000000 + 20260901000000.
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

// One user_profiles query for a whole bundle (PR-5): the 5-way fetch used
// to issue one lookup per approved row. Single-row paths keep the solo
// resolver — one row is one lookup either way.
async function resolveApprovedByNames(
  approvedByIds: ReadonlyArray<string | null>,
): Promise<Map<string, string | null>> {
  const unique = [...new Set(approvedByIds.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, name')
    .in('id', unique);
  if (error) {
    console.error('[preAuditApi] resolveApprovedByNames error:', error);
    return new Map();
  }
  return new Map(
    ((data ?? []) as Array<{ id: string; name?: string }>).map((p) => [p.id, p.name ?? null]),
  );
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
  row: DeliverableRow<MockConfirmationLetterContent>,
  resolvedNames?: Map<string, string | null>,
): Promise<MockConfirmationLetter> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: resolvedNames
      ? (row.approved_by ? resolvedNames.get(row.approved_by) ?? null : null)
      : await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    source_risk_summary_id: row.source_risk_summary_id ?? null,
    source_questionnaire_instance_id: row.source_questionnaire_instance_id ?? null,
    prefilled_at: row.prefilled_at ?? null,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

async function flattenAgenda(
  row: DeliverableRow<MockAgendaContent>,
  resolvedNames?: Map<string, string | null>,
): Promise<MockAgenda> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: resolvedNames
      ? (row.approved_by ? resolvedNames.get(row.approved_by) ?? null : null)
      : await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    source_risk_summary_id: row.source_risk_summary_id ?? null,
    prefilled_at: row.prefilled_at ?? null,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

async function flattenChecklist(
  row: DeliverableRow<MockChecklistContent>,
  resolvedNames?: Map<string, string | null>,
): Promise<MockChecklist> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: resolvedNames
      ? (row.approved_by ? resolvedNames.get(row.approved_by) ?? null : null)
      : await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    source_questionnaire_instance_id: row.source_questionnaire_instance_id ?? null,
    prefilled_at: row.prefilled_at ?? null,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

async function flattenInternalNotification(
  row: DeliverableRow<MockInternalNotificationContent>,
  resolvedNames?: Map<string, string | null>,
): Promise<MockInternalNotification> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: resolvedNames
      ? (row.approved_by ? resolvedNames.get(row.approved_by) ?? null : null)
      : await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

async function flattenEvidenceGapSummary(
  row: DeliverableRow<MockEvidenceGapSummaryContent>,
  resolvedNames?: Map<string, string | null>,
): Promise<MockEvidenceGapSummary> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: row.content,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: resolvedNames
      ? (row.approved_by ? resolvedNames.get(row.approved_by) ?? null : null)
      : await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

// ============================================================================
// Reads
// ============================================================================

/** Bundle read result. The five SELECTs are independent, so one failed table
 *  must not nuke the other four — but a failed kind is NOT an absent kind:
 *  `failedKinds` names each table whose read errored, and its bundle slot is
 *  null-because-unknown, not null-because-missing. Callers that would render
 *  a scratch form, fire prefill, or compute currency off an absent row must
 *  check `failedKinds` first, or a transient read failure masquerades as
 *  "never drafted" (the silent-data-loss class this shape exists to end). */
export interface PreAuditBundleFetch {
  bundle: MockPreAuditBundle;
  failedKinds: (keyof MockPreAuditBundle)[];
}

export async function fetchPreAuditDeliverables(auditId: string): Promise<PreAuditBundleFetch> {
  const [letterRes, agendaRes, checklistRes, notificationRes, gapSummaryRes] = await Promise.all([
    supabase.from('confirmation_letter_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('agenda_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('checklist_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('internal_notification_objects').select('*').eq('audit_id', auditId).maybeSingle(),
    supabase.from('evidence_gap_summary_objects').select('*').eq('audit_id', auditId).maybeSingle(),
  ]);

  const failedKinds: (keyof MockPreAuditBundle)[] = [];
  if (letterRes.error) {
    failedKinds.push('confirmation_letter');
    console.error('[preAuditApi] confirmation_letter fetch error:', letterRes.error);
  }
  if (agendaRes.error) {
    failedKinds.push('agenda');
    console.error('[preAuditApi] agenda fetch error:', agendaRes.error);
  }
  if (checklistRes.error) {
    failedKinds.push('checklist');
    console.error('[preAuditApi] checklist fetch error:', checklistRes.error);
  }
  if (notificationRes.error) {
    failedKinds.push('internal_notification');
    console.error('[preAuditApi] internal_notification fetch error:', notificationRes.error);
  }
  if (gapSummaryRes.error) {
    failedKinds.push('evidence_gap_summary');
    console.error('[preAuditApi] evidence_gap_summary fetch error:', gapSummaryRes.error);
  }

  // One profiles lookup for the whole bundle (PR-5) — was one per row.
  const rowsForNames = [letterRes, agendaRes, checklistRes, notificationRes, gapSummaryRes]
    .map((r) => (r.data as { approved_by?: string | null } | null)?.approved_by ?? null);
  const approvedByNames = await resolveApprovedByNames(rowsForNames);

  const [confirmationLetter, agenda, checklist, internalNotification, evidenceGapSummary] = await Promise.all([
    letterRes.data
      ? flattenConfirmationLetter(letterRes.data as DeliverableRow<MockConfirmationLetterContent>, approvedByNames)
      : null,
    agendaRes.data
      ? flattenAgenda(agendaRes.data as DeliverableRow<MockAgendaContent>, approvedByNames)
      : null,
    checklistRes.data
      ? flattenChecklist(checklistRes.data as DeliverableRow<MockChecklistContent>, approvedByNames)
      : null,
    notificationRes.data
      ? flattenInternalNotification(notificationRes.data as DeliverableRow<MockInternalNotificationContent>, approvedByNames)
      : null,
    gapSummaryRes.data
      ? flattenEvidenceGapSummary(gapSummaryRes.data as DeliverableRow<MockEvidenceGapSummaryContent>, approvedByNames)
      : null,
  ]);

  return {
    bundle: {
      confirmation_letter: confirmationLetter,
      agenda,
      checklist,
      internal_notification: internalNotification,
      evidence_gap_summary: evidenceGapSummary,
    },
    failedKinds,
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

/** Result for deliverable readiness-latch approvals. On failure `errorHint`
 *  carries the server code when present: MISSING_EXPECTED_VERSION (client bug
 *  or stale bundle) | STALE_CONTENT (row changed since it was reviewed —
 *  refetch and re-review). */
export type DeliverableApproveResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; errorHint?: string };

function approveFailure(scope: string, error: { message: string; hint?: string }) {
  console.error(`[preAuditApi] ${scope} error:`, error);
  return {
    ok: false as const,
    error: error.message,
    errorHint: (error as { hint?: string }).hint,
  };
}

export async function approveConfirmationLetter(
  id: string,
  expectedUpdatedAt: string,
  reason?: string
): Promise<DeliverableApproveResult<MockConfirmationLetter>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_confirmation_letter', {
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return approveFailure('approveConfirmationLetter', error);
  return {
    ok: true,
    data: await flattenConfirmationLetter(data as DeliverableRow<MockConfirmationLetterContent>),
  };
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
  expectedUpdatedAt: string,
  reason?: string
): Promise<DeliverableApproveResult<MockAgenda>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_agenda', {
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return approveFailure('approveAgenda', error);
  return { ok: true, data: await flattenAgenda(data as DeliverableRow<MockAgendaContent>) };
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
  expectedUpdatedAt: string,
  reason?: string
): Promise<DeliverableApproveResult<MockChecklist>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_checklist', {
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return approveFailure('approveChecklist', error);
  return { ok: true, data: await flattenChecklist(data as DeliverableRow<MockChecklistContent>) };
}

// ============================================================================
// Internal notification (PR-D1) — non-gating; no prefill by design
// ============================================================================

export async function upsertInternalNotification(
  auditId: string,
  content: MockInternalNotificationContent,
  reason?: string
): Promise<MockInternalNotification | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_internal_notification', {
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] upsertInternalNotification error:', error);
    return null;
  }
  return flattenInternalNotification(data as DeliverableRow<MockInternalNotificationContent>);
}

export async function approveInternalNotification(
  id: string,
  expectedUpdatedAt: string,
  reason?: string
): Promise<DeliverableApproveResult<MockInternalNotification>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_internal_notification', {
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return approveFailure('approveInternalNotification', error);
  return {
    ok: true,
    data: await flattenInternalNotification(data as DeliverableRow<MockInternalNotificationContent>),
  };
}

// ============================================================================
// Evidence gap summary (PR-D3) — non-gating; no prefill by design
// ============================================================================

export async function upsertEvidenceGapSummary(
  auditId: string,
  content: MockEvidenceGapSummaryContent,
  reason?: string
): Promise<MockEvidenceGapSummary | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_evidence_gap_summary', {
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[preAuditApi] upsertEvidenceGapSummary error:', error);
    return null;
  }
  return flattenEvidenceGapSummary(data as DeliverableRow<MockEvidenceGapSummaryContent>);
}

export async function approveEvidenceGapSummary(
  id: string,
  expectedUpdatedAt: string,
  reason?: string
): Promise<DeliverableApproveResult<MockEvidenceGapSummary>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_evidence_gap_summary', {
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) return approveFailure('approveEvidenceGapSummary', error);
  return {
    ok: true,
    data: await flattenEvidenceGapSummary(data as DeliverableRow<MockEvidenceGapSummaryContent>),
  };
}

// ============================================================================
// Prefill (agent bootstrap) — one-shot on first Stage 5 open
//
// Each RPC inserts a fresh deliverable row built from approved Stage 3 /
// Stage 4 context. They raise 23505 if a row already exists; the caller
// treats that as a no-op (idempotent on absence). Errors other than 23505
// are logged but do not block the user — the deliverable simply stays empty
// and the auditor edits manually.
// ============================================================================

export async function prefillConfirmationLetter(
  auditId: string,
): Promise<MockConfirmationLetter | null> {
  const { data, error } = await supabase.rpc('audit_mode_prefill_confirmation_letter', {
    p_audit_id: auditId,
  });
  if (error) {
    if (error.code !== '23505') {
      console.error('[preAuditApi] prefillConfirmationLetter error:', error);
    }
    return null;
  }
  return flattenConfirmationLetter(data as DeliverableRow<MockConfirmationLetterContent>);
}

export async function prefillAgenda(auditId: string): Promise<MockAgenda | null> {
  const { data, error } = await supabase.rpc('audit_mode_prefill_agenda', {
    p_audit_id: auditId,
  });
  if (error) {
    if (error.code !== '23505') {
      console.error('[preAuditApi] prefillAgenda error:', error);
    }
    return null;
  }
  return flattenAgenda(data as DeliverableRow<MockAgendaContent>);
}

export async function prefillChecklist(auditId: string): Promise<MockChecklist | null> {
  const { data, error } = await supabase.rpc('audit_mode_prefill_checklist', {
    p_audit_id: auditId,
  });
  if (error) {
    if (error.code !== '23505') {
      console.error('[preAuditApi] prefillChecklist error:', error);
    }
    return null;
  }
  return flattenChecklist(data as DeliverableRow<MockChecklistContent>);
}

/**
 * Best-effort bootstrap of all three Stage 5 deliverables in parallel.
 *
 * - Skips deliverables that already exist (the RPC raises 23505; the wrapper
 *   swallows it and returns null).
 * - Skips silently when source pre-conditions aren't met (e.g. risk summary
 *   not yet APPROVED). Auditor sees empty deliverables and edits manually.
 * - Returns the freshly-prefilled deliverables only — caller merges these
 *   into the bundle and refetches the full bundle to pick up unchanged rows.
 */
export async function prefillStage5Deliverables(auditId: string): Promise<{
  confirmation_letter: MockConfirmationLetter | null;
  agenda: MockAgenda | null;
  checklist: MockChecklist | null;
}> {
  const [letter, agenda, checklist] = await Promise.all([
    prefillConfirmationLetter(auditId),
    prefillAgenda(auditId),
    prefillChecklist(auditId),
  ]);
  return { confirmation_letter: letter, agenda, checklist };
}
