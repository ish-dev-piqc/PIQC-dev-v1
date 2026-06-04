import { useEffect, useState } from 'react';
import { Download, File as FileIcon, Loader2, Trash2, X, ImageIcon } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import {
  deleteChatAttachment,
  getAttachmentSignedUrl,
} from '../../../../lib/orgs/orgsApi';
import type { ChatAttachment } from '../../../../types/orgs';

// =============================================================================
// AttachmentRender — in-bubble display for a message's attachments.
//
// Image-mime types render inline as 240px-bounded thumbnails. Anything else
// renders as a file row (icon + name + size + download button). Click any
// attachment → fetches a 60-second signed URL and either opens in a new tab
// (images / PDFs / open-able types) or triggers a synthetic download
// (everything else).
//
// Author + admin (passed in via canDelete) get a small X on hover to delete
// the attachment.
// =============================================================================

const IMAGE_MIME_PREFIX = 'image/';

interface AttachmentRenderProps {
  attachments: ChatAttachment[];
  canDelete: (attachment: ChatAttachment) => boolean;
  onDeleted?: (id: string) => void;
}

function isImageAttachment(a: ChatAttachment): boolean {
  return a.mime_type.startsWith(IMAGE_MIME_PREFIX);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AttachmentRender({
  attachments,
  canDelete,
  onDeleted,
}: AttachmentRenderProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [lightbox, setLightbox] = useState<{ url: string; alt: string } | null>(null);

  if (attachments.length === 0) return null;

  const images = attachments.filter(isImageAttachment);
  const others = attachments.filter((a) => !isImageAttachment(a));

  return (
    <>
      {images.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {images.map((a) => (
            <ImageAttachment
              key={a.id}
              attachment={a}
              isLight={isLight}
              canDelete={canDelete(a)}
              onOpen={(url) => setLightbox({ url, alt: a.original_filename })}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="mt-2 flex flex-col gap-1.5">
          {others.map((a) => (
            <FileAttachment
              key={a.id}
              attachment={a}
              isLight={isLight}
              canDelete={canDelete(a)}
              onDeleted={onDeleted}
            />
          ))}
        </div>
      )}
      {lightbox && (
        <ImageLightbox url={lightbox.url} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </>
  );
}

function ImageAttachment({
  attachment,
  isLight,
  canDelete,
  onOpen,
  onDeleted,
}: {
  attachment: ChatAttachment;
  isLight: boolean;
  canDelete: boolean;
  onOpen: (url: string) => void;
  onDeleted?: (id: string) => void;
}) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAttachmentSignedUrl(attachment.storage_path, 60).then((res) => {
      if (cancelled) return;
      if (res.ok) setThumbUrl(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.storage_path]);

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!window.confirm(`Delete ${attachment.original_filename}?`)) return;
    setDeleting(true);
    const res = await deleteChatAttachment(attachment);
    setDeleting(false);
    if (res.ok) onDeleted?.(attachment.id);
  }

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => thumbUrl && onOpen(thumbUrl)}
        disabled={!thumbUrl}
        className={`block max-w-[240px] max-h-[240px] rounded-lg overflow-hidden border ${
          isLight ? 'border-[#E2E8F0]' : 'border-white/10'
        } ${thumbUrl ? 'hover:opacity-90' : ''}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={attachment.original_filename}
            className="max-w-[240px] max-h-[240px] object-cover"
          />
        ) : error ? (
          <div className="w-24 h-24 flex items-center justify-center text-fg-muted text-[10px] p-2 text-center">
            Image unavailable
          </div>
        ) : (
          <div className="w-24 h-24 flex items-center justify-center text-fg-muted">
            <ImageIcon size={20} />
          </div>
        )}
      </button>
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={`absolute top-1 right-1 p-1 rounded-full opacity-0 group-hover:opacity-100 ${
            isLight ? 'bg-white text-rose-600' : 'bg-[#0F172A] text-rose-400'
          } shadow border ${isLight ? 'border-[#E2E8F0]' : 'border-white/10'}`}
          aria-label="Delete attachment"
        >
          {deleting ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        </button>
      )}
    </div>
  );
}

function FileAttachment({
  attachment,
  isLight,
  canDelete,
  onDeleted,
}: {
  attachment: ChatAttachment;
  isLight: boolean;
  canDelete: boolean;
  onDeleted?: (id: string) => void;
}) {
  const [downloading, setDownloading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    const res = await getAttachmentSignedUrl(attachment.storage_path, 60);
    setDownloading(false);
    if (!res.ok) {
      window.alert('Could not generate download link: ' + res.error);
      return;
    }
    // Open in new tab — browser handles whatever rendering or download
    // makes sense for the mime type.
    window.open(res.data, '_blank', 'noopener,noreferrer');
  }

  async function handleDelete() {
    if (!window.confirm(`Delete ${attachment.original_filename}?`)) return;
    setDeleting(true);
    const res = await deleteChatAttachment(attachment);
    setDeleting(false);
    if (res.ok) onDeleted?.(attachment.id);
  }

  return (
    <div
      className={`group inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md border ${
        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.04] border-white/10'
      } max-w-full`}
    >
      <FileIcon size={14} className="text-fg-muted flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-fg-heading text-xs font-medium truncate">{attachment.original_filename}</p>
        <p className="text-fg-muted text-[10px]">{formatSize(attachment.size_bytes)}</p>
      </div>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className={`p-1 rounded ${
          isLight
            ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05] hover:text-[#0F172A]'
            : 'text-[#CBD5E1]/70 hover:bg-white/[0.05] hover:text-white'
        }`}
        aria-label={`Download ${attachment.original_filename}`}
        title="Download"
      >
        {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
      </button>
      {canDelete && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className={`p-1 rounded opacity-0 group-hover:opacity-100 ${
            isLight ? 'text-rose-600 hover:bg-rose-500/[0.06]' : 'text-rose-400 hover:bg-rose-500/[0.08]'
          }`}
          aria-label="Delete attachment"
          title="Delete"
        >
          {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
        </button>
      )}
    </div>
  );
}

function ImageLightbox({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <img
        src={url}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 p-2 rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Close image"
      >
        <X size={18} />
      </button>
    </div>
  );
}
