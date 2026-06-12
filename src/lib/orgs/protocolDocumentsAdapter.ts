import type { ProtocolDocument } from '../../types/orgs';

// =============================================================================
// protocolDocumentsAdapter — pure mapper + small render helpers for the
// Documents tab. No Supabase / network imports.
// =============================================================================

export interface ProtocolDocumentRow {
  id: string;
  protocol_id: string | null;
  org_id: string | null;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  original_filename: string;
  uploaded_by_user_id: string | null;
  created_at: string;
}

export function adaptProtocolDocument(
  row: ProtocolDocumentRow,
): ProtocolDocument {
  return {
    id: row.id,
    protocol_id: row.protocol_id,
    org_id: row.org_id,
    storage_path: row.storage_path,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    original_filename: row.original_filename,
    uploaded_by_user_id: row.uploaded_by_user_id,
    created_at: row.created_at,
  };
}

export function adaptProtocolDocuments(
  rows: ProtocolDocumentRow[],
): ProtocolDocument[] {
  return rows.map(adaptProtocolDocument);
}

// ---------------------------------------------------------------------------
// Render helpers
// ---------------------------------------------------------------------------

/** Format a byte count to a short human label. Uses base-1024 because that's
 *  what file pickers + OS file managers show. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Family bucket from a mime type / filename. Drives the file-icon picker. */
export type DocFamily = 'pdf' | 'xlsx' | 'docx' | 'image' | 'other';

export function fileFamily(mime: string, filename: string): DocFamily {
  const m = mime.toLowerCase();
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (m === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    m.startsWith('application/vnd.openxmlformats-officedocument.spreadsheet') ||
    m === 'application/vnd.ms-excel' ||
    ext === 'xlsx' ||
    ext === 'xls' ||
    ext === 'csv'
  ) {
    return 'xlsx';
  }
  if (
    m.startsWith('application/vnd.openxmlformats-officedocument.wordprocessing') ||
    m === 'application/msword' ||
    ext === 'docx' ||
    ext === 'doc'
  ) {
    return 'docx';
  }
  if (m.startsWith('image/')) return 'image';
  return 'other';
}
