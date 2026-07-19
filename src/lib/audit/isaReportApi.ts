import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type {
  IsaReportDraftObject,
  IsaSiteVerdict,
  IsaStoredSectionSource,
} from '../../types/audit';

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
  /** Omit on manual saves (RPC lands 'auditor_edited'); the apply path
   *  passes 'llm'. Same for the other three sections. */
  execSummarySource?: IsaStoredSectionSource;
  auditeeBackground?: string;
  clearAuditeeBackground?: boolean;
  auditeeBackgroundSource?: IsaStoredSectionSource;
  openingMeeting?: string;
  clearOpeningMeeting?: boolean;
  openingMeetingSource?: IsaStoredSectionSource;
  closingMeeting?: string;
  clearClosingMeeting?: boolean;
  closingMeetingSource?: IsaStoredSectionSource;
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
    p_exec_summary_source: input.execSummarySource ?? null,
    p_auditee_background: input.auditeeBackground ?? null,
    p_clear_auditee_background: input.clearAuditeeBackground ?? false,
    p_auditee_background_source: input.auditeeBackgroundSource ?? null,
    p_opening_meeting: input.openingMeeting ?? null,
    p_clear_opening_meeting: input.clearOpeningMeeting ?? false,
    p_opening_meeting_source: input.openingMeetingSource ?? null,
    p_closing_meeting: input.closingMeeting ?? null,
    p_clear_closing_meeting: input.clearClosingMeeting ?? false,
    p_closing_meeting_source: input.closingMeetingSource ?? null,
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

// ============================================================================
// LLM narrative sections (edge function isa-report-draft, S5)
// ============================================================================

export type IsaReportSectionKey =
  | 'exec_summary'
  | 'auditee_background'
  | 'opening_meeting'
  | 'closing_meeting';

export interface IsaReportSectionDraft {
  section: IsaReportSectionKey;
  section_text: string;
  note_count: number;
  finding_count: number;
}

export class IsaReportSectionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'IsaReportSectionError';
    this.status = status;
  }
}

/**
 * Ask PIQC to draft one narrative section. Returns a PROPOSAL — nothing
 * persists until the auditor applies it via upsertIsaReportDraft with
 * source 'llm' (D-008). Server-side guarantees: exec refuses until the site
 * verdict is set (409) and is anchor-gated (a draft that drops the
 * compliance statement, verdict sentence, or response clause is withheld,
 * 422); note sections 409 when the pad is empty.
 */
export async function requestIsaReportSection(
  auditId: string,
  section: IsaReportSectionKey,
): Promise<IsaReportSectionDraft> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/isa-report-draft`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audit_id: auditId, section }),
  });

  if (!res.ok) {
    let message = 'Section drafting failed';
    try {
      const payload = await res.json();
      if (typeof payload?.error === 'string') message = payload.error;
    } catch {
      // keep the generic message
    }
    throw new IsaReportSectionError(message, res.status);
  }

  return (await res.json()) as IsaReportSectionDraft;
}
