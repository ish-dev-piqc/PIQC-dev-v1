import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { IsaDomain, SiteModuleMapping } from '../../types/audit';

// =============================================================================
// Site modules API — site_module_mapping_objects (isa-site-modules).
//
// Reads the table directly (RLS: lead auditor of the audit); writes go
// through the RPCs in 20260917000100, which derive the criticality and the
// rationale server-side and write a state_history_delta per change.
//
// "Not applied yet" is a first-class read outcome, not an error: until the
// schema migration runs on this project the table is missing, which
// PostgREST reports as PGRST205 (older builds: Postgres 42P01). The panel
// shows that state and offers nothing — same shape as protocolReadinessApi.
// =============================================================================

export type SiteModuleMappings =
  | { available: false }
  | { available: true; mappings: SiteModuleMapping[] };

export async function fetchSiteModuleMappings(
  auditId: string,
): Promise<Result<SiteModuleMappings>> {
  const { data, error } = await supabase
    .from('site_module_mapping_objects')
    .select('*')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { ok: true, data: { available: false } };
    }
    console.error('[siteModulesApi] fetchSiteModuleMappings error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: { available: true, mappings: (data ?? []) as SiteModuleMapping[] } };
}

export async function createSiteModuleMapping(
  auditId: string,
  protocolRiskId: string,
  isaDomain: IsaDomain,
): Promise<Result<SiteModuleMapping>> {
  const { data, error } = await supabase.rpc('audit_mode_create_site_module_mapping', {
    p_audit_id: auditId,
    p_protocol_risk_id: protocolRiskId,
    p_isa_domain: isaDomain,
  });

  if (error) {
    console.error('[siteModulesApi] createSiteModuleMapping error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: data as SiteModuleMapping };
}

export async function deleteSiteModuleMapping(
  mappingId: string,
  reason?: string,
): Promise<Result<boolean>> {
  const { data, error } = await supabase.rpc('audit_mode_delete_site_module_mapping', {
    p_id: mappingId,
    p_reason: reason ?? null,
  });

  if (error) {
    console.error('[siteModulesApi] deleteSiteModuleMapping error:', error);
    return { ok: false, error: error.message };
  }

  return { ok: true, data: Boolean(data) };
}
