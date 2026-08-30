import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Plus, FileText } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { AuditWithContext } from '../../../context/AuditContext';
import { useOverlay } from '../../../hooks/useOverlay';
import type { AuditEvidenceListRow } from '../../../types/audit';
import {
  ingestAuditEvidence,
  listAuditEvidence,
  removeAuditEvidence,
} from '../../../lib/audit/evidenceApi';

// =============================================================================
// EvidenceDrawer — the audit-level source evidence register.
//
// Evidence (most importantly the vendor's completed questionnaire) arrives as
// emailed files at ANY stage, so the register lives at audit level (header
// button, cross-stage — peer of Traceability/IssuesCapa) rather than inside a
// stage workspace. v1 intake is paste-the-text; the copy is honest about it.
//
// Questionnaire duality rule: the structured in-app questionnaire (latch,
// prefill, gates) is the workflow source of truth; an attached questionnaire
// FILE is provenance + retrieval grounding. They complement, never compete.
//
// Attach/remove write 'AUDIT' deltas server-side (visible in History).
// =============================================================================

interface Props {
  audit: AuditWithContext;
  onClose: () => void;
}

// Preset classification chips (UI-only — source_type stays free text).
const SOURCE_TYPE_PRESETS = [
  'Completed questionnaire',
  'SOP',
  'Prior audit report',
  'Fact sheet',
  'Certificate',
  'Org chart',
  'CV',
];

