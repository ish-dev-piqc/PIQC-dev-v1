import { supabase } from '../supabase';
import type { TaggedSection } from './mockProtocolRisks';

// =============================================================================
// Intake (Stage 1) API — protocol risk tagging reads and writes.
//
// Replaces mockProtocolRisks with real Supabase queries. RLS ensures you only
// see/edit risks belonging to audits you lead.
// =============================================================================

export interface ProtocolRiskRow {
  id: string;
  section_identifier: string;
  section_title: string;
  endpoint_tier: 'PRIMARY' | 'SECONDARY' | 'SAFETY' | 'SUPPORTIVE';
  impact_surface: 'DATA_INTEGRITY' | 'PATIENT_SAFETY' | 'BOTH';
  time_sensitivity: boolean;
  vendor_dependency_flags: string[];
  operational_domain_tag: string;
  tagging_mode: 'MANUAL' | 'PIQC_ASSISTED' | 'LLM_ASSISTED';
  version_change_type: 'ADDED' | 'MODIFIED' | 'UNCHANGED';
  protocol_version_id: string;
  tagged_by: string;
  tagged_at: string;
  created_at: string;
  updated_at: string;
}

function flattenRisk(row: ProtocolRiskRow): TaggedSection {
  return {
    id: row.id,
    section_identifier: row.section_identifier,
    section_title: row.section_title,
    endpoint_tier: row.endpoint_tier,
    impact_surface: row.impact_surface,
    time_sensitivity: row.time_sensitivity,
    vendor_dependency_flags: row.vendor_dependency_flags,
    operational_domain_tag: row.operational_domain_tag,
    tagging_mode: row.tagging_mode,
    version_change_type: row.version_change_type,
  };
}

/**
 * Fetch protocol risks via a direct join.
 * Subquery: fetch the protocol_version_id from the audit, then filter risks by that version.
 */
export async function fetchProtocolRisksForAudit(auditId: string): Promise<TaggedSection[]> {
  // First, get the audit to find its protocol_version_id
  const { data: auditData, error: auditError } = await supabase
    .from('audits')
    .select('protocol_version_id')
    .eq('id', auditId)
    .single();

  if (auditError || !auditData) {
    console.error('[intakeApi] fetchProtocolRisksForAudit - audit lookup failed:', auditError);
    return [];
  }

  // Then fetch all risks for that protocol version
  const { data, error } = await supabase
    .from('protocol_risk_objects')
    .select('*')
    .eq('protocol_version_id', auditData.protocol_version_id);

  if (error) {
    console.error('[intakeApi] fetchProtocolRisksForAudit - risks lookup failed:', error);
    return [];
  }

  return ((data ?? []) as ProtocolRiskRow[]).map(flattenRisk);
}

/**
 * Create a new protocol risk and write a state_history_delta.
 * Tags are recorded with the current user and timestamp.
 */
export async function createProtocolRisk(
  protocolVersionId: string,
  risk: Omit<TaggedSection, 'id'>
): Promise<TaggedSection | null> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    console.error('[intakeApi] createProtocolRisk: no authenticated user');
    return null;
  }

  const { data, error } = await supabase
    .from('protocol_risk_objects')
    .insert({
      protocol_version_id: protocolVersionId,
      section_identifier: risk.section_identifier,
      section_title: risk.section_title,
      endpoint_tier: risk.endpoint_tier,
      impact_surface: risk.impact_surface,
      time_sensitivity: risk.time_sensitivity,
      vendor_dependency_flags: risk.vendor_dependency_flags,
      operational_domain_tag: risk.operational_domain_tag,
      tagging_mode: risk.tagging_mode,
      version_change_type: risk.version_change_type,
      tagged_by: userId,
      tagged_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  if (error) {
    console.error('[intakeApi] createProtocolRisk error:', error);
    return null;
  }

  return flattenRisk(data as ProtocolRiskRow);
}

/**
 * Update an existing protocol risk.
 */
export async function updateProtocolRisk(
  riskId: string,
  updates: Partial<Omit<TaggedSection, 'id'>>
): Promise<TaggedSection | null> {
  const { data, error } = await supabase
    .from('protocol_risk_objects')
    .update(updates)
    .eq('id', riskId)
    .select('*')
    .single();

  if (error) {
    console.error('[intakeApi] updateProtocolRisk error:', error);
    return null;
  }

  return flattenRisk(data as ProtocolRiskRow);
}

/**
 * Delete a protocol risk.
 */
export async function deleteProtocolRisk(riskId: string): Promise<boolean> {
  const { error } = await supabase.from('protocol_risk_objects').delete().eq('id', riskId);

  if (error) {
    console.error('[intakeApi] deleteProtocolRisk error:', error);
    return false;
  }

  return true;
}
