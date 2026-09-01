import { supabase } from '../supabase';
import { resolveApprovedByName, type DeliverableApproveResult } from './preAuditApi';
import type {
  DeliverableApprovalStatus,
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
} from '../../types/audit';

// =============================================================================
// Audit Certificate (PR-D6) — the 7th deliverable kind, the terminal one.
//
// SOURCE-OF-TRUTH RULE: `content` stores ONLY the descriptive narrative
// ({body_text, scope}). The audit facts header (vendor, dates, protocol) and
// the code-owned template lines ([Outcome: to be determined by QA], the blank
// certificate date) derive from the audit record at render time — never
// copied in, never model-written.
//
// The latch stays honest via the basis pin: approve passes the approved
// Stage-7 report's readiness_fingerprint (fetchReportBasis), the server
// CAS-verifies it against the live report (HINT STALE_BASIS on mismatch, and
// an unapproved report digests to NULL, which mismatches every pin) and
// seals it into `basis_digest`; editing content demotes and clears the seal.
//
// Writes go through the GENERIC deliverable RPCs (audit_mode_upsert_deliverable
// / audit_mode_approve_deliverable — 20260907000100 adds the 'REPORT_VERSION'
// basis token this kind declares). Wrapper shapes match findingsReport.ts,
// the pair's first caller.
// =============================================================================

export interface AuditCertificateContent {
  body_text: string;
  scope: string[];
}

export interface AuditCertificate {
  id: string;
  audit_id: string;
  content: AuditCertificateContent;
  approval_status: DeliverableApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  updated_at: string;
  /** The approved report's readiness_fingerprint sealed by approve; null
   *  while DRAFT. Compare against a freshly fetched report basis to detect a
   *  report that moved after this certificate was approved. */
  basis_digest: string | null;
  generation_refs: DeliverableGenerationRef[] | null;
  grounding_snapshot: DeliverableGroundingSnapshot | null;
  generated_at: string | null;
}

interface AuditCertificateRow {
  id: string;
  audit_id: string;
  content: Partial<AuditCertificateContent> | null;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
  basis_digest: string | null;
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

async function flattenAuditCertificate(row: AuditCertificateRow): Promise<AuditCertificate> {
  return {
    id: row.id,
    audit_id: row.audit_id,
    // The upsert RPC does not validate the jsonb shape — tolerate a malformed
    // content object the same way checklistLiveIds tolerates one.
    content: {
      body_text: row.content?.body_text ?? '',
      scope: Array.isArray(row.content?.scope)
        ? row.content.scope.filter((s): s is string => typeof s === 'string')
        : [],
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
 *  banner, never a scratch form. `certificate: null, failed: false` means the
 *  deliverable genuinely doesn't exist yet. */
export interface AuditCertificateFetch {
  certificate: AuditCertificate | null;
  failed: boolean;
}

export async function fetchAuditCertificate(auditId: string): Promise<AuditCertificateFetch> {
  const { data, error } = await supabase
    .from('audit_certificate_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();
  if (error) {
    console.error('[auditCertificate] fetchAuditCertificate error:', error);
    return { certificate: null, failed: true };
  }
  return {
    certificate: data ? await flattenAuditCertificate(data as AuditCertificateRow) : null,
    failed: false,
  };
}

/** The certificate's approval basis, read from ONE report_draft_objects row so
 *  the displayed report state and the pinned digest cannot disagree. `digest`
 *  mirrors the server's REPORT_VERSION arm: the readiness_fingerprint while
 *  the report is APPROVED, else null — null means the certificate cannot be
 *  approved (an approval that cannot name which report it certifies is the
 *  dishonest latch this kind exists to prevent). A missing row reports
 *  approved: false. Returns null when the read errored (basis UNKNOWN —
 *  approve must stay blocked and the caller renders a retry banner). */
export interface ReportBasis {
  approved: boolean;
  approvedAt: string | null;
  digest: string | null;
}

export async function fetchReportBasis(auditId: string): Promise<ReportBasis | null> {
  const { data, error } = await supabase
    .from('report_draft_objects')
    .select('approval_status, approved_at, readiness_fingerprint')
    .eq('audit_id', auditId)
    .maybeSingle();
  if (error) {
    console.error('[auditCertificate] fetchReportBasis error:', error);
    return null;
  }
  const approved = data?.approval_status === 'APPROVED';
  return {
    approved,
    approvedAt: data?.approved_at ?? null,
    // A legacy report approved before the fingerprint column existed reads
    // approved with a null digest — approve stays blocked until the report is
    // re-approved (which seals a fingerprint).
    digest: approved && typeof data?.readiness_fingerprint === 'string'
      ? data.readiness_fingerprint
      : null,
  };
}

export async function upsertAuditCertificate(
  auditId: string,
  content: AuditCertificateContent,
  reason?: string,
): Promise<AuditCertificate | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_deliverable', {
    p_kind: 'audit_certificate',
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[auditCertificate] upsertAuditCertificate error:', error);
    return null;
  }
  return flattenAuditCertificate(data as AuditCertificateRow);
}

/** Dual CAS: `expectedUpdatedAt` pins the certificate text the reviewer saw
 *  (STALE_CONTENT on mismatch), `expectedBasisDigest` pins WHICH approved
 *  report version they saw (STALE_BASIS — also raised when the report is no
 *  longer approved). Both hints surface through errorHint. */
export async function approveAuditCertificate(
  id: string,
  expectedUpdatedAt: string,
  expectedBasisDigest: string,
  reason?: string,
): Promise<DeliverableApproveResult<AuditCertificate>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_deliverable', {
    p_kind: 'audit_certificate',
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
    p_expected_basis_digest: expectedBasisDigest,
  });
  if (error) {
    console.error('[auditCertificate] approveAuditCertificate error:', error);
    return {
      ok: false,
      error: error.message,
      errorHint: (error as { hint?: string }).hint,
    };
  }
  return { ok: true, data: await flattenAuditCertificate(data as AuditCertificateRow) };
}
