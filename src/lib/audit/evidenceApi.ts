import { supabase } from '../supabase';
import type { Result } from './auditCreationApi';
import type { AuditEvidenceListRow, AuditSourceDocument } from '../../types/audit';

// =============================================================================
// Audit Mode evidence register API (PR-B, text/paste slice).
//
// Evidence arrives as emailed Word/Excel files at any audit stage; v1 intake is
// paste-the-text. Ingest goes through the shared /functions/v1/ingest edge
// function with kind='AUDIT_EVIDENCE' (documents+chunks pipeline, protocol_id
// stays NULL so evidence never enters protocol-scoped search), then
// audit_mode_attach_evidence files the document under the audit with
// provenance. Both attach and remove write 'AUDIT' deltas server-side.
//
// Migration: supabase/migrations/20260830000000_audit_evidence_register.sql
// =============================================================================

// -----------------------------------------------------------------------------
// Checkbox normalization
//
// Completed questionnaires are checkbox-dense, and pasting from Word/Excel
// yields Unicode ballot glyphs that embed poorly and read inconsistently in
// retrieved chunks. Normalize to bracket form BEFORE ingest so the stored
// text, the hash that vouches for it, and the embeddings all agree.
// -----------------------------------------------------------------------------
export function normalizeCheckboxes(text: string): string {
  return text
    .replace(/☐/g, '[ ]')  // ☐ ballot box
    .replace(/[☑☒]/g, '[x]'); // ☑ checked / ☒ crossed
}

// -----------------------------------------------------------------------------
// List
// -----------------------------------------------------------------------------
export async function listAuditEvidence(
  auditId: string,
): Promise<Result<AuditEvidenceListRow[]>> {
  const { data, error } = await supabase
    .from('audit_source_documents')
    .select(
      'audit_id, document_id, added_by, added_at, source_type, source_system, source_locator, include_in_generation, documents(title, status)',
    )
    .eq('audit_id', auditId)
    .order('added_at', { ascending: false });

  if (error) {
    console.error('[evidenceApi] listAuditEvidence error:', error);
    return { ok: false, error: error.message };
  }

  type JoinedDoc = { title: string; status: AuditEvidenceListRow['status'] };
  const rows = (data ?? []) as Array<
    AuditSourceDocument & { documents: JoinedDoc | JoinedDoc[] | null }
  >;

  // PostgREST may return the joined row as an array or a single object
  // depending on the version + relationship cardinality. Normalize both.
  return {
    ok: true,
    data: rows.map((row) => {
      const doc = Array.isArray(row.documents) ? row.documents[0] : row.documents;
      const { documents: _drop, ...join } = row;
      void _drop;
      return {
        ...join,
        title: doc?.title ?? '(untitled)',
        status: doc?.status ?? 'failed',
      };
    }),
  };
}

// -----------------------------------------------------------------------------
// Ingest + attach
//
// Two steps: POST the pasted text to /ingest (sync — text path chunks, embeds,
// and marks ready before returning), then file the resulting document under
// the audit via RPC. A failure between the two orphans the document (invisible
// to every register) — named trade-off, GC later.
// -----------------------------------------------------------------------------
export interface IngestAuditEvidenceParams {
  auditId: string;
  title: string;
  sourceType: string;
  sourceLocator?: string;
  content: string;
}

export async function ingestAuditEvidence(
  params: IngestAuditEvidenceParams,
): Promise<Result<AuditEvidenceListRow>> {
  const { data: { session } } = await supabase.auth.getSession();
  // Hard fail without a session — evidence must never ride the anon key.
  if (!session?.access_token) {
    return { ok: false, error: 'Not signed in — refresh and try again' };
  }

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  // fetch/json can throw outright (network drop, gateway HTML error page) —
  // catch so the Result contract holds and the caller's busy state can't
  // stick; supabase-js paths below never reject.
  let resOk: boolean;
  let ingest: { document_id?: string; error?: string };
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: params.title.trim() || 'Untitled evidence',
        source: 'Audit evidence paste',
        content: normalizeCheckboxes(params.content),
        kind: 'AUDIT_EVIDENCE',
      }),
    });
    resOk = res.ok;
    ingest = (await res.json()) as { document_id?: string; error?: string };
  } catch (e) {
    console.error('[evidenceApi] ingestAuditEvidence fetch threw:', e);
    return { ok: false, error: 'Evidence ingest failed — check your connection and try again' };
  }
  if (!resOk || !ingest.document_id) {
    console.error('[evidenceApi] ingestAuditEvidence ingest error:', ingest.error);
    return { ok: false, error: ingest.error ?? 'Evidence ingest failed' };
  }

  const { data, error } = await supabase.rpc('audit_mode_attach_evidence', {
    p_audit_id: params.auditId,
    p_document_id: ingest.document_id,
    p_source_type: params.sourceType,
    p_source_locator: params.sourceLocator ?? null,
  });

  if (error) {
    console.error('[evidenceApi] ingestAuditEvidence attach error:', error);
    // The supabase-js shape exposes hint on PostgrestError when present.
    const hint = (error as unknown as { hint?: string }).hint;
    return { ok: false, error: hint ?? error.message };
  }

  const join = data as AuditSourceDocument;
  return {
    ok: true,
    data: { ...join, title: params.title.trim() || 'Untitled evidence', status: 'ready' },
  };
}

// -----------------------------------------------------------------------------
// Remove
//
// Server-side the RPC deletes the join row + the evidence document (unless
// another audit still references it) and writes the removal delta.
// -----------------------------------------------------------------------------
export async function removeAuditEvidence(
  auditId: string,
  documentId: string,
): Promise<Result<null>> {
  const { error } = await supabase.rpc('audit_mode_remove_evidence', {
    p_audit_id: auditId,
    p_document_id: documentId,
  });

  if (error) {
    console.error('[evidenceApi] removeAuditEvidence error:', error);
    const hint = (error as unknown as { hint?: string }).hint;
    return { ok: false, error: hint ?? error.message };
  }

  return { ok: true, data: null };
}
