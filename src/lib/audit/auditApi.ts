import { supabase } from '../supabase';
import type { AuditStage } from '../../types/audit';

// =============================================================================
// Audit-level operations: stage advancement + readout.
//
// Wraps audit_mode_advance_audit_stage and audit_mode_get_stage_readout in
// supabase/migrations/20260430200000_audit_mode_stage_advancement_rpc.sql.
// =============================================================================

interface AuditRow {
  id: string;
  current_stage: AuditStage;
}

export interface AdvanceAuditStageResult {
  ok: boolean;
  /** Returned when ok = true. */
  currentStage?: AuditStage;
  /** Returned when ok = false. */
  errorMessage?: string;
  /**
   * Postgres HINT, when raised by the RPC, is one of:
   *   GATE_QUESTIONNAIRE_NOT_APPROVED, GATE_RISK_SUMMARY_NOT_APPROVED,
   *   GATE_DELIVERABLES_NOT_APPROVED. Otherwise undefined.
   */
  errorHint?: string;
}

export async function advanceAuditStage(
  auditId: string,
  toStage: AuditStage,
  reason?: string,
): Promise<AdvanceAuditStageResult> {
  const { data, error } = await supabase.rpc('audit_mode_advance_audit_stage', {
    p_audit_id: auditId,
    p_to_stage: toStage,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[auditApi] advanceAuditStage error:', error);
    return {
      ok: false,
      errorMessage: error.message,
      // The supabase-js shape exposes hint on PostgrestError when present.
      errorHint: (error as unknown as { hint?: string }).hint,
    };
  }

  return { ok: true, currentStage: (data as AuditRow).current_stage };
}

export interface StageReadout {
  currentStage: AuditStage;
  position: number;
  total: number;
  questionnaireApproved: boolean;
  riskSummaryApproved: boolean;
  letterApproved: boolean;
  agendaApproved: boolean;
  checklistApproved: boolean;
  /** null when at FINAL_REVIEW_EXPORT (no further stage). */
  nextStage: AuditStage | null;
  canAdvance: boolean;
  blockedReason: string | null;
}

interface StageReadoutRow {
  current_stage: AuditStage;
  stage_position: number;
  total: number;
  questionnaire_approved: boolean;
  risk_summary_approved: boolean;
  letter_approved: boolean;
  agenda_approved: boolean;
  checklist_approved: boolean;
  next_stage: AuditStage | null;
  can_advance: boolean;
  blocked_reason: string | null;
}

export async function getStageReadout(auditId: string): Promise<StageReadout | null> {
  const { data, error } = await supabase.rpc('audit_mode_get_stage_readout', {
    p_audit_id: auditId,
  });

  if (error) {
    console.error('[auditApi] getStageReadout error:', error);
    return null;
  }

  // RETURNS TABLE comes back as an array; one row.
  const row = Array.isArray(data) ? (data[0] as StageReadoutRow | undefined) : null;
  if (!row) return null;

  return {
    currentStage: row.current_stage,
    position: row.stage_position,
    total: row.total,
    questionnaireApproved: row.questionnaire_approved,
    riskSummaryApproved: row.risk_summary_approved,
    letterApproved: row.letter_approved,
    agendaApproved: row.agenda_approved,
    checklistApproved: row.checklist_approved,
    nextStage: row.next_stage,
    canAdvance: row.can_advance,
    blockedReason: row.blocked_reason,
  };
}
