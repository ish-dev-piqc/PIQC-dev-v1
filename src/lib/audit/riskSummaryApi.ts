import { supabase } from '../supabase';
import type {
  MockProtocolRiskRef,
  MockRiskSummary,
} from './mockRiskSummary';
import type {
  RiskSummaryApprovalStatus,
  RiskSummaryStudyContext,
} from '../../types/audit';

// =============================================================================
// Risk Summary (Stage 4) API
//
// Reads: direct SELECT against vendor_risk_summary_objects + junction.
// Writes: RPCs in supabase/migrations/20260430160000_audit_mode_risk_summary_rpcs.sql.
// =============================================================================

interface RiskSummaryRow {
  id: string;
  audit_id: string;
  study_context: RiskSummaryStudyContext;
  vendor_relevance_narrative: string;
  focus_areas: string[];
  approval_status: RiskSummaryApprovalStatus;
  approved_at: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

async function flattenRiskSummary(row: RiskSummaryRow): Promise<MockRiskSummary> {
  let approvedByName: string | null = null;
  if (row.approved_by) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('name')
      .eq('id', row.approved_by)
      .maybeSingle();
    approvedByName = (profile as { name?: string } | null)?.name ?? null;
  }

  // Junction → protocol risk refs (display only). Supabase returns the
  // joined object as an array even for many-to-one; flatten and dedupe.
  const { data: junction } = await supabase
    .from('vendor_risk_summary_protocol_risks')
    .select('protocol_risk_objects(id, section_identifier, section_title, operational_domain_tag)')
    .eq('risk_summary_id', row.id);

  const protocolRiskRefs: MockProtocolRiskRef[] = ((junction ?? []) as unknown as Array<{
    protocol_risk_objects: MockProtocolRiskRef | MockProtocolRiskRef[] | null;
  }>)
    .flatMap((j) => {
      const v = j.protocol_risk_objects;
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    });

  return {
    id: row.id,
    audit_id: row.audit_id,
    study_context: row.study_context,
    vendor_relevance_narrative: row.vendor_relevance_narrative,
    focus_areas: row.focus_areas,
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: approvedByName,
    protocol_risk_refs: protocolRiskRefs,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function fetchRiskSummary(auditId: string): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase
    .from('vendor_risk_summary_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    console.error('[riskSummaryApi] fetchRiskSummary error:', error);
    return null;
  }
  if (!data) return null;

  return flattenRiskSummary(data as RiskSummaryRow);
}

export async function upsertRiskSummary(
  auditId: string,
  patch: {
    study_context?: RiskSummaryStudyContext;
    vendor_relevance_narrative?: string;
    focus_areas?: string[];
  },
  reason?: string
): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_risk_summary', {
    p_audit_id: auditId,
    p_study_context: patch.study_context ?? null,
    p_narrative: patch.vendor_relevance_narrative ?? null,
    p_focus_areas: patch.focus_areas ?? null,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[riskSummaryApi] upsertRiskSummary error:', error);
    return null;
  }

  return flattenRiskSummary(data as RiskSummaryRow);
}

export async function approveRiskSummary(
  summaryId: string,
  reason?: string
): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase.rpc('audit_mode_approve_risk_summary', {
    p_id: summaryId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[riskSummaryApi] approveRiskSummary error:', error);
    return null;
  }

  return flattenRiskSummary(data as RiskSummaryRow);
}

export async function revokeRiskSummaryApproval(
  summaryId: string,
  reason?: string
): Promise<MockRiskSummary | null> {
  const { data, error } = await supabase.rpc('audit_mode_revoke_risk_summary_approval', {
    p_id: summaryId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[riskSummaryApi] revokeRiskSummaryApproval error:', error);
    return null;
  }

  return flattenRiskSummary(data as RiskSummaryRow);
}

export async function linkProtocolRiskToSummary(
  summaryId: string,
  protocolRiskId: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('audit_mode_link_protocol_risk_to_summary', {
    p_summary_id: summaryId,
    p_protocol_risk_id: protocolRiskId,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[riskSummaryApi] linkProtocolRiskToSummary error:', error);
    return false;
  }
  return Boolean(data);
}

export async function unlinkProtocolRiskFromSummary(
  summaryId: string,
  protocolRiskId: string,
  reason?: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc('audit_mode_unlink_protocol_risk_from_summary', {
    p_summary_id: summaryId,
    p_protocol_risk_id: protocolRiskId,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[riskSummaryApi] unlinkProtocolRiskFromSummary error:', error);
    return false;
  }
  return Boolean(data);
}
