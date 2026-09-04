import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { DocumentStatus, ProtocolDocumentStatus } from '../../types/audit';

// =============================================================================
// Protocol readiness (Stage 1, both workflows) — is the audit's protocol parsed?
//
// Three functions, none of which writes protocol content:
//
//   fetchProtocolDocumentStatus — audit_mode_protocol_document_status RPC
//     (20260913000000). PGRST202 (function not applied on this project yet)
//     is a first-class outcome, { available: false }: not an error, and never
//     "no protocol". The card renders a neutral line for it.
//
//   checkIngestStatus — POST /functions/v1/ingest-status. NOT a pure read:
//     when Reducto is done this call runs the completion pipeline (60–120 s
//     for a long protocol) while still answering "pending" to the caller, and
//     only the document's owner may call it. Poll with an in-flight guard.
//
//   deriveProtocolReadiness — pure precedence over the RPC payload; the one
//     place the card's state is decided (table-tested).
// =============================================================================

export type ProtocolReadiness =
  | { available: false }
  | ({ available: true } & ProtocolDocumentStatus);

export async function fetchProtocolDocumentStatus(
  auditId: string,
): Promise<Result<ProtocolReadiness>> {
  const { data, error } = await supabase.rpc('audit_mode_protocol_document_status', {
    p_audit_id: auditId,
  });
  if (error) {
    if (error.code === 'PGRST202') return { ok: true, data: { available: false } };
    return { ok: false, error: error.message };
  }
  return { ok: true, data: { available: true, ...(data as ProtocolDocumentStatus) } };
}

export interface IngestStatusResult {
  status: DocumentStatus;
  error_message: string | null;
}

function isDocumentStatus(value: unknown): value is DocumentStatus {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

export async function checkIngestStatus(
  documentId: string,
): Promise<Result<IngestStatusResult>> {
  const { data: { session } } = await supabase.auth.getSession();
  // Never poll on the anon key: ingest-status is owner-gated and would 401.
  if (!session?.access_token) {
    return { ok: false, error: 'Not signed in — refresh and try again' };
  }
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ingest-status`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ document_id: documentId }),
    });
    const body = (await res.json().catch(() => null)) as
      | { status?: unknown; error_message?: string | null; error?: string }
      | null;
    if (!res.ok || !body || !isDocumentStatus(body.status)) {
      return { ok: false, error: body?.error ?? `Parse status unavailable (HTTP ${res.status})` };
    }
    return { ok: true, data: { status: body.status, error_message: body.error_message ?? null } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' };
  }
}

export type ReadinessState =
  | { kind: 'parsing'; documentId: string }
  | { kind: 'ready'; itemCount: number }
  | { kind: 'ready_no_items' }
  | { kind: 'parsing_elsewhere' }
  | { kind: 'failed'; error: string }
  | { kind: 'none' };

/**
 * Precedence, top wins:
 *   1. the caller's own upload is in flight → parsing (the card polls it);
 *   2. a ready document with visible worksheet items → ready(N) — never masked
 *      by a stale failed row or by someone else's pending copy;
 *   3. a ready document with no items → ready_no_items (its own remedy applies:
 *      a different, text-based PDF);
 *   4. another account's copy is parsing → parsing_elsewhere;
 *   5. the caller's latest upload failed and nothing ready exists → failed;
 *   6. nothing → none.
 * A failure the card observes LIVE while polling is the card's business
 * (kept on screen until the next upload); this function only reads the RPC.
 */
export function deriveProtocolReadiness(status: ProtocolDocumentStatus): ReadinessState {
  if (status.own_pending_document_id) {
    return { kind: 'parsing', documentId: status.own_pending_document_id };
  }
  if (status.any_ready > 0 && status.visible_item_count > 0) {
    return { kind: 'ready', itemCount: status.visible_item_count };
  }
  if (status.any_ready > 0) return { kind: 'ready_no_items' };
  if (status.any_pending > 0) return { kind: 'parsing_elsewhere' };
  if (status.own_failed_error !== null) return { kind: 'failed', error: status.own_failed_error };
  return { kind: 'none' };
}
