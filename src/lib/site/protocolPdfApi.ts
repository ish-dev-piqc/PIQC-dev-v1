// =============================================================================
// Site Mode — protocol PDF access ("View PDF" in ProtocolTab).
//
// Two-step flow, mirroring SOTR's own protocol-PDF helper
// (src/lib/sotr/protocolPdfApi.ts) but implemented here rather than imported
// cross-mode, since `sotr_get_protocol_pdf_storage_path` isn't on the
// piqc-discipline ALLOWED_CROSS_MODE allowlist (only WorksheetItemsList /
// WorksheetItemRow / SourceTruthDrawer / SourceTruthListDrawer /
// sourceEvidenceApi / types/sotr are). The RPC + storage bucket
// ("protocol-pdfs") are shared backend surfaces, not SOTR TS modules, so
// calling them directly from Site Mode's own lib keeps mode isolation clean:
//   1. RPC sotr_get_protocol_pdf_storage_path validates ownership + study
//      membership server-side and returns the bucket path.
//   2. Client signs a short-lived URL (60s) via supabase.storage.
// =============================================================================

import { supabase } from '../supabase';
import type { Result } from './repos/types';

const BUCKET_NAME = 'protocol-pdfs';
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Signs a short-lived URL for the parsed protocol PDF backing `documentId`.
 * Callers should open the URL immediately (e.g. `window.open`) rather than
 * storing it — it expires in 60s.
 */
export async function fetchProtocolPdfUrl(
  protocolId: string,
  documentId: string,
): Promise<Result<string>> {
  const { data: pathData, error: rpcError } = await supabase.rpc(
    'sotr_get_protocol_pdf_storage_path',
    { p_study_id: protocolId, p_document_id: documentId },
  );

  if (rpcError) {
    if (rpcError.code === '02000') {
      return { ok: false, error: 'No PDF retained for this document.' };
    }
    if (rpcError.code === '42501') {
      return { ok: false, error: 'Access denied for this document.' };
    }
    return { ok: false, error: rpcError.message };
  }

  const storagePath = typeof pathData === 'string' ? pathData : null;
  if (!storagePath) {
    return { ok: false, error: 'No PDF retained for this document.' };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return { ok: false, error: 'Could not sign a URL for this document.' };
  }

  return { ok: true, data: signed.signedUrl };
}
