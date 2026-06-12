import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  File as FileIcon,
  Loader2,
  Lock,
  MoreVertical,
  Pin,
  PinOff,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  deleteProtocolDocument,
  listChannelAttachments,
  listProtocolDocuments,
  listReductoDocumentsForProtocol,
  setChatAttachmentPinned,
  signChatAttachmentUrl,
  signProtocolDocumentUrl,
  uploadProtocolDocument,
  type ReductoDocument,
} from '../../../lib/orgs/orgsApi';
import {
  fileFamily,
  formatBytes,
  type DocFamily,
} from '../../../lib/orgs/protocolDocumentsAdapter';
import type { ChatAttachment, ProtocolDocument } from '../../../types/orgs';

// =============================================================================
// HubDocumentsTab — protocol-scoped document library. Unions three sources:
//
//   - Reducto-ingested protocol PDFs (read-only, locked)
//   - Manually uploaded files (this PR's new protocol_documents table)
//   - Chat attachments (existing chat_attachments table)
//
// Pinned chat attachments float to a top board. Filter pills toggle scope
// between "This protocol" / "All my docs" / "Org-level".
//
// Anyone with channel access can upload + pin; org admins / protocol
// coordinators (+ the uploader themself) can delete. Reducto docs are
// always read-only — they're managed by the SOTR / ingest pipeline.
// =============================================================================

type Scope = 'protocol' | 'all' | 'org';
type SourceKind = 'reducto' | 'upload' | 'chat';

interface UnifiedRow {
  key: string;
  source: SourceKind;
  name: string;
  size_bytes: number | null;
  uploader: string | null;
  created_at: string;
  protocol_id: string | null;
  org_id: string | null;
  family: DocFamily;
  pinned_at: string | null;
  // Source-specific keys for actions
  storage_path: string | null;
  protocol_document?: ProtocolDocument;
  chat_attachment?: ChatAttachment;
  reducto?: ReductoDocument;
  uploaded_by_user_id: string | null;
}

const FAMILY_STYLES: Record<DocFamily, { bg: string; fg: string; Icon: typeof FileText }> = {
  pdf: { bg: '#FCEBEB', fg: '#A32D2D', Icon: FileText },
  xlsx: { bg: '#EAF3DE', fg: '#3B6D11', Icon: FileSpreadsheet },
  docx: { bg: '#E1F5EE', fg: '#0F6E56', Icon: FileText },
  image: { bg: '#E6F1FB', fg: '#185FA5', Icon: ImageIcon },
  other: { bg: '#F1EFE8', fg: '#5F5E5A', Icon: FileIcon },
};

const SOURCE_PILLS: Record<SourceKind, { label: string; bg: string; fg: string }> = {
  reducto: { label: 'Protocol doc', bg: '#EEEDFE', fg: '#3C3489' },
  upload: { label: 'Uploaded', bg: '#E1F5EE', fg: '#0F6E56' },
  chat: { label: 'From chat', bg: '#FAECE7', fg: '#993C1D' },
};

