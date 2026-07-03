import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, MessageSquare, Plus, X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import { useTheme } from '../../context/ThemeContext';
import type { DeliverablesResult } from '../../types/deliverables';

// =============================================================================
// DeliverableTextDrawer — right-edge slide-in for the three text-input flows
// of a deliverable draft, mirroring the VEW RequirementTextDrawer:
//
//   mode='edit' — rewrite a block's current_text. Drift-aware: when
//                 driftFromText (the frozen PIQC draft) differs from the
//                 seeded text, an "Original PIQC draft" block shows what the
//                 reviewer is editing away from. An optional note rides along
//                 (the edit RPC records it in the audit trail).
//
//   mode='note' — attach a review note to a block. The note IS the text.
//
//   mode='add'  — author a new human_editorial block for a section.
//
// Purely presentational: the panel owner shapes `subject` from whatever block
// or section is in flight and supplies onSave (usually a thin wrapper over
// the matching mutation API call). No optimistic updates — Save shows a
// loading state and the drawer stays open on failure with an inline error.
// SENSITIVE: drafted text and notes are never logged here.
// =============================================================================

export type DeliverableTextDrawerMode = 'edit' | 'note' | 'add';

export interface DeliverableTextDrawerSubject {
  /** Shown truncated in the drawer header (block text or section label). */
  title: string;
  /** Seeds the textarea on open. May be empty ('note' / 'add'). */
  initialText: string;
  /** Frozen PIQC draft to diff against — 'edit' mode only; null elsewhere. */
  driftFromText: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  mode: DeliverableTextDrawerMode;
  /** `null` keeps the drawer closed regardless of `open`. */
  subject: DeliverableTextDrawerSubject | null;
  /**
   * Save handler. Receives the trimmed text (plus a trimmed optional note in
   * 'edit' mode). Resolves ok → parent closes the drawer + refreshes rows;
   * resolves not-ok → the drawer stays open and shows the error inline.
   */
  onSave: (text: string, note?: string) => Promise<DeliverablesResult<unknown>>;
}

interface ModeCopy {
  headerLabel: string;
  description: string;
  icon: typeof FileText;
  textareaLabel: string;
  placeholder: string;
  saveLabel: string;
  emptyHint: string;
}

const COPY: Record<DeliverableTextDrawerMode, ModeCopy> = {
  edit: {
    headerLabel: 'Edit item',
    description:
      'Rewrite this item to sharpen or correct the draft wording. Your edit is kept when the checklist regenerates.',
    icon: FileText,
    textareaLabel: 'Item text',
    placeholder: 'Rewrite the item…',
    saveLabel: 'Save changes',
    emptyHint: "Item text can't be empty.",
  },
  note: {
    headerLabel: 'Add review note',
    description:
      'Attach a note to this item. Notes show with the item and in the edit log; they do not change the item text.',
    icon: MessageSquare,
    textareaLabel: 'Review note',
    placeholder: 'e.g. Confirm with the CRA before the visit…',
    saveLabel: 'Save note',
    emptyHint: "Note can't be empty.",
  },
  add: {
    headerLabel: 'Add item',
    description:
      'Add your own item to this section. It is marked as added by a reviewer and is never overwritten when the checklist regenerates.',
    icon: Plus,
    textareaLabel: 'Item text',
    placeholder: 'e.g. Verify delegation log covers the new sub-investigator…',
    saveLabel: 'Add item',
    emptyHint: "Item text can't be empty.",
  },
};