export default function EvidenceDrawer({ audit, onClose }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  const [rows, setRows] = useState<AuditEvidenceListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Two-click remove: first click arms this document_id, second click commits.
  const [removeArmed, setRemoveArmed] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listAuditEvidence(audit.id);
    if (res.ok) {
      setRows(res.data);
      setListError(null);
    } else {
      setListError(res.error);
    }
    setLoading(false);
  }, [audit.id]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputStyles = isLight
    ? 'bg-white border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'bg-[#0F172A] border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  const statusTone = (s: AuditEvidenceListRow['status']): string =>
    s === 'ready'
      ? isLight
        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300'
      : s === 'pending'
        ? isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
        : isLight
          ? 'bg-rose-50 border-rose-200 text-rose-700'
          : 'bg-rose-500/15 border-rose-500/30 text-rose-300';

  return (
    <div
      data-testid="evidence-drawer"
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Source evidence"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={panelRef}
        className={`relative w-full max-w-2xl h-full overflow-y-auto shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Header */}
        <div
          className={`sticky top-0 z-10 px-5 py-3.5 border-b backdrop-blur ${
            isLight ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]' : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                Source evidence
              </p>
              <h2 className={`${headingColor} text-sm font-semibold mt-0.5 truncate`}>
                {audit.audit_name}
              </h2>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Open-only (never a toggle): a second click must not silently
                  unmount a half-filled form — the form's own Cancel closes it. */}
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                aria-expanded={addOpen}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
              >
                <Plus size={12} />
                Attach evidence
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${mutedColor} hover:bg-[#E2E8F0] dark:hover:bg-white/[0.06]`}
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className={`${subColor} text-xs`}>
            File source documents as they arrive — each one grounds AI drafting and carries
            provenance into the report.{' '}
            <span className={headingColor}>The in-app questionnaire stays the workflow source of
            truth</span>; an attached questionnaire file is evidence behind it.
          </p>

          {addOpen && (
            <AddEvidenceForm
              busy={busy}
              isLight={isLight}
              cardBg={cardBg}
              inputStyles={inputStyles}
              buttonPrimary={buttonPrimary}
              buttonSecondary={buttonSecondary}
              error={addError}
              onCancel={() => {
                setAddOpen(false);
                setAddError(null);
              }}
              onSubmit={async (input) => {
                setBusy(true);
                const res = await ingestAuditEvidence({ auditId: audit.id, ...input });
                setBusy(false);
                if (res.ok) {
                  setAddOpen(false);
                  setAddError(null);
                  await reload();
                } else {
                  // Honest failure: name the reason, keep the auditor's paste.
                  setAddError(res.error);
                }
              }}
            />
          )}

          {loading && (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && listError && (
            <div className={`${cardBg} border rounded-xl px-4 py-3`}>
              <p className={`${subColor} text-xs`}>
                The evidence list didn’t load: {listError}
              </p>
            </div>
          )}

          {!loading && !listError && rows.length === 0 && !addOpen && (
            <div className={`${cardBg} border border-dashed rounded-xl px-6 py-10 text-center`}>
              <div className={`inline-flex items-center justify-center w-11 h-11 rounded-2xl border mb-3 ${isLight ? 'bg-brand-600/10 border-brand-600/20 text-brand-600' : 'bg-brand-600/15 border-brand-600/30 text-brand-300'}`}>
                <FileText size={18} />
              </div>
              <h3 className={`${headingColor} font-semibold text-sm mb-1`}>No evidence yet</h3>
              <p className={`${subColor} text-xs max-w-sm mx-auto`}>
                Evidence usually arrives with the vendor’s completed questionnaire — attach each
                document’s text the moment it lands, at any stage. Everything here becomes
                grounding for AI drafting.
              </p>
            </div>
          )}

          {!loading &&
            rows.map((row) => (
              <div key={row.document_id} className={`${cardBg} border rounded-xl px-4 py-3`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`${headingColor} text-sm font-semibold truncate`}>{row.title}</p>
                    <p className={`${subColor} text-xs mt-0.5`}>
                      {row.source_type}
                      {row.source_locator ? ` · ${row.source_locator}` : ''}
                      {' · '}
                      {new Date(row.added_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${statusTone(row.status)}`}
                    >
                      {row.status}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        if (removeArmed !== row.document_id) {
                          setRemoveArmed(row.document_id);
                          setRemoveError(null);
                          return;
                        }
                        setBusy(true);
                        const res = await removeAuditEvidence(audit.id, row.document_id);
                        setBusy(false);
                        setRemoveArmed(null);
                        if (res.ok) {
                          setRemoveError(null);
                          await reload();
                        } else {
                          setRemoveError(res.error);
                        }
                      }}
                      className={`text-xs font-semibold px-2 py-1 rounded-md transition-colors ${
                        removeArmed === row.document_id
                          ? isLight
                            ? 'bg-rose-600 text-white hover:bg-rose-700'
                            : 'bg-rose-500/80 text-white hover:bg-rose-500'
                          : buttonSecondary
                      }`}
                    >
                      {removeArmed === row.document_id ? 'Confirm remove' : 'Remove'}
                    </button>
                  </div>
                </div>
                {removeArmed === row.document_id && (
                  <p className={`${mutedColor} text-[11px] mt-2`}>
                    Removing deletes this document from the register and from retrieval. The
                    removal is recorded in the audit history.
                  </p>
                )}
              </div>
            ))}

          {removeError && (
            <p className={`${subColor} text-xs`}>
              The removal didn’t save: {removeError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Add form — paste-the-text intake (v1). Chips suggest the source type and a
// title; both stay editable free text.
// -----------------------------------------------------------------------------
interface AddFormProps {
  busy: boolean;
  isLight: boolean;
  cardBg: string;
  inputStyles: string;
  buttonPrimary: string;
  buttonSecondary: string;
  error: string | null;
  onCancel: () => void;
  onSubmit: (input: {
    title: string;
    sourceType: string;
    sourceLocator?: string;
    content: string;
  }) => Promise<void>;
}

function AddEvidenceForm({
  busy,
  isLight,
  cardBg,
  inputStyles,
  buttonPrimary,
  buttonSecondary,
  error,
  onCancel,
  onSubmit,
}: AddFormProps) {
  const [sourceType, setSourceType] = useState('');
  const [title, setTitle] = useState('');
  const [locator, setLocator] = useState('');
  const [content, setContent] = useState('');

  const labelCls = 'text-fg-label text-[10px] uppercase tracking-wider font-semibold';
  const inputCls = `w-full text-sm rounded-md border px-2.5 py-1.5 outline-none transition-colors text-fg-body ${inputStyles}`;
  const chipBase = 'text-xs font-medium px-2 py-1 rounded-full border transition-colors';
  const canSubmit =
    !busy && sourceType.trim().length > 0 && content.trim().length > 0;

  return (
    <div className={`${cardBg} border rounded-xl px-4 py-4 space-y-3`}>
      <div className="space-y-1.5">
        <p className={labelCls}>What is it?</p>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_TYPE_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setSourceType(preset);
                // Suggest a title only while the auditor hasn't typed one.
                setTitle((t) => (t.trim() === '' || SOURCE_TYPE_PRESETS.includes(t) ? preset : t));
              }}
              className={`${chipBase} ${
                sourceType === preset
                  ? isLight
                    ? 'bg-brand-600/10 border-brand-600/40 text-brand-600'
                    : 'bg-brand-600/20 border-brand-600/40 text-brand-300'
                  : isLight
                    ? 'bg-white border-[#CBD5E1] text-[#334155]'
                    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          placeholder="Or type your own — e.g. Training log"
          aria-label="Source type"
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <p className={labelCls}>Title</p>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="How this document should appear in the register"
          aria-label="Evidence title"
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <p className={labelCls}>Document number / location (optional)</p>
        <input
          type="text"
          value={locator}
          onChange={(e) => setLocator(e.target.value)}
          placeholder="e.g. SOP-QA-014 v3, binder 2 tab 5, sharepoint link"
          aria-label="Source locator"
          className={inputCls}
        />
      </div>

      <div className="space-y-1.5">
        <p className={labelCls}>Document text</p>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={8}
          placeholder="Paste the document’s text here — open the Word/Excel file, select all, copy, paste. Direct file upload is coming."
          aria-label="Document text"
          className={`${inputCls} resize-y font-mono text-xs leading-relaxed`}
        />
      </div>

      {error && (
        <p className="text-xs text-rose-500">
          {error} — your entries are kept.
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() =>
            void onSubmit({
              title: title.trim() || sourceType.trim(),
              sourceType: sourceType.trim(),
              sourceLocator: locator.trim() || undefined,
              content,
            })
          }
          className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
        >
          {busy ? 'Attaching…' : 'Attach'}
        </button>
      </div>
    </div>
  );
}