export default function HubDocumentsTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { protocols, activeProtocol, setActiveProtocol } = useProtocol();

  // Default scope: if an active protocol exists, scope to it. Otherwise
  // show org-level docs. User can toggle to "All my docs" to see across
  // every protocol they're on.
  const [scope, setScope] = useState<Scope>(activeProtocol ? 'protocol' : 'org');
  useEffect(() => {
    // Re-default scope when the user picks a protocol/cleared one. Don't
    // override an explicit "all" choice though.
    if (scope === 'all') return;
    setScope(activeProtocol ? 'protocol' : 'org');
  }, [activeProtocol, scope]);

  // --- Data fetching ----------------------------------------------------
  const [reductoDocs, setReductoDocs] = useState<ReductoDocument[]>([]);
  const [uploads, setUploads] = useState<ProtocolDocument[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setError(null);
    try {
      if (scope === 'protocol' && activeProtocol) {
        const [r, u, c] = await Promise.all([
          listReductoDocumentsForProtocol(activeProtocol.id),
          listProtocolDocuments({ protocolId: activeProtocol.id }),
          listChannelAttachments('protocol', activeProtocol.id),
        ]);
        setReductoDocs(r.ok ? r.data : []);
        setUploads(u.ok ? u.data : []);
        setChatAttachments(c.ok ? c.data : []);
      } else if (scope === 'org') {
        const [u, c] = await Promise.all([
          listProtocolDocuments({ orgId: activeOrg.id }),
          listChannelAttachments('org', activeOrg.id),
        ]);
        setReductoDocs([]);
        setUploads(u.ok ? u.data : []);
        setChatAttachments(c.ok ? c.data : []);
      } else {
        // 'all' — union across every protocol the user can see + org channel.
        const protocolReducto = await Promise.all(
          protocols.map((p) => listReductoDocumentsForProtocol(p.id)),
        );
        const protocolUploads = await Promise.all(
          protocols.map((p) => listProtocolDocuments({ protocolId: p.id })),
        );
        const protocolChats = await Promise.all(
          protocols.map((p) => listChannelAttachments('protocol', p.id)),
        );
        const orgUploads = await listProtocolDocuments({ orgId: activeOrg.id });
        const orgChats = await listChannelAttachments('org', activeOrg.id);

        setReductoDocs(protocolReducto.flatMap((r) => (r.ok ? r.data : [])));
        setUploads([
          ...protocolUploads.flatMap((u) => (u.ok ? u.data : [])),
          ...(orgUploads.ok ? orgUploads.data : []),
        ]);
        setChatAttachments([
          ...protocolChats.flatMap((c) => (c.ok ? c.data : [])),
          ...(orgChats.ok ? orgChats.data : []),
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  }, [scope, activeOrg, activeProtocol, protocols]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // --- Unify all three sources into a single sorted row list -----------
  const allRows = useMemo<UnifiedRow[]>(() => {
    const rows: UnifiedRow[] = [];
    for (const d of reductoDocs) {
      rows.push({
        key: `r-${d.id}`,
        source: 'reducto',
        name: d.title || '(untitled)',
        size_bytes: null,
        uploader: null,
        created_at: d.created_at,
        protocol_id: null,
        org_id: null,
        family: fileFamily('application/pdf', d.title || '.pdf'),
        pinned_at: null,
        storage_path: null,
        reducto: d,
        uploaded_by_user_id: null,
      });
    }
    for (const d of uploads) {
      rows.push({
        key: `u-${d.id}`,
        source: 'upload',
        name: d.original_filename,
        size_bytes: d.size_bytes,
        uploader: d.uploaded_by_user_id,
        created_at: d.created_at,
        protocol_id: d.protocol_id,
        org_id: d.org_id,
        family: fileFamily(d.mime_type, d.original_filename),
        pinned_at: null,
        storage_path: d.storage_path,
        protocol_document: d,
        uploaded_by_user_id: d.uploaded_by_user_id,
      });
    }
    for (const a of chatAttachments) {
      rows.push({
        key: `c-${a.id}`,
        source: 'chat',
        name: a.original_filename,
        size_bytes: a.size_bytes,
        uploader: a.uploaded_by_user_id,
        created_at: a.created_at,
        protocol_id: a.protocol_id,
        org_id: a.org_id,
        family: fileFamily(a.mime_type, a.original_filename),
        pinned_at: a.pinned_at,
        storage_path: a.storage_path,
        chat_attachment: a,
        uploaded_by_user_id: a.uploaded_by_user_id,
      });
    }
    rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows;
  }, [reductoDocs, uploads, chatAttachments]);

  const pinnedRows = useMemo(
    () => allRows.filter((r) => r.pinned_at !== null),
    [allRows],
  );

  // --- Upload flow ------------------------------------------------------
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const handleUploadClick = () => {
    if (uploading) return;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setUploading(true);
    setError(null);
    const target =
      scope === 'org'
        ? { orgId: activeOrg?.id ?? '' }
        : activeProtocol
          ? { protocolId: activeProtocol.id }
          : null;
    if (!target) {
      setError('Pick a protocol or switch to Org-level scope before uploading.');
      setUploading(false);
      return;
    }
    const res = await uploadProtocolDocument({ file, ...target });
    setUploading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setUploads((prev) => [res.data, ...prev]);
  };

  // --- Row actions -----------------------------------------------------
  const handleDownload = async (row: UnifiedRow) => {
    if (!row.storage_path) return;
    const res =
      row.source === 'upload'
        ? await signProtocolDocumentUrl(row.storage_path)
        : await signChatAttachmentUrl(row.storage_path);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    window.open(res.data, '_blank', 'noopener,noreferrer');
  };

  const handleTogglePin = async (row: UnifiedRow) => {
    if (!row.chat_attachment) return;
    const pin = row.pinned_at === null;
    const res = await setChatAttachmentPinned(row.chat_attachment.id, pin);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setChatAttachments((prev) =>
      prev.map((a) => (a.id === res.data.id ? res.data : a)),
    );
  };

  const handleDelete = async (row: UnifiedRow) => {
    if (!row.protocol_document) return;
    if (!confirm(`Delete ${row.name}? This can't be undone.`)) return;
    const res = await deleteProtocolDocument(row.protocol_document);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setUploads((prev) => prev.filter((u) => u.id !== row.protocol_document!.id));
  };

  // --- Render ----------------------------------------------------------
  const borderClass = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const cardBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const inputBg = isLight
    ? 'bg-white border-[#E2E8F0] text-[#0F172A]'
    : 'bg-[#1E293B] border-white/10 text-[#E2E8F0]';
  const filterIdleClass = isLight
    ? 'text-[#334155]/70 border-[#E2E8F0]'
    : 'text-[#CBD5E1]/65 border-white/10';
  const filterActiveClass = isLight
    ? 'bg-[#0F172A]/[0.05] text-[#0F172A] border-[#E2E8F0] font-medium'
    : 'bg-white/[0.06] text-white border-white/20 font-medium';

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={activeProtocol?.id ?? ''}
          onChange={(e) => {
            const next = protocols.find((p) => p.id === e.target.value);
            setActiveProtocol(next ?? null);
          }}
          className={`text-xs rounded-md border px-2 py-1.5 ${inputBg} focus:outline-none focus:ring-2 focus:ring-brand-600/30 max-w-[260px]`}
        >
          <option value="">— pick a protocol —</option>
          {protocols.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} — {p.name}
            </option>
          ))}
        </select>
        <span className={`${labelColor} text-[11px] mx-1`}>scope:</span>
        <button
          type="button"
          onClick={() => setScope('protocol')}
          disabled={!activeProtocol}
          className={`text-[11px] px-2.5 py-1 rounded-full border ${
            scope === 'protocol' ? filterActiveClass : filterIdleClass
          } disabled:opacity-40`}
        >
          This protocol
        </button>
        <button
          type="button"
          onClick={() => setScope('all')}
          className={`text-[11px] px-2.5 py-1 rounded-full border ${
            scope === 'all' ? filterActiveClass : filterIdleClass
          }`}
        >
          All my docs
        </button>
        <button
          type="button"
          onClick={() => setScope('org')}
          className={`text-[11px] px-2.5 py-1 rounded-full border ${
            scope === 'org' ? filterActiveClass : filterIdleClass
          }`}
        >
          Org-level
        </button>
        <button
          type="button"
          onClick={handleUploadClick}
          disabled={uploading || (scope !== 'org' && !activeProtocol)}
          className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md ${
            isLight
              ? 'bg-[#534AB7] text-white hover:bg-[#3C3489]'
              : 'bg-[#7F77DD] text-white hover:bg-[#534AB7]'
          } disabled:opacity-50`}
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          Upload
        </button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={handleFileSelected}
        />
      </div>

      {error && (
        <div
          className={`px-3 py-2 rounded-md text-xs ${
            isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
          }`}
        >
          {error}
        </div>
      )}

      {/* Pinned board */}
      {pinnedRows.length > 0 && (
        <section>
          <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-semibold mb-2 ${labelColor}`}>
            <Pin size={12} style={{ color: '#BA7517' }} />
            Pinned · {pinnedRows.length}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {pinnedRows.map((row) => {
              const fam = FAMILY_STYLES[row.family];
              const Icon = fam.Icon;
              return (
                <button
                  key={`pin-${row.key}`}
                  type="button"
                  onClick={() => handleDownload(row)}
                  className={`text-left rounded-md p-2.5 border ${borderClass} ${cardBg} hover:shadow-sm relative`}
                >
                  <Pin
                    size={11}
                    className="absolute top-2 right-2"
                    style={{ color: '#BA7517' }}
                  />
                  <div
                    className="h-12 rounded-md flex items-center justify-center mb-2"
                    style={{ backgroundColor: fam.bg, color: fam.fg }}
                  >
                    <Icon size={20} />
                  </div>
                  <p className="text-[11px] font-medium text-fg-heading line-clamp-2 break-words">
                    {row.name}
                  </p>
                  <p className={`text-[10px] ${labelColor} mt-0.5`}>
                    {row.size_bytes !== null ? formatBytes(row.size_bytes) : '—'}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* All-docs list */}
      <section>
        <div className={`flex items-center justify-between mb-2 text-[11px] uppercase tracking-wider font-semibold ${labelColor}`}>
          <span>All documents · {allRows.length}</span>
          <span className="normal-case tracking-normal text-[11px] font-normal">sort by date</span>
        </div>
        {loading && allRows.length === 0 ? (
          <p className={`${subColor} text-xs italic px-3 py-6 text-center`}>Loading…</p>
        ) : allRows.length === 0 ? (
          <div className={`rounded-md border ${borderClass} px-4 py-8 text-center`}>
            <p className="text-fg-body text-sm">No documents in this scope yet.</p>
            <p className={`${subColor} text-xs mt-1`}>
              Upload one, or share a file in chat — it'll surface here.
            </p>
          </div>
        ) : (
          <div className={`rounded-md border ${borderClass} divide-y ${borderClass}`}>
            {allRows.map((row) => {
              const fam = FAMILY_STYLES[row.family];
              const Icon = fam.Icon;
              const pill = SOURCE_PILLS[row.source];
              const isReducto = row.source === 'reducto';
              const isUpload = row.source === 'upload';
              const isChat = row.source === 'chat';
              const isOwn = row.uploaded_by_user_id === user?.id;
              return (
                <DocRow
                  key={row.key}
                  row={row}
                  family={fam}
                  IconComp={Icon}
                  pill={pill}
                  isReducto={isReducto}
                  isUpload={isUpload}
                  isChat={isChat}
                  canDelete={isUpload && isOwn}
                  borderClass={borderClass}
                  labelColor={labelColor}
                  subColor={subColor}
                  isLight={isLight}
                  onDownload={() => handleDownload(row)}
                  onTogglePin={() => handleTogglePin(row)}
                  onDelete={() => handleDelete(row)}
                />
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row — pulled out so the action menu state doesn't pollute parent renders.
// ---------------------------------------------------------------------------

interface DocRowProps {
  row: UnifiedRow;
  family: (typeof FAMILY_STYLES)[DocFamily];
  IconComp: typeof FileText;
  pill: (typeof SOURCE_PILLS)[SourceKind];
  isReducto: boolean;
  isUpload: boolean;
  isChat: boolean;
  canDelete: boolean;
  borderClass: string;
  labelColor: string;
  subColor: string;
  isLight: boolean;
  onDownload: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function DocRow({
  row,
  family,
  IconComp,
  pill,
  isReducto,
  isUpload,
  isChat,
  canDelete,
  borderClass,
  labelColor,
  subColor,
  isLight,
  onDownload,
  onTogglePin,
  onDelete,
}: DocRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 relative">
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0"
        style={{ backgroundColor: family.bg, color: family.fg }}
      >
        <IconComp size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          {row.pinned_at !== null && (
            <Pin size={11} style={{ color: '#BA7517' }} aria-label="Pinned" />
          )}
          <span className="text-fg-heading text-sm font-medium truncate">{row.name}</span>
          {isReducto && (
            <Lock size={11} className={subColor} aria-label="Read-only" />
          )}
        </div>
        <p className={`${subColor} text-[11px] mt-0.5`}>
          {new Date(row.created_at).toLocaleDateString()}
          {row.size_bytes !== null && ` · ${formatBytes(row.size_bytes)}`}
        </p>
      </div>
      <span
        className="text-[10px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: pill.bg, color: pill.fg }}
      >
        {pill.label}
      </span>

      {/* Action menu — Reducto rows get a disabled lock icon; others get a
          MoreVertical with Download + Pin/Unpin + Delete. */}
      {isReducto ? (
        <span className={`${labelColor} p-1`}>
          <MoreVertical size={14} className="opacity-30" />
        </span>
      ) : (
        <div className="relative flex-shrink-0">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`p-1 rounded ${
              isLight ? 'text-[#334155]/55 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/55 hover:bg-white/[0.05]'
            }`}
            aria-label="Actions"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setMenuOpen(false)}
                aria-hidden="true"
              />
              <div
                className={`absolute right-0 top-full mt-1 z-20 w-40 rounded-md border shadow-md ${borderClass} ${
                  isLight ? 'bg-white' : 'bg-[#0F172A]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onDownload();
                  }}
                  className={`w-full text-left text-xs px-3 py-2 flex items-center gap-2 ${
                    isLight ? 'hover:bg-[#0F172A]/[0.04]' : 'hover:bg-white/[0.04]'
                  }`}
                >
                  <Download size={12} />
                  Download
                </button>
                {isChat && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onTogglePin();
                    }}
                    className={`w-full text-left text-xs px-3 py-2 flex items-center gap-2 ${
                      isLight ? 'hover:bg-[#0F172A]/[0.04]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    {row.pinned_at !== null ? (
                      <>
                        <PinOff size={12} />
                        Unpin
                      </>
                    ) : (
                      <>
                        <Pin size={12} />
                        Pin to board
                      </>
                    )}
                  </button>
                )}
                {isUpload && canDelete && (
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      onDelete();
                    }}
                    className={`w-full text-left text-xs px-3 py-2 flex items-center gap-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/[0.08]`}
                  >
                    <Trash2 size={12} />
                    Delete
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
