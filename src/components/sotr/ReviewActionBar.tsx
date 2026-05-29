import { useState } from 'react';
import { Check, Pencil, X, Flag, Loader2 } from 'lucide-react';
import { createReviewEvent, ReviewActionValidationError } from '../../lib/sotr/reviewApi';
import type {
  CreateReviewEventResult,
  DraftReviewAction,
  WorksheetItemSourceEvidence,
} from '../../types/sotr';

// =============================================================================
// ReviewActionBar — draft review actions for the Source Truth Panel.
//
// Four primary actions on the worksheet item:
//   Accept for Draft   → no extra input
//   Edit Draft Item    → opens an inline editor (textarea + optional note)
//   Reject from Draft  → opens an inline note form (note encouraged)
//   Flag Item          → opens an inline note form (note encouraged)
//
// Flag Source is rendered next to each individual source card (see
// FlagSourceButton) so the user can flag the specific citation, not the item.
//
// PIQC is a drafting + review aid — language is "draft" and "review" only.
// No "approve", "sign", "certify".
// =============================================================================

type Mode =
  | { kind: 'idle' }
  | { kind: 'submitting'; action: DraftReviewAction }
  | { kind: 'editing' }
  | { kind: 'noting'; action: 'reject_from_draft' | 'flag_item' }
  | { kind: 'error'; message: string };

interface Props {
  studyId: string;
  data: WorksheetItemSourceEvidence;
  onCompleted: (result: CreateReviewEventResult) => void;
}

