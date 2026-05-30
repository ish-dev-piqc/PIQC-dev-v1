import { useCallback, useEffect, useRef, useState } from 'react';
import { X, AlertTriangle, Loader2, FileText, MessageSquare, Plus } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// RequirementTextDrawer — Sprint 4b, extended in Sprint 4c.
//
// Right-edge slide-in panel for three text-input flows:
//
//   mode='edit'           — rewrite a requirement's current_text. Drift-aware:
//                            shows the parser's derived_text in a quiet block
//                            so the user knows what they're editing away from.
//
//   mode='note'           — attach a free-form site note to a requirement.
//                            Pre-fills empty (no editing prior notes — new
//                            notes append to the audit log).
//
//   mode='promote_signal' — Sprint 4c. Coordinator is promoting a detected
//                            completeness signal into a new requirement.
//                            Pre-fills with the signal's gap_text; user can
//                            tweak before saving. No drift block (no parser-
//                            original to compare against — the gap_text IS
//                            the parser output).
//
// The drawer is purely presentational: it takes a generic `subject` object
// (title, initial draft, optional drift-from text) plus a mode discriminator
// and an onSave callback. Owners (VisitExecutionTab) compute the subject
// from whatever underlying object is in flight (a VisitExecutionItem or a
// VisitCompletenessSignal) — this keeps the drawer free of mode-isolation
// concerns and reusable for future text-input flows in the workspace.
//
// Follows the TraceabilityDrawer overlay pattern (useOverlay + useSwipeDismiss
// + max-w-md right panel). No optimistic update: text changes are high-stakes;
// rolling back mid-edit is jarring. Loading state on Save button; drawer
// stays open until success or user dismisses.
// =============================================================================

export type RequirementTextDrawerMode = 'edit' | 'note' | 'promote_signal' | 'add';

/**
 * Generic display payload for the drawer. The owner of the drawer's state
 * (VisitExecutionTab) is responsible for shaping the right subject for the
 * current mode — the drawer itself doesn't know about items, signals, or
 * any of the underlying domain objects.
 *
 * `title`         — shown in the drawer header (truncated). Usually the
 *                    requirement label or the gap statement.
 * `initialDraft`  — seeds the textarea on open. May be empty.
 * `driftFromText` — only consulted when mode === 'edit'. When non-null AND
 *                    different from the initial draft, the drawer renders
 *                    the "Original parser output" block. Sprint 4c's
 *                    'promote_signal' mode always passes null (the gap_text
 *                    IS the parser output; nothing to compare against).
 */
export interface RequirementTextDrawerSubject {
  title: string;
  initialDraft: string;
  driftFromText: string | null;
}

export interface RequirementTextDrawerProps {
  /** Subject of the drawer. `null` keeps the drawer closed. */
  subject: RequirementTextDrawerSubject | null;
  mode: RequirementTextDrawerMode;
  onClose: () => void;
  /**
   * Save handler. Receives the trimmed text and resolves to either a success
   * (drawer will close) or an error string (drawer stays open, shows inline
   * error below the textarea).
   */
  onSave: (text: string) => Promise<{ ok: true } | { ok: false; error: string }>;
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

const COPY: Record<RequirementTextDrawerMode, ModeCopy> = {
  edit: {
    headerLabel: 'Edit requirement',
    // Drift block below self-explains the parser-original preservation;
    // description stays focused on what the user does here.
    description:
      'Rewrite this requirement to match site-specific wording or clarify intent.',
    icon: FileText,
    textareaLabel: 'Requirement text',
    placeholder: 'Rewrite the requirement…',
    saveLabel: 'Save changes',
    emptyHint: "Requirement text can't be empty.",
  },
  note: {
    headerLabel: 'Add site note',
    description:
      'Attach a free-form note to this requirement. Visible in the audit log; does not change the requirement text itself.',
    icon: MessageSquare,
    textareaLabel: 'Site note',
    placeholder: 'e.g. Heparin lock in place per site SOP…',
    saveLabel: 'Save note',
    emptyHint: "Note can't be empty.",
  },
  promote_signal: {
    headerLabel: 'Add as requirement',
    description:
      'PIQC flagged this as likely-missing from the parsed checklist. Promoting adds it as a new human-added requirement; you can adjust the wording before saving.',
    icon: Plus,
    textareaLabel: 'Requirement text',
    placeholder: 'Refine the wording before adding…',
    saveLabel: 'Add requirement',
    emptyHint: "Requirement text can't be empty.",
  },
  add: {
    headerLabel: 'Add requirement',
    description:
      'Add a new requirement to this visit. It is marked as coordinator-added and appears in the checklist and the exported worksheet.',
    icon: Plus,
    textareaLabel: 'Requirement text',
    placeholder: 'e.g. Confirm fasting status before draw…',
    saveLabel: 'Add requirement',
    emptyHint: "Requirement text can't be empty.",
  },
};

export default function RequirementTextDrawer({
  subject,
  mode,
  onClose,
  onSave,
}: RequirementTextDrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);

