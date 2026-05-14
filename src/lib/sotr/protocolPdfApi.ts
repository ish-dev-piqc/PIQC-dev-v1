// =============================================================================
// Source of Truth Reviewer — protocol PDF access (PR-4 foundation).
//
// Two-step flow:
//   1. RPC sotr_get_protocol_pdf_storage_path validates ownership + study
//      membership server-side and returns the bucket path.
//   2. Client signs a short-lived URL (60s) via supabase.storage.
//
// The signed URL is never returned by the RPC and never logged. Errors are
// surfaced as typed exceptions so the UI can render specific messages
// (no PDF retained vs. access denied vs. unexpected).
// =============================================================================

import { supabase } from '../supabase';

/** Signed URL plus its absolute expiry timestamp (ms since epoch). */
export interface SignedProtocolPdfUrl {
  url: string;
  expiresAt: number;
}

/** TTL for the signed URL. Short on purpose — the UI re-signs on each open. */
export const PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS = 60;

const BUCKET_NAME = 'protocol-pdfs';

/** Thrown when the document exists + is owned, but no PDF was retained. */
export class ProtocolPdfNotRetainedError extends Error {
  constructor(public readonly documentId: string) {
    super('No PDF retained for this document');
    this.name = 'ProtocolPdfNotRetainedError';
  }
}

/** Thrown when the document is not found / not owned / not in this study. */
export class ProtocolPdfAccessDeniedError extends Error {
  constructor() {
    super('Document not found in study or access denied');
    this.name = 'ProtocolPdfAccessDeniedError';
  }
}

/** Thrown for unexpected signing failures. UI shows generic friendly copy. */
export class ProtocolPdfSigningError extends Error {
  constructor() {
    super('Could not sign a URL for this document');
    this.name = 'ProtocolPdfSigningError';
  }
}

/**
 * Fetches a short-lived signed URL for the protocol PDF backing a worksheet
 * item's source evidence. Throws specific typed errors so the UI can choose
 * its message.
 */
export async function fetchProtocolPdfUrl(
  studyId: string,
  documentId: string,
): Promise<SignedProtocolPdfUrl> {
  // ---- Step 1: validate ownership + study membership; get path ----
  const { data: pathData, error: rpcError } = await supabase.rpc(
    'sotr_get_protocol_pdf_storage_path',
    { p_study_id: studyId, p_document_id: documentId },
  );

  if (rpcError) {
    // 02000 → no PDF retained; 42501 → not authenticated / access denied.
    if (rpcError.code === '02000') {
      throw new ProtocolPdfNotRetainedError(documentId);
    }
    if (rpcError.code === '42501') {
      throw new ProtocolPdfAccessDeniedError();
    }
    // Unknown error — log only the code/name, never the message body.
    console.warn('[sotr] protocol PDF RPC failed', {
      studyId,
      documentId,
      errorCode: rpcError.code ?? 'unknown',
    });
    throw new ProtocolPdfSigningError();
  }

  const storagePath = typeof pathData === 'string' ? pathData : null;
  if (!storagePath) {
    throw new ProtocolPdfNotRetainedError(documentId);
  }

  // ---- Step 2: sign the URL via supabase storage ----
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    console.warn('[sotr] protocol PDF signing failed', {
      studyId,
      documentId,
      // Never log the path or URL — only that signing was attempted.
      hasError: Boolean(signError),
    });
    throw new ProtocolPdfSigningError();
  }

  // Safe log: counts/IDs only — never the URL or path.
  console.info('[sotr] protocol PDF URL signed', {
    studyId,
    documentId,
    expiresInSeconds: PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS,
  });

  return {
    url: signed.signedUrl,
    expiresAt: Date.now() + PROTOCOL_PDF_SIGNED_URL_TTL_SECONDS * 1000,
  };
}