export default function ReviewActionBar({ studyId, data, onCompleted }: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });

  const evidenceIds = data.sources.map((s) => s.id);
  const itemId = data.worksheet_item_id;

  // Single shared submitter. All actions go through one RPC.
  async function submit(
    action: DraftReviewAction,
    extra: { new_item_text?: string; reviewer_note?: string } = {},
  ) {
    setMode({ kind: 'submitting', action });
    try {
      const result = await createReviewEvent(studyId, itemId, {
        action,
        new_item_text: extra.new_item_text,
        reviewer_note: extra.reviewer_note,
        source_evidence_record_ids: evidenceIds,
      });
      setMode({ kind: 'idle' });
      onCompleted(result);
    } catch (err) {
      let message = 'We could not record that review action. Please try again.';
      if (err instanceof ReviewActionValidationError) message = err.message;
      setMode({ kind: 'error', message });
    }
  }

  // Inline editor body
  if (mode.kind === 'editing') {
    return (
      <EditDraftForm
        initialText={data.worksheet_item_text ?? data.current_text ?? ''}
        busy={false}
        onCancel={() => setMode({ kind: 'idle' })}
        onSave={(newText, note) =>
          submit('edit_draft_item', {
            new_item_text: newText,
            reviewer_note: note || undefined,
          })
        }
      />
    );
  }

  // Inline note form for reject/flag
  if (mode.kind === 'noting') {
    const action = mode.action;
    return (
      <NoteForm
        action={action}
        busy={false}
        onCancel={() => setMode({ kind: 'idle' })}
        onSubmit={(note) =>
          submit(action, { reviewer_note: note || undefined })
        }
      />
    );
  }

  return (
    <div data-testid="sotr-review-action-bar" className="space-y-2">
      <p className="text-[11px] leading-relaxed text-fg-sub">
        Your decision here lands in the protocol draft that Audit Mode and Reports read from.
        <strong className="font-semibold text-fg-heading"> Accept</strong> keeps the value as-is,
        {' '}<strong className="font-semibold text-fg-heading">Edit</strong> rewrites it,
        {' '}<strong className="font-semibold text-fg-heading">Reject</strong> excludes it, and
        {' '}<strong className="font-semibold text-fg-heading">Flag</strong> queues it for a
        teammate to revisit.
      </p>

      {mode.kind === 'error' && (
        <div
          data-testid="sotr-review-action-error"
          role="alert"
          className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-500/[0.06] border border-rose-200 dark:border-rose-500/20 rounded-md px-2.5 py-1.5"
        >
          {mode.message}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <ActionButton
          testid="sotr-accept-for-draft"
          icon={<Check size={11} />}
          label="Accept for Draft"
          tone="success"
          busy={mode.kind === 'submitting' && mode.action === 'accept_for_draft'}
          disabled={mode.kind === 'submitting'}
          onClick={() => submit('accept_for_draft')}
        />
        <ActionButton
          testid="sotr-edit-draft-item"
          icon={<Pencil size={11} />}
          label="Edit Draft Item"
          tone="neutral"
          busy={false}
          disabled={mode.kind === 'submitting'}
          onClick={() => setMode({ kind: 'editing' })}
        />
        <ActionButton
          testid="sotr-reject-from-draft"
          icon={<X size={11} />}
          label="Reject from Draft"
          tone="danger"
          busy={mode.kind === 'submitting' && mode.action === 'reject_from_draft'}
          disabled={mode.kind === 'submitting'}
          onClick={() => setMode({ kind: 'noting', action: 'reject_from_draft' })}
        />
        <ActionButton
          testid="sotr-flag-item"
          icon={<Flag size={11} />}
          label="Flag Item"
          tone="warning"
          busy={mode.kind === 'submitting' && mode.action === 'flag_item'}
          disabled={mode.kind === 'submitting'}
          onClick={() => setMode({ kind: 'noting', action: 'flag_item' })}
        />
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// ActionButton — shared visual button with busy spinner
// -----------------------------------------------------------------------------

const TONE_CLASSES: Record<'success' | 'neutral' | 'danger' | 'warning', string> = {
  success: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/[0.08]',
  neutral: 'border-[#E2E8F0] text-fg-body hover:bg-[#F8FAFC] dark:border-white/10 dark:hover:bg-white/[0.04]',
  danger:  'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/[0.08]',
  warning: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/[0.08]',
};

function ActionButton({
  testid,
  icon,
  label,
  tone,
  busy,
  disabled,
  onClick,
}: {
  testid: string;
  icon: React.ReactNode;
  label: string;
  tone: keyof typeof TONE_CLASSES;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={testid}
      disabled={disabled || busy}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border bg-white dark:bg-[#0F172A] disabled:opacity-50 ${TONE_CLASSES[tone]}`}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : icon}
      {label}
    </button>
  );
}

// -----------------------------------------------------------------------------
// EditDraftForm — textarea + optional note
// -----------------------------------------------------------------------------

function EditDraftForm({
  initialText,
  busy,
  onCancel,
  onSave,
}: {
  initialText: string;
  busy: boolean;
  onCancel: () => void;
  onSave: (newText: string, note: string) => void;
}) {
  const [text, setText] = useState(initialText);
  const [note, setNote] = useState('');
  const valid = text.trim().length > 0;

  return (
    <div data-testid="sotr-edit-draft-form" className="space-y-2">
      <label className="block">
        <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Draft worksheet item text
        </span>
        <textarea
          data-testid="sotr-edit-draft-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          className="mt-1 w-full text-sm rounded-md border border-[#E2E8F0] dark:border-white/10 bg-white dark:bg-[#0F172A] px-2.5 py-1.5 text-fg-body focus:outline-none focus:ring-1 focus:ring-[#017BC8]"
        />
      </label>
      <label className="block">
        <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Reviewer note (optional)
        </span>
        <textarea
          data-testid="sotr-edit-draft-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Why this edit?"
          className="mt-1 w-full text-xs rounded-md border border-[#E2E8F0] dark:border-white/10 bg-white dark:bg-[#0F172A] px-2.5 py-1.5 text-fg-body focus:outline-none focus:ring-1 focus:ring-[#017BC8]"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="sotr-edit-draft-save"
          disabled={!valid || busy}
          onClick={() => onSave(text.trim(), note.trim())}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-500/30 text-emerald-700 dark:text-emerald-300 bg-white dark:bg-[#0F172A] hover:bg-emerald-50 dark:hover:bg-emerald-500/[0.08] disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Save edit
        </button>
        <button
          type="button"
          data-testid="sotr-edit-draft-cancel"
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-[#E2E8F0] dark:border-white/10 text-fg-body bg-white dark:bg-[#0F172A] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// NoteForm — for reject_from_draft and flag_item
// -----------------------------------------------------------------------------

const NOTE_PROMPTS: Record<'reject_from_draft' | 'flag_item', { title: string; placeholder: string; submitLabel: string }> = {
  reject_from_draft: {
    title:        'Reject from Draft',
    placeholder:  'Why does this item not belong in the draft?',
    submitLabel:  'Reject',
  },
  flag_item: {
    title:        'Flag Item',
    placeholder:  'What needs further review?',
    submitLabel:  'Flag',
  },
};

function NoteForm({
  action,
  busy,
  onCancel,
  onSubmit,
}: {
  action: 'reject_from_draft' | 'flag_item';
  busy: boolean;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const cfg = NOTE_PROMPTS[action];
  const [note, setNote] = useState('');

  return (
    <div data-testid={`sotr-note-form-${action}`} className="space-y-2">
      <label className="block">
        <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          {cfg.title} — reviewer note
        </span>
        <textarea
          data-testid={`sotr-note-input-${action}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder={cfg.placeholder}
          className="mt-1 w-full text-xs rounded-md border border-[#E2E8F0] dark:border-white/10 bg-white dark:bg-[#0F172A] px-2.5 py-1.5 text-fg-body focus:outline-none focus:ring-1 focus:ring-[#017BC8]"
        />
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid={`sotr-note-submit-${action}`}
          disabled={busy}
          onClick={() => onSubmit(note.trim())}
          className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-rose-200 dark:border-rose-500/30 text-rose-700 dark:text-rose-300 bg-white dark:bg-[#0F172A] hover:bg-rose-50 dark:hover:bg-rose-500/[0.08] disabled:opacity-50"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          {cfg.submitLabel}
        </button>
        <button
          type="button"
          data-testid={`sotr-note-cancel-${action}`}
          onClick={onCancel}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-[#E2E8F0] dark:border-white/10 text-fg-body bg-white dark:bg-[#0F172A] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
