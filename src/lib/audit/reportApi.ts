import { supabase } from '../supabase';
import type { MockReportDraft } from './mockReport';
import type { DeliverableApprovalStatus } from '../../types/audit';

// =============================================================================
// Report Drafting (Stage 7) + Final Review Export (Stage 8) API
//
// Single 1:1 deliverable: report_draft_objects. Holds auditor-authored
// executive_summary and conclusions, the approval workflow, final sign-off,
// and export bookkeeping.
//
// Reads: direct SELECT. Writes: RPCs that mutate + write deltas atomically.
// =============================================================================

interface ReportDraftRow {
  id: string;
  audit_id: string;
  executive_summary: string;
  conclusions: string;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  final_signed_off_by: string | null;
  final_signed_off_at: string | null;
  exported_at: string | null;
  // Prefill provenance (Option E). Optional for backward compat with pre-PR
  // rows; present when the report was agent-bootstrapped.
  source_risk_summary_id?: string | null;
  prefilled_at?: string | null;
  // Exec-summary provenance (this PR). 'templated' | 'llm' | 'auditor_edited'.
  // NOT NULL on the server (DEFAULT 'templated' for backfill); optional here
  // only to allow rows fetched before the migration applied to deserialize.
  executive_summary_source?: 'templated' | 'llm' | 'auditor_edited';
}

async function resolveUserName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const { data } = await supabase
    .from('user_profiles')
    .select('name')
    .eq('id', userId)
    .maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

async function flattenRow(row: ReportDraftRow): Promise<MockReportDraft> {
  const [approvedByName, finalSignedOffByName] = await Promise.all([
    resolveUserName(row.approved_by),
    resolveUserName(row.final_signed_off_by),
  ]);
  return {
    id: row.id,
    audit_id: row.audit_id,
    executive_summary: row.executive_summary,
    conclusions: row.conclusions,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: approvedByName,
    final_signed_off_at: row.final_signed_off_at,
    final_signed_off_by_name: finalSignedOffByName,
    exported_at: row.exported_at,
    source_risk_summary_id: row.source_risk_summary_id ?? null,
    prefilled_at: row.prefilled_at ?? null,
    executive_summary_source: row.executive_summary_source ?? 'templated',
  };
}

// ============================================================================
// Reads
// ============================================================================

export async function fetchReportDraft(auditId: string): Promise<MockReportDraft | null> {
  const { data, error } = await supabase
    .from('report_draft_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();
  if (error) {
    console.error('[reportApi] fetchReportDraft error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}

// ============================================================================
// Stage 7 mutations
// ============================================================================

export async function upsertReportDraft(
  auditId: string,
  executiveSummary: string,
  conclusions: string,
  reason?: string,
  /** Optional. When provided, server records the new exec-summary provenance
   *  on the row. Omitted → server preserves the existing value (so saving an
   *  edit to `conclusions` only doesn't reset the exec-summary trail). */
  executiveSummarySource?: 'templated' | 'llm' | 'auditor_edited',
): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_report_draft', {
    p_audit_id: auditId,
    p_executive_summary: executiveSummary,
    p_conclusions: conclusions,
    p_reason: reason ?? null,
    p_executive_summary_source: executiveSummarySource ?? null,
  });
  if (error) {
    console.error('[reportApi] upsertReportDraft error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}

// ============================================================================
// LLM-drafted executive summary (Stage 7)
//
// Calls the audit-summary edge function under the user's JWT. The function
// fetches approved Stage 4 + Stage 6 server-side, builds a prompt, calls
// OpenAI gpt-4o-mini, and returns the narrative.
//
// The wrapper does NOT persist the result — caller decides whether to apply
// it. UI flow:
//   1. Auditor clicks "Refine with AI" on the exec-summary section
//   2. requestLlmExecutiveSummary(auditId) → { narrative }
//   3. UI shows the narrative for review; auditor edits if needed
//   4. UI calls upsertReportDraft with the new text + executiveSummarySource='llm'
// ============================================================================

export class LlmExecutiveSummaryError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'LlmExecutiveSummaryError';
    this.status = status;
  }
}

export async function requestLlmExecutiveSummary(
  auditId: string,
): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? supabaseAnonKey;

  const res = await fetch(`${supabaseUrl}/functions/v1/audit-summary`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audit_id: auditId }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    narrative?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new LlmExecutiveSummaryError(
      data.error || `LLM service returned ${res.status}`,
      res.status,
    );
  }
  if (!data.narrative) {
    throw new LlmExecutiveSummaryError('LLM service returned empty narrative', 502);
  }
  return data.narrative;
}

export async function approveReportDraft(
  id: string,
  reason?: string,
): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_report_draft', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[reportApi] approveReportDraft error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}

// ============================================================================
// Stage 8 mutations
// ============================================================================

export async function finalSignOffReport(
  id: string,
  reason?: string,
): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_final_sign_off_report', {
    p_id: id,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[reportApi] finalSignOffReport error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}

// ============================================================================
// Prefill (agent bootstrap) — one-shot on first Stage 7 open
//
// Bootstraps executive_summary + conclusions from approved Stage 4 risk
// summary + Stage 6 workspace entry counts. Mirrors PR #58's Stage 5 prefill
// pattern. The RPC raises 23505 if the report draft already exists; the
// wrapper swallows that as a no-op. Other errors are logged but don't block —
// the auditor just sees an empty draft and authors it manually.
// ============================================================================

export async function prefillReportDraft(auditId: string): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_prefill_report_draft', {
    p_audit_id: auditId,
  });
  if (error) {
    if (error.code !== '23505') {
      console.error('[reportApi] prefillReportDraft error:', error);
    }
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}

export async function markReportExported(id: string): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_mark_report_exported', {
    p_id: id,
  });
  if (error) {
    console.error('[reportApi] markReportExported error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
}
