import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { IsaReportDraftObject, IsaSiteVerdict } from '../../types/audit';

// =============================================================================
// ISA report draft API — isa_report_draft_objects fetch + upsert.
//
// One row per audit; the upsert RPC creates it lazily on first save and
// writes a state_history_delta per changed field (verdict changes included —
// the most consequential field carries the most legible trail). NULL prose
// columns mean "still templated"; clear flags return a section to templated.
// =============================================================================

export async function fetchIsaReportDraft(
  auditId: string,
): Promise<Result<IsaReportDraftObject | null>> {
  const { data, error } = await supabase
    .from('isa_report_draft_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    console.error('[isaReportApi] fetchIsaReportDraft error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: (data as IsaReportDraftObject | null) ?? null };
}

export interface UpsertIsaReportDraftInput {
  execSummary?: string;
  clearExecSummary?: boolean;
  auditeeBackground?: string;
  clearAuditeeBackground?: boolean;
  openingMeeting?: string;
  clearOpeningMeeting?: boolean;
  closingMeeting?: string;
  clearClosingMeeting?: boolean;
  siteVerdict?: IsaSiteVerdict;
  clearSiteVerdict?: boolean;
  siteVerdictText?: string;
  clearSiteVerdictText?: boolean;
  responseDueDays?: number;
  responseDueBasis?: 'CALENDAR' | 'BUSINESS';
  reason?: string;
}

export async function upsertIsaReportDraft(
  auditId: string,
  input: UpsertIsaReportDraftInput,
): Promise<Result<IsaReportDraftObject>> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_isa_report_draft', {
    p_audit_id: auditId,
    p_exec_summary: input.execSummary ?? null,
    p_clear_exec_summary: input.clearExecSummary ?? false,
    p_auditee_background: input.auditeeBackground ?? null,
    p_clear_auditee_background: input.clearAuditeeBackground ?? false,
    p_opening_meeting: input.openingMeeting ?? null,
    p_clear_opening_meeting: input.clearOpeningMeeting ?? false,
    p_closing_meeting: input.closingMeeting ?? null,
    p_clear_closing_meeting: input.clearClosingMeeting ?? false,
    p_site_verdict: input.siteVerdict ?? null,
    p_clear_site_verdict: input.clearSiteVerdict ?? false,
    p_site_verdict_text: input.siteVerdictText ?? null,
    p_clear_site_verdict_text: input.clearSiteVerdictText ?? false,
    p_response_due_days: input.responseDueDays ?? null,
    p_response_due_basis: input.responseDueBasis ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[isaReportApi] upsertIsaReportDraft error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as IsaReportDraftObject };
}
