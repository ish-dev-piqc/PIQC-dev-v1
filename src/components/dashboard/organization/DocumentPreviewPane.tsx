import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  signChatAttachmentUrl,
  signProtocolDocumentUrl,
  type ReductoDocument,
} from '../../../lib/orgs/orgsApi';
import { formatBytes, type DocFamily } from '../../../lib/orgs/protocolDocumentsAdapter';
import type { ChatAttachment, ProtocolDocument } from '../../../types/orgs';

// =============================================================================
// DocumentPreviewPane — right-side slide-in preview for a single doc.
//
// PDFs and images render inline via signed URL. Everything else shows a
// metadata block + "Open in new tab" using the signed URL. Reducto docs
// are out of scope (they have their own viewer in SOTR) — the parent
// shouldn't open this pane for source: 'reducto'.
//
// Esc / backdrop click / X close. Signed URL is fetched lazily on open
// and discarded on close so URLs don't outlive their TTL.
// =============================================================================

interface PreviewRow {
  source: 'upload' | 'chat' | 'reducto';
  name: string;
  size_bytes: number | null;
  created_at: string;
  family: DocFamily;
  storage_path: string | null;
  protocol_document?: ProtocolDocument;
  chat_attachment?: ChatAttachment;
  reducto?: ReductoDocument;
}

interface DocumentPreviewPaneProps {
  row: PreviewRow | null;
  onClose: () => void;
}

export default function DocumentPreviewPane({ row, onClose }: DocumentPreviewPaneProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch a signed URL when the row changes. Reset state on every change so
  // a stale URL from the previous row never bleeds through.
  useEffect(() => {
    setSignedUrl(null);
    setError(null);
    if (!row) return;

    let cancelled = false;
    const fetchUrl = async () => {
      setLoading(true);
      try {
        if (row.source === 'reducto') {
          // Reducto rows shouldn't reach this pane; bail safely if they do.
          setError('Open this document from the SOTR.');
          return;
        }
        if (!row.storage_path) {
          setError('Missing storage path.');
          return;
        }
        const res =
          row.source === 'upload'
            ? await signProtocolDocumentUrl(row.storage_path)
            : await signChatAttachmentUrl(row.storage_path);
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setSignedUrl(res.data);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchUrl();
    return () => {
      cancelled = true;
    };
  }, [row]);

  // Esc-to-close
  useEffect(() => {
    if (!row) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [row, onClose]);

  if (!row) return null;

  const isPdf = row.family === 'pdf';
  const isImage = row.family === 'image';
  const canEmbed = isPdf || isImage;

  const paneBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const paneBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';

  return (
    <>
      {/* Backdrop — same z-stack as Cowork drawers; click closes. */}
      <div
        className="fixed inset-0 z-40 bg-[#0F172A]/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Document preview"
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[480px] ${paneBg} border-l ${paneBorder} shadow-xl flex flex-col`}
      >
        {/* Header */}
        <div className={`flex items-start gap-2 px-4 py-3 border-b ${paneBorder}`}>
          <div className="flex-1 min-w-0">
            <p className="text-fg-heading text-sm font-semibold truncate">{row.name}</p>
            <p className={`${subColor} text-[11px] mt-0.5`}>
              {new Date(row.created_at).toLocaleString()}
              {row.size_bytes !== null && ` · ${formatBytes(row.size_bytes)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${
              isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/65 hover:bg-white/[0.05]'
            }`}
            aria-label="Close preview"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading && (
            <div className="h-full flex items-center justify-center">
              <Loader2 size={20} className={`${labelColor} animate-spin`} />
            </div>
          )}
          {error && !loading && (
            <div className="p-4">
              <p className={`text-xs ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
                {error}
              </p>
            </div>
          )}
          {!loading && !error && signedUrl && canEmbed && isPdf && (
            <iframe
              src={`${signedUrl}#toolbar=0`}
              className="w-full h-full"
              title={row.name}
            />
          )}
          {!loading && !error && signedUrl && canEmbed && isImage && (
            <div className="p-4 flex items-center justify-center">
              <img
                src={signedUrl}
                alt={row.name}
                className="max-w-full max-h-[80vh] object-contain rounded"
              />
            </div>
          )}
          {!loading && !error && signedUrl && !canEmbed && (
            <div className="p-4 space-y-3">
              <p className={`${subColor} text-xs`}>
                No inline preview for this file type. Open it in a new tab to
                view or download.
              </p>
              <a
                href={signedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md ${
                  isLight
                    ? 'bg-[#534AB7] text-white hover:bg-[#3C3489]'
                    : 'bg-[#7F77DD] text-white hover:bg-[#534AB7]'
                }`}
              >
                <ExternalLink size={13} />
                Open in new tab
              </a>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
