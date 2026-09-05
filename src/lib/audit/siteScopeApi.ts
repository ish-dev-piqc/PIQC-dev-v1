import { supabase } from '../supabase';
import { resolveApprovedByName, type DeliverableApproveResult } from './preAuditApi';
import type {
  DeliverableApprovalStatus,
  SiteScopeContent,
  SiteScopeModule,
} from '../../types/audit';

// =============================================================================
// Site scope API — site_scope_objects (isa-scope-builder), the 8th kind on
// the generic deliverable pair.
//
// Writes go through audit_mode_upsert_deliverable / audit_mode_approve_
// deliverable with p_kind 'site_scope' (20260918000100 adds the arm). The
// kind declares NO basis pin: approve carries only the updated_at CAS
// (STALE_CONTENT on mismatch) and must not pass a basis digest — the server
// refuses one for a basis-less kind (22023). Wrapper shapes (row | null
// upsert, DeliverableApproveResult approve) match auditCertificate.ts, so
// useDeliverablePersistence's revert contract holds.
//
// The read has THREE outcomes, all first-class: the row (or its absence),
// "not applied yet" (the table is missing until the schema migration runs —
// PGRST205, older builds 42P01; siteModulesApi precedent), and "failed"
// (the row state is UNKNOWN — the workspace renders Retry, never an empty
// "build it" state over an error).
// =============================================================================

export interface SiteScope {
  id: string;
  audit_id: string;
  content: SiteScopeContent;
  approval_status: DeliverableApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  updated_at: string;
}

interface SiteScopeRow {
  id: string;
  audit_id: string;
  content: {
    built_from?: { mapping_ids?: unknown; built_at?: unknown } | null;
    modules?: unknown;
  } | null;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
}

async function flattenSiteScope(row: SiteScopeRow): Promise<SiteScope> {
  // The upsert RPC does not validate the jsonb shape — tolerate a malformed
  // top level the way auditCertificate does. The modules array is trusted:
  // buildSiteScopeContent is its only writer.
  const builtFrom = row.content?.built_from;
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: {
      built_from: {
        mapping_ids: Array.isArray(builtFrom?.mapping_ids)
          ? builtFrom.mapping_ids.filter((s): s is string => typeof s === 'string')
          : [],
        built_at: typeof builtFrom?.built_at === 'string' ? builtFrom.built_at : '',
      },
      modules: Array.isArray(row.content?.modules)
        ? (row.content.modules as SiteScopeModule[])
        : [],
    },
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
  };
}

export type SiteScopeFetch =
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  | { kind: 'loaded'; scope: SiteScope | null };

export async function fetchSiteScope(auditId: string): Promise<SiteScopeFetch> {
  const { data, error } = await supabase
    .from('site_scope_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { kind: 'unavailable' };
    }
    console.error('[siteScopeApi] fetchSiteScope error:', error);
    return { kind: 'failed' };
  }

  return {
    kind: 'loaded',
    scope: data ? await flattenSiteScope(data as SiteScopeRow) : null,
  };
}

export async function upsertSiteScope(
  auditId: string,
  content: SiteScopeContent,
  reason?: string,
): Promise<SiteScope | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_deliverable', {
    p_kind: 'site_scope',
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[siteScopeApi] upsertSiteScope error:', error);
    return null;
  }
  return flattenSiteScope(data as SiteScopeRow);
}

/** One pin: `expectedUpdatedAt` is the scope version the reviewer saw
 *  (STALE_CONTENT on mismatch). No basis digest — this kind has none, and
 *  passing one is a server error. */
export async function approveSiteScope(
  id: string,
  expectedUpdatedAt: string,
  reason?: string,
): Promise<DeliverableApproveResult<SiteScope>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_deliverable', {
    p_kind: 'site_scope',
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    console.error('[siteScopeApi] approveSiteScope error:', error);
    return {
      ok: false,
      error: error.message,
      errorHint: (error as { hint?: string }).hint,
    };
  }
  return { ok: true, data: await flattenSiteScope(data as SiteScopeRow) };
}