export function DeliverableTextDrawer({ open, onClose, mode, subject, onSave }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [draft, setDraft] = useState('');
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const isOpen = open && subject !== null;

  // Mirror `saving` into a ref so the close-guard callback keeps a stable
  // identity (same reasoning as VEW: unstable onClose would thrash the
  // useOverlay focus-trap effect on every keystroke).
  const savingRef = useRef(saving);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  // Seed the textarea on open.
  useEffect(() => {
    if (!isOpen || !subject) return;
    setDraft(subject.initialText);
    setNoteDraft('');
    setInlineError(null);
    setSaving(false);
    // Focus after the open animation begins (next tick).
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [isOpen, subject]);

  const guardedClose = useCallback(() => {
    if (savingRef.current) return;
    onClose();
  }, [onClose]);

  // Don't subscribe ESC/backdrop unless the drawer is actually open.
  useOverlay({ isOpen, onClose: guardedClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose: guardedClose });

  if (!isOpen || !subject) return null;

  const copy = COPY[mode];
  const Icon = copy.icon;
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !saving;
  const showDriftBlock =
    mode === 'edit' &&
    subject.driftFromText !== null &&
    subject.driftFromText !== subject.initialText;

  const handleSave = async () => {
    if (!canSave) return;
    setInlineError(null);
    setSaving(true);
    try {
      const trimmedNote = noteDraft.trim();
      const result = await onSave(
        trimmed,
        mode === 'edit' && trimmedNote.length > 0 ? trimmedNote : undefined,
      );
      if (result.ok) {
        // Parent closes the drawer + refreshes rows; nothing to do locally.
        return;
      }
      setInlineError(result.error);
    } finally {
      setSaving(false);
    }
  };

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div
      data-testid="deliverable-text-drawer"
      data-mode={mode}
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${copy.headerLabel}: ${subject.title}`}
    >
      <div
        data-testid="deliverable-text-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={saving ? undefined : guardedClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-md h-full flex flex-col shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Sticky header */}
        <div
          className={`sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-start justify-between gap-3 ${
            isLight
              ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]'
              : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <Icon size={11} aria-hidden />
              {copy.headerLabel}
            </p>
            <h2 className="text-fg-heading text-sm font-semibold truncate mt-0.5">
              {subject.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={guardedClose}
            disabled={saving}
            aria-label="Close drawer"
            className={`flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              saving
                ? 'opacity-40 cursor-not-allowed'
                : isLight
                  ? 'text-fg-sub hover:bg-[#E2E8F0] hover:text-fg-body'
                  : 'text-fg-sub hover:bg-white/[0.06] hover:text-fg-body'
            }`}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <p className="text-fg-sub text-xs leading-relaxed">{copy.description}</p>

          {/* Drift block — edit mode only, and only when the frozen PIQC draft
              differs from what the reviewer is editing. Label kept in sync
              with the origin taxonomy: this is PIQC's draft, not "truth". */}
          {showDriftBlock && subject.driftFromText && (
            <div
              data-testid="deliverable-drift-original-block"
              className={`rounded-md border px-3 py-2 ${
                isLight ? 'bg-[#F2F2F2] border-[#dde3ea]' : 'bg-white/[0.03] border-white/5'
              }`}
            >
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1">
                Original PIQC draft
              </p>
              <p className="text-fg-body text-xs leading-relaxed whitespace-pre-wrap">
                {subject.driftFromText}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="deliverable-text-drawer-textarea"
              className="block text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            >
              {copy.textareaLabel}
            </label>
            <textarea
              id="deliverable-text-drawer-textarea"
              ref={textareaRef}
              data-testid="deliverable-text-drawer-textarea"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={copy.placeholder}
              disabled={saving}
              rows={6}
              className={`w-full px-3 py-2 rounded-md border text-sm leading-relaxed resize-y min-h-[6rem] focus:outline-none focus:ring-2 ${
                isLight
                  ? 'bg-white border-[#CBD5E1] text-fg-body placeholder:text-fg-muted focus:ring-[#94A3B8]'
                  : 'bg-[#1a2029] border-white/10 text-fg-body placeholder:text-fg-muted focus:ring-white/20'
              } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
            />
            {trimmed.length === 0 && draft.length > 0 && (
              <p className="text-fg-muted text-[11px] mt-1">{copy.emptyHint}</p>
            )}
          </div>

          {/* Optional edit note — recorded alongside the text change in the
              block's edit log (the edit RPC accepts it as p_note). */}
          {mode === 'edit' && (
            <div>
              <label
                htmlFor="deliverable-text-drawer-note"
                className="block text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5"
              >
                Note for the edit log (optional)
              </label>
              <input
                id="deliverable-text-drawer-note"
                type="text"
                data-testid="deliverable-text-drawer-note"
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                placeholder="Why this wording changed…"
                disabled={saving}
                className={`w-full px-3 py-2 rounded-md border text-sm focus:outline-none focus:ring-2 ${
                  isLight
                    ? 'bg-white border-[#CBD5E1] text-fg-body placeholder:text-fg-muted focus:ring-[#94A3B8]'
                    : 'bg-[#1a2029] border-white/10 text-fg-body placeholder:text-fg-muted focus:ring-white/20'
                } ${saving ? 'opacity-60 cursor-not-allowed' : ''}`}
              />
            </div>
          )}

          {inlineError && (
            <div
              role="alert"
              data-testid="deliverable-text-drawer-error"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
                isLight
                  ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
                  : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
              }`}
            >
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span className="flex-1 leading-relaxed">{inlineError}</span>
            </div>
          )}

          <p className="text-fg-muted text-[10px] leading-relaxed">
            Press{' '}
            <kbd
              className={`px-1 py-0.5 rounded text-[10px] ${
                isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.05]'
              }`}
            >
              ⌘
            </kbd>{' '}
            +{' '}
            <kbd
              className={`px-1 py-0.5 rounded text-[10px] ${
                isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.05]'
              }`}
            >
              Enter
            </kbd>{' '}
            to save.
          </p>
        </div>

        {/* Sticky footer */}
        <div
          className={`sticky bottom-0 z-10 backdrop-blur px-5 py-3 border-t flex items-center justify-end gap-2 ${
            isLight
              ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]'
              : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <button
            type="button"
            onClick={guardedClose}
            disabled={saving}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${
              saving
                ? 'opacity-40 cursor-not-allowed'
                : isLight
                  ? 'text-fg-body hover:bg-[#E2E8F0]'
                  : 'text-fg-body hover:bg-white/[0.06]'
            }`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            data-testid="deliverable-text-drawer-save"
            className={`px-3 py-1.5 rounded-md text-xs font-semibold inline-flex items-center gap-1.5 ${
              !canSave
                ? isLight
                  ? 'bg-[#CBD5E1] text-white cursor-not-allowed'
                  : 'bg-white/10 text-fg-muted cursor-not-allowed'
                : isLight
                  ? 'bg-[#1E293B] text-white hover:bg-[#0F172A]'
                  : 'bg-white text-[#020617] hover:bg-[#E2E8F0]'
            }`}
          >
            {saving && <Loader2 size={11} className="animate-spin" aria-hidden />}
            {saving ? 'Saving…' : copy.saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