  // Mirror `saving` into a ref so the close-guard callback can read the
  // latest value without changing its own identity each render. Keeps the
  // `useOverlay` effect deps stable (it has onClose in deps; an unstable
  // onClose would re-fire the effect on every render and thrash the
  // focus-trap setup).
  const savingRef = useRef(saving);
  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  // Seed the textarea on open. Subject.initialDraft is mode-aware (parent
  // chooses: label for edit, empty for note, gap_text for promote_signal).
  useEffect(() => {
    if (!subject) return;
    setDraft(subject.initialDraft);
    setInlineError(null);
    setSaving(false);
    // Focus after the open animation begins (next tick).
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [subject]);

  // Saving-gated close callback. Stable reference — only changes when the
  // parent's onClose changes (which is itself memoized in VisitExecutionTab
  // via useCallback). Lets useOverlay's effect deps stay stable across the
  // saving=false→true transition.
  const guardedClose = useCallback(() => {
    if (savingRef.current) return;
    onClose();
  }, [onClose]);

  // Don't subscribe ESC/backdrop unless the drawer is actually open.
  useOverlay({
    isOpen: subject !== null,
    onClose: guardedClose,
    containerRef: panelRef,
  });
  const swipe = useSwipeDismiss({ onClose: guardedClose });

  if (!subject) return null;

  const copy = COPY[mode];
  const Icon = copy.icon;
  const trimmed = draft.trim();
  const canSave = trimmed.length > 0 && !saving;
  // Drift block — only for 'edit' mode, and only when there's a meaningful
  // diff between current draft origin and the parser-original. 'promote_signal'
  // always passes driftFromText=null so this block never renders for it.
  const showDriftBlock =
    mode === 'edit' &&
    subject.driftFromText !== null &&
    subject.driftFromText !== subject.initialDraft;

  const handleSave = async () => {
    if (!canSave) return;
    setInlineError(null);
    setSaving(true);
    try {
      const result = await onSave(trimmed);
      if (result.ok) {
        // Parent closes the drawer + refreshes the row; no need for local close.
        return;
      }
      setInlineError(result.error);
    } finally {
      setSaving(false);
    }
  };

  // Cmd/Ctrl + Enter to save — coordinators on dense forms expect this.
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handleSave();
    }
  };

  return (
    <div
      data-testid="vew-text-drawer"
      data-mode={mode}
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`${copy.headerLabel}: ${subject.title}`}
    >
      <div
        data-testid="vew-text-drawer-backdrop"
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

          {/* Drift block — only when editing AND a parser-different derived_text exists.
              Phrasing kept in sync with the row's drift hint chip (ExecutionChecklist):
              both surfaces refer to the parser's frozen text as "parser output". */}
          {showDriftBlock && subject.driftFromText && (
            <div
              data-testid="vew-drift-original-block"
              className={`rounded-md border px-3 py-2 ${
                isLight ? 'bg-[#F2F2F2] border-[#dde3ea]' : 'bg-white/[0.03] border-white/5'
              }`}
            >
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1">
                Original parser output
              </p>
              <p className="text-fg-body text-xs leading-relaxed whitespace-pre-wrap">
                {subject.driftFromText}
              </p>
            </div>
          )}

          <div>
            <label
              htmlFor="vew-text-drawer-textarea"
              className="block text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5"
            >
              {copy.textareaLabel}
            </label>
            <textarea
              id="vew-text-drawer-textarea"
              ref={textareaRef}
              data-testid="vew-text-drawer-textarea"
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

          {inlineError && (
            <div
              role="alert"
              data-testid="vew-text-drawer-error"
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
            Press <kbd className={`px-1 py-0.5 rounded text-[10px] ${
              isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.05]'
            }`}>⌘</kbd> + <kbd className={`px-1 py-0.5 rounded text-[10px] ${
              isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.05]'
            }`}>Enter</kbd> to save.
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
            data-testid="vew-text-drawer-save"
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
