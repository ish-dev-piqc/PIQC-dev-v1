import { useState } from 'react';
import { Flag, Loader2, Check, X } from 'lucide-react';
import { createReviewEvent } from '../../lib/sotr/reviewApi';
import type { CreateReviewEventResult } from '../../types/sotr';

// =============================================================================
// FlagSourceButton — per-source action.
//
// Flags the citation, not the item. By the spec, flag_source creates a
// review event but does NOT change the worksheet item's review status.
// Inline note prompt; click → submit → render quiet "Source flagged" state.
// =============================================================================

interface Props {
  studyId: string;
  worksheetItemId: string;
  sourceId: string;
  onFlagged?: (result: CreateReviewEventResult) => void;
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'noting' }
  | { kind: 'submitting' }
  | { kind: 'flagged' }
  | { kind: 'error'; message: string };

export default function FlagSourceButton({
  studyId,
  worksheetItemId,
  sourceId,
  onFlagged,
}: Props) {
  const [mode, setMode] = useState<Mode>({ kind: 'idle' });
  const [note, setNote] = useState('');

  async function submit() {
    setMode({ kind: 'submitting' });
    try {
      const result = await createReviewEvent(studyId, worksheetItemId, {
        action: 'flag_source',
        reviewer_note: note.trim() || undefined,
        source_evidence_record_ids: [sourceId],
      });
      setMode({ kind: 'flagged' });
      onFlagged?.(result);
    } catch {
      setMode({
        kind: 'error',
        message: 'Could not flag this source. Please try again.',
      });
    }
  }

  if (mode.kind === 'flagged') {
    return (
      <p
        data-testid="sotr-flag-source-flagged"
        className="text-[11px] text-amber-700 dark:text-amber-300 inline-flex items-center gap-1"
      >
        <Flag size={11} /> Source flagged for review.
      </p>
    );
  }

  if (mode.kind === 'noting' || mode.kind === 'submitting') {
    const busy = mode.kind === 'submitting';
    return (
      <div data-testid="sotr-flag-source-form" className="space-y-1.5">
        <textarea
          data-testid="sotr-flag-source-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What's wrong with this citation?"
          className="w-full text-xs rounded-md border border-[#E2E8F0] dark:border-white/10 bg-white dark:bg-[#0F172A] px-2.5 py-1.5 text-fg-body focus:outline-none focus:ring-1 focus:ring-brand-600"
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="sotr-flag-source-submit"
            disabled={busy}
            onClick={submit}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 bg-white dark:bg-[#0F172A] hover:bg-amber-50 dark:hover:bg-amber-500/[0.08] disabled:opacity-50"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Flag source
          </button>
          <button
            type="button"
            data-testid="sotr-flag-source-cancel"
            onClick={() => setMode({ kind: 'idle' })}
            disabled={busy}
            className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-[#E2E8F0] dark:border-white/10 text-fg-body bg-white dark:bg-[#0F172A] hover:bg-[#F8FAFC] dark:hover:bg-white/[0.04] disabled:opacity-50"
          >
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="sotr-flag-source-button"
        onClick={() => setMode({ kind: 'noting' })}
        className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-amber-200 dark:border-amber-500/30 text-amber-700 dark:text-amber-300 bg-white dark:bg-[#0F172A] hover:bg-amber-50 dark:hover:bg-amber-500/[0.08]"
      >
        <Flag size={11} />
        Flag Source
      </button>
      {mode.kind === 'error' && (
        <p
          data-testid="sotr-flag-source-error"
          role="alert"
          className="text-[11px] text-rose-700 dark:text-rose-300"
        >
          {mode.message}
        </p>
      )}
    </div>
  );
}
