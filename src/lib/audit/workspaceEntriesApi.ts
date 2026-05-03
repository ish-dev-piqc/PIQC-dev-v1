import { supabase } from '../supabase';
import type { MockWorkspaceEntry } from './mockWorkspaceEntries';
import type {
  EndpointTier,
  ImpactSurface,
  ProvisionalClassification,
  ProvisionalImpact,
} from '../../types/audit';

// =============================================================================
// Audit Conduct (Stage 6) API — workspace entry CRUD against
// audit_workspace_entry_objects.
//
// All mutations route through Postgres RPCs in
// supabase/migrations/20260430180000_audit_mode_workspace_entry_rpcs.sql.
// Each RPC mutates + writes a state_history_delta atomically. RLS scopes
// reads/writes to audits where the signed-in user is lead_auditor_id.
//
// Risk-attr inheritance:
//   When protocol_risk_id is supplied at create time, the linked risk's
//   endpoint_tier / impact_surface / time_sensitivity are snapshotted onto
//   the entry (risk_attrs_inherited = TRUE). These are stable — they never
//   reflect later edits to the upstream risk object. The amendment-ingest
//   path (Phase 2) is what flips risk_context_outdated; auditors call
//   confirmRiskContext() to clear it after re-reviewing.
// =============================================================================

interface WorkspaceEntryRow {
  id: string;
  audit_id: string;
  protocol_risk_id: string | null;
  vendor_service_mapping_id: string | null;
  questionnaire_response_id: string | null;
  checkpoint_ref: string | null;
  vendor_domain: string;
  observation_text: string;
  provisional_impact: ProvisionalImpact;
  provisional_classification: ProvisionalClassification;
  risk_attrs_inherited: boolean;
  inherited_endpoint_tier: EndpointTier | null;
  inherited_impact_surface: ImpactSurface | null;
  inherited_time_sensitivity: boolean | null;
  risk_context_outdated: boolean;
  risk_context_confirmed_at: string | null;
  risk_context_confirmed_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

async function resolveCreatorName(createdBy: string): Promise<string> {
  const { data } = await supabase
    .from('user_profiles')
    .select('name')
    .eq('id', createdBy)
    .maybeSingle();
  return (data as { name?: string } | null)?.name ?? '(unknown)';
}

async function flattenEntry(row: WorkspaceEntryRow): Promise<MockWorkspaceEntry> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    protocol_risk_id: row.protocol_risk_id,
    vendor_service_mapping_id: row.vendor_service_mapping_id,
    questionnaire_response_id: row.questionnaire_response_id,
    checkpoint_ref: row.checkpoint_ref,
    vendor_domain: row.vendor_domain,
    observation_text: row.observation_text,
    provisional_impact: row.provisional_impact,
    provisional_classification: row.provisional_classification,
    inherited_endpoint_tier: row.inherited_endpoint_tier,
    inherited_impact_surface: row.inherited_impact_surface,
    inherited_time_sensitivity: row.inherited_time_sensitivity,
    risk_context_outdated: row.risk_context_outdated,
    created_by_name: await resolveCreatorName(row.created_by),
    created_at: row.created_at,
  };
}

// ============================================================================
// Reads
// ============================================================================

export async function fetchWorkspaceEntries(auditId: string): Promise<MockWorkspaceEntry[]> {
  const { data, error } = await supabase
    .from('audit_workspace_entry_objects')
    .select('*')
    .eq('audit_id', auditId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[workspaceEntriesApi] fetchWorkspaceEntries error:', error);
    return [];
  }

  return Promise.all(((data ?? []) as WorkspaceEntryRow[]).map(flattenEntry));
}

// ============================================================================
// Mutations (RPCs — atomic with delta tracking)
// ============================================================================

export interface CreateWorkspaceEntryInput {
  vendorDomain: string;
  observationText: string;
  provisionalImpact?: ProvisionalImpact;
  provisionalClassification?: ProvisionalClassification;
  checkpointRef?: string | null;
  protocolRiskId?: string | null;
  vendorServiceMappingId?: string | null;
  questionnaireResponseId?: string | null;
  reason?: string;
}

export async function createWorkspaceEntry(
  auditId: string,
  input: CreateWorkspaceEntryInput,
): Promise<MockWorkspaceEntry | null> {
  const { data, error } = await supabase.rpc('audit_mode_create_workspace_entry', {
    p_audit_id: auditId,
    p_vendor_domain: input.vendorDomain,
    p_observation_text: input.observationText,
    p_provisional_impact: input.provisionalImpact ?? 'NONE',
    p_provisional_classification: input.provisionalClassification ?? 'NOT_YET_CLASSIFIED',
    p_checkpoint_ref: input.checkpointRef ?? null,
    p_protocol_risk_id: input.protocolRiskId ?? null,
    p_vendor_service_mapping_id: input.vendorServiceMappingId ?? null,
    p_questionnaire_response_id: input.questionnaireResponseId ?? null,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[workspaceEntriesApi] createWorkspaceEntry error:', error);
    return null;
  }

  return flattenEntry(data as WorkspaceEntryRow);
}

export interface UpdateWorkspaceEntryInput {
  vendorDomain?: string;
  observationText?: string;
  provisionalImpact?: ProvisionalImpact;
  provisionalClassification?: ProvisionalClassification;
  checkpointRef?: string | null; // pass null + clearCheckpointRef:true to clear; pass undefined to leave alone
  clearCheckpointRef?: boolean;
  reason?: string;
}

export async function updateWorkspaceEntry(
  entryId: string,
  input: UpdateWorkspaceEntryInput,
): Promise<MockWorkspaceEntry | null> {
  const { data, error } = await supabase.rpc('audit_mode_update_workspace_entry', {
    p_id: entryId,
    p_vendor_domain: input.vendorDomain ?? null,
    p_observation_text: input.observationText ?? null,
    p_provisional_impact: input.provisionalImpact ?? null,
    p_provisional_classification: input.provisionalClassification ?? null,
    p_checkpoint_ref: input.checkpointRef ?? null,
    p_clear_checkpoint_ref: input.clearCheckpointRef ?? false,
    p_reason: input.reason ?? null,
  });

  if (error) {
    console.error('[workspaceEntriesApi] updateWorkspaceEntry error:', error);
    return null;
  }

  return flattenEntry(data as WorkspaceEntryRow);
}

// Delete is intentionally NOT supported. Audit observations are corrected
// (via update) or annotated, not deleted. This matches the rv1_code reference
// and the GxP-trail invariant that history is append-only.

export async function confirmWorkspaceEntryRiskContext(
  entryId: string,
  reason?: string,
): Promise<MockWorkspaceEntry | null> {
  const { data, error } = await supabase.rpc(
    'audit_mode_confirm_workspace_entry_risk_context',
    {
      p_id: entryId,
      p_reason: reason ?? null,
    },
  );

  if (error) {
    console.error('[workspaceEntriesApi] confirmRiskContext error:', error);
    return null;
  }

  return flattenEntry(data as WorkspaceEntryRow);
}
