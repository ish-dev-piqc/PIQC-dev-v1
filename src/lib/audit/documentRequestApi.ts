import { supabase } from '../supabase';
import { resolveApprovedByName, type DeliverableApproveResult } from './preAuditApi';
import type {
  DeliverableApprovalStatus,
  DocumentRequestContent,
  DocumentRequestItem,
} from '../../types/audit';

// =============================================================================
// Document request API — document_request_objects (isa-document-request), the
// 9th kind on the generic deliverable pair.
//
// Writes go through audit_mode_upsert_deliverable / audit_mode_approve_
// deliverable with p_kind 'document_request' (20260920000100 adds the arm).
// The kind declares NO basis pin: approve carries only the updated_at CAS
// (STALE_CONTENT on mismatch) and must not pass a basis digest — the server
// refuses one for a basis-less kind (22023). Wrapper shapes (row | null
// upsert, DeliverableApproveResult approve) match siteScopeApi.ts, so
// useDeliverablePersistence's revert contract holds.
//
// The read has THREE outcomes, all first-class: the row (or its absence),
// "not applied yet" (the table is missing until the schema migration runs —
// PGRST205, older builds 42P01; siteScopeApi precedent), and "failed" (the
// row state is UNKNOWN — the workspace renders Retry, never an empty "build
// it" state over an error).
// =============================================================================

export interface DocumentRequest {
  id: string;
  audit_id: string;
  content: DocumentRequestContent;
  approval_status: DeliverableApprovalStatus;
  approved_at: string | null;
  approved_by_name: string | null;
  updated_at: string;
}

interface DocumentRequestRow {
  id: string;
  audit_id: string;
  content: {
    built_from?: { scope_id?: unknown; scope_modules?: unknown; built_at?: unknown } | null;
    items?: unknown;
    sampling_approach?: unknown;
    instructions?: unknown;
  } | null;
  approval_status: DeliverableApprovalStatus;
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function flattenDocumentRequest(row: DocumentRequestRow): Promise<DocumentRequest> {
  // The upsert RPC does not validate the jsonb shape — tolerate a malformed
  // top level the way siteScopeApi does. Lines are trusted beyond their key
  // and title: buildDocumentRequestContent and the workspace are the only
  // writers.
  const builtFrom = row.content?.built_from;
  const scopeModules = Array.isArray(builtFrom?.scope_modules)
    ? builtFrom.scope_modules.filter(
        (m): m is DocumentRequestContent['built_from']['scope_modules'][number] =>
          isRecord(m) && typeof m.isa_domain === 'string' && typeof m.criticality === 'string',
      )
    : [];
  const items = Array.isArray(row.content?.items)
    ? (row.content.items.filter(
        (item) => isRecord(item) && typeof item.key === 'string' && typeof item.title === 'string',
      ) as DocumentRequestItem[])
    : [];
  return {
    id: row.id,
    audit_id: row.audit_id,
    content: {
      built_from: {
        scope_id: typeof builtFrom?.scope_id === 'string' ? builtFrom.scope_id : '',
        scope_modules: scopeModules,
        built_at: typeof builtFrom?.built_at === 'string' ? builtFrom.built_at : '',
      },
      items,
      sampling_approach:
        typeof row.content?.sampling_approach === 'string' ? row.content.sampling_approach : '',
      instructions: typeof row.content?.instructions === 'string' ? row.content.instructions : '',
    },
    approval_status: row.approval_status,
    approved_at: row.approved_at,
    approved_by_name: await resolveApprovedByName(row.approved_by),
    updated_at: row.updated_at,
  };
}

export type DocumentRequestFetch =
  | { kind: 'unavailable' }
  | { kind: 'failed' }
  | { kind: 'loaded'; request: DocumentRequest | null };

export async function fetchDocumentRequest(auditId: string): Promise<DocumentRequestFetch> {
  const { data, error } = await supabase
    .from('document_request_objects')
    .select('*')
    .eq('audit_id', auditId)
    .maybeSingle();

  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') {
      return { kind: 'unavailable' };
    }
    console.error('[documentRequestApi] fetchDocumentRequest error:', error);
    return { kind: 'failed' };
  }

  return {
    kind: 'loaded',
    request: data ? await flattenDocumentRequest(data as DocumentRequestRow) : null,
  };
}

export async function upsertDocumentRequest(
  auditId: string,
  content: DocumentRequestContent,
  reason?: string,
): Promise<DocumentRequest | null> {
  const { data, error } = await supabase.rpc('audit_mode_upsert_deliverable', {
    p_kind: 'document_request',
    p_audit_id: auditId,
    p_content: content,
    p_reason: reason ?? null,
  });
  if (error) {
    console.error('[documentRequestApi] upsertDocumentRequest error:', error);
    return null;
  }
  return flattenDocumentRequest(data as DocumentRequestRow);
}

/** One pin: `expectedUpdatedAt` is the request version the reviewer saw
 *  (STALE_CONTENT on mismatch). No basis digest — this kind has none, and
 *  passing one is a server error. */
export async function approveDocumentRequest(
  id: string,
  expectedUpdatedAt: string,
  reason?: string,
): Promise<DeliverableApproveResult<DocumentRequest>> {
  const { data, error } = await supabase.rpc('audit_mode_approve_deliverable', {
    p_kind: 'document_request',
    p_id: id,
    p_reason: reason ?? null,
    p_expected_updated_at: expectedUpdatedAt,
  });
  if (error) {
    console.error('[documentRequestApi] approveDocumentRequest error:', error);
    return {
      ok: false,
      error: error.message,
      errorHint: (error as { hint?: string }).hint,
    };
  }
  return { ok: true, data: await flattenDocumentRequest(data as DocumentRequestRow) };
}
