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
): Promise<MockReportDraft | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_report_draft', {
    p_audit_id: auditId,
    p_executive_summary: executiveSummary,
    p_conclusions: conclusions,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[reportApi] upsertReportDraft error:', error);
    return null;
  }
  if (!data) return null;
  return flattenRow(data as ReportDraftRow);
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
