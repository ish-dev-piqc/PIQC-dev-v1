import { supabase } from '../supabase';
import { resolveApprovedByName, type DeliverableApproveResult } from './preAuditApi';
import type {
  DeliverableApprovalStatus,
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
} from '../../types/audit';

// =============================================================================
// Findings Report (PR-D4) — the 6th deliverable kind, and the first real-named
// one (the Mock* prefix is legacy-frozen per the PR-3 type ruling).
//
// SOURCE-OF-TRUTH RULE: `content` stores ONLY the connective narrative
// ({intro_text, closing_text}). The observation blocks derive live from
// Stage-6 workspace entries (buildObservationGroups) at render time — never
// copied into this row. The latch stays honest across that split via the
// basis pin: approve passes the entry-set digest the reviewer saw
// (fetchEntrySetDigest), the server CAS-verifies it against the live set
// (HINT STALE_BASIS on mismatch) and seals it into `basis_digest`; editing
// content demotes and clears the seal.
//
// Writes go through the GENERIC deliverable RPCs (audit_mode_upsert_deliverable
// / audit_mode_approve_deliverable, 20260906000100) — this kind is their first
// caller; they return the row as jsonb, shaped identically to a PostgREST row.
// Wrapper shapes (row | null upsert, DeliverableApproveResult approve) match
// what useDeliverablePersistence's revert contract expects.
// =============================================================================

export interface FindingsReportContent {
  intro_text: string;
  closing_text: string;
}

export interface FindingsReport {
  id: string;
  audit_id: string;
  content: FindingsReportContent;
  approval_status: DeliverableApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  updated_at: string;
  /** Entry-set digest sealed by approve; null while DRAFT. Compare against a
   *  freshly fetched live digest to detect post-approval divergence. */
  basis_digest: string | null;
  generation_refs: DeliverableGenerationRef[] | null;
  grounding_snapshot: DeliverableGroundingSnapshot | null;
  generated_at: string | null;
}

interface FindingsReportRow {
  id: string;
  audit_id: string;
  content: Partial<FindingsReportContent> | null;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
  basis_digest: string | null;
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

async function flattenFindingsReport(row: FindingsReportRow): Promise<FindingsReport> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    // The upsert RPC does not validate the jsonb shape — tolerate a malformed
    // content object the same way checklistLiveIds tolerates one.
    content: {
      intro_text: row.content?.intro_text ?? '',
      closing_text: row.content?.closing_text ?? '',
    },
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
    basis_digest: row.basis_digest,
    generation_refs: row.generation_refs ?? null,
    grounding_snapshot: row.grounding_snapshot ?? null,
    generated_at: row.generated_at ?? null,
  };
}

/** Absence ≠ failure (the load-path honesty shape): `failed: true` means the
 *  read errored and the row state is UNKNOWN — callers must render a retry
 *  banner, never a scratch form. `report: null, failed: false` means the
 *  deliverable genuinely doesn't exist yet. */
export interface FindingsReportFetch {
  report: FindingsReport | null;
  failed: boolean;
}

export async function fetchFindingsReport(auditId: string): Promise<FindingsReportFetch> {
  const { data, error } = await supabase
    .from('findings_report_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();
  if (error) {
    console.error('[findingsReport] fetchFindingsReport error:', error);
    return { report: null, failed: true };
  }
  return {
    report: data ? await flattenFindingsReport(data as FindingsReportRow) : null,
    failed: false,
  };
}

/** The live entry-set digest — the identity the approve pin CAS-verifies.
 *  null = could not be fetched (approve must stay blocked: an approval that
 *  cannot name which entry set it covered is the dishonest latch this kind
 *  exists to prevent). */
export async function fetchEntrySetDigest(auditId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('audit_mode_entry_set_digest', {
    p_audit_id: auditId,
  });
  if (error) {
    console.error('[findingsReport] fetchEntrySetDigest error:', error);
    return null;
  }
  return typeof data === 'string' ? data : null;
}

export async function upsertFindingsReport(
  auditId: string,
  content: FindingsReportContent,
  reason?: string,
): Promise<FindingsReport | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_deliverable', {
    p_kind: 'findings_report',
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[findingsReport] upsertFindingsReport error:', error);
    return null;
  }
  return flattenFindingsReport(data as FindingsReportRow);
}

/** Dual CAS: `expectedUpdatedAt` pins the narrative version the reviewer saw
 *  (STALE_CONTENT on mismatch), `expectedBasisDigest` pins WHICH entry set
 *  they saw (STALE_BASIS). Both hints surface through errorHint. */
export async function approveFindingsReport(
  id: string,
  expectedUpdatedAt: string,
  expectedBasisDigest: string,
  reason?: string,
): Promise<DeliverableApproveResult<FindingsReport>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_deliverable', {
    p_kind: 'findings_report',
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_basis_digest: expectedBasisDigest,
  });
  if (error) {
    console.error('[findingsReport] approveFindingsReport error:', error);
    return {
      ok: false,
      error: error.message,
      errorHint: (error as { hint?: string }).hint,
    };
  }
  return { ok: true, data: await flattenFindingsReport(data as FindingsReportRow) };
}
