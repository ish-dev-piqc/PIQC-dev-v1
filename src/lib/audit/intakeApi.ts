import { supabase } from '../supabase';
import type { TaggedSection } from './mockProtocolRisks';
import type {
  EndpointTier,
  ImpactSurface,
  TaggingMode,
  VersionChangeType,
} from '../../types/audit';

// =============================================================================
// Intake (Stage 1) API — protocol risk tagging.
//
// Reads: direct SELECT against protocol_risk_objects (RLS lets any
// authenticated user read; ProtocolRiskObjects are reference data).
//
// Writes: route through SECURITY DEFINER RPCs in
// supabase/migrations/20260430190000_audit_mode_intake_rpcs.sql. Those gate
// on `audit_mode_can_write_protocol_version` so only the lead auditor of
// some audit on that protocol_version can mutate its risks. Each mutation
// also writes a state_history_delta atomically.
//
// Note on tagged_at / tagging_mode: server stamps these. Clients send the
// values they want recorded for endpoint_tier / impact_surface / etc. — the
// server fills in tagged_by = auth.uid() and tagging_mode = 'MANUAL'.
// =============================================================================

interface ProtocolRiskRow {
  id: string;
  protocol_version_id: string;
  section_identifier: string;
  section_title: string;
  endpoint_tier: EndpointTier;
  impact_surface: ImpactSurface;
  time_sensitivity: boolean;
  vendor_dependency_flags: string[];
  operational_domain_tag: string;
  tagging_mode: TaggingMode;
  version_change_type: VersionChangeType;
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

// ============================================================================
// Reads
// ============================================================================

/**
 * Fetch all protocol risks for an audit by joining via its protocol_version.
 * Two queries instead of a Postgres view because the audit→version FK can
 * change (very rarely) and we'd rather re-read it than denormalise.
 */
export async function fetchProtocolRisksForAudit(auditId: string): Promise<TaggedSection[]> {
  const { data: auditRow, error: auditErr } = await supabase
    .from('audits')
    .select('protocol_version_id')
    .eq('id', auditId)
    .single();

  if (auditErr || !auditRow) {
    console.error('[intakeApi] fetchProtocolRisksForAudit — audit lookup failed:', auditErr);
    return [];
  }

  const { data, error } = await supabase
    .from('protocol_risk_objects')
    .select('*')
    .eq('protocol_version_id', (auditRow as { protocol_version_id: string }).protocol_version_id)
    .order('section_identifier', { ascending: true });

  if (error) {
    console.error('[intakeApi] fetchProtocolRisksForAudit — risks lookup failed:', error);
    return [];
  }

  return ((data ?? []) as ProtocolRiskRow[]).map(flattenRisk);
}

// ============================================================================
// Mutations (RPCs — atomic with delta tracking)
// ============================================================================

export interface CreateProtocolRiskInput {
  sectionIdentifier: string;
  sectionTitle: string;
  endpointTier: EndpointTier;
  impactSurface: ImpactSurface;
  timeSensitivity: boolean;
  vendorDependencyFlags: string[];
  operationalDomainTag: string;
  versionChangeType?: VersionChangeType;
  reason?: string;
}

export async function createProtocolRisk(
  protocolVersionId: string,
  input: CreateProtocolRiskInput,
): Promise<TaggedSection | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_protocol_risk', {
    p_protocol_version_id: protocolVersionId,
    p_section_identifier: input.sectionIdentifier,
    p_section_title: input.sectionTitle,
    p_endpoint_tier: input.endpointTier,
    p_impact_surface: input.impactSurface,
    p_time_sensitivity: input.timeSensitivity,
    p_vendor_dependency_flags: input.vendorDependencyFlags,
    p_operational_domain_tag: input.operationalDomainTag,
    p_version_change_type: input.versionChangeType ?? 'ADDED',
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[intakeApi] createProtocolRisk error:', error);
    return null;
  }

  return flattenRisk(data as ProtocolRiskRow);
}

export interface UpdateProtocolRiskInput {
  endpointTier?: EndpointTier;
  impactSurface?: ImpactSurface;
  timeSensitivity?: boolean;
  vendorDependencyFlags?: string[];
  operationalDomainTag?: string;
  versionChangeType?: VersionChangeType;
  reason?: string;
}

export async function updateProtocolRisk(
  riskId: string,
  input: UpdateProtocolRiskInput,
): Promise<TaggedSection | null> {
  const { data, error } = await supabase.rpc('audit_mode_update_protocol_risk', {
    p_id: riskId,
    p_endpoint_tier: input.endpointTier ?? null,
    p_impact_surface: input.impactSurface ?? null,
    p_time_sensitivity: input.timeSensitivity ?? null,
    p_vendor_dependency_flags: input.vendorDependencyFlags ?? null,
    p_operational_domain_tag: input.operationalDomainTag ?? null,
    p_version_change_type: input.versionChangeType ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[intakeApi] updateProtocolRisk error:', error);
    return null;
  }

  return flattenRisk(data as ProtocolRiskRow);
}

/**
 * Delete a protocol risk. Use sparingly — protocol risks are reference data
 * with downstream references (vendor_service_mapping_objects, etc.); a delete
 * will fail with a FK violation if anything depends on it. Corrections
 * usually happen via updateProtocolRisk; amendment ingest produces new rows
 * tied via previous_version_risk_id.
 *
 * The RPC writes a PROTOCOL_RISK_OBJECT delta with the deleted state captured
 * in the from-values so the audit trail can reconstruct what was removed.
 */
export async function deleteProtocolRisk(
  riskId: string,
  reason?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc('audit_mode_delete_protocol_risk', {
    p_id: riskId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[intakeApi] deleteProtocolRisk error:', error);
    return false;
  }

  return Boolean(data);
}
