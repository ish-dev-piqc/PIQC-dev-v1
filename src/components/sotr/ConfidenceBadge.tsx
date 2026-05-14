import type { ConfidenceState } from '../../types/sotr';

// Small status pill for worksheet-item confidence.
// Tone palette mirrors ParticipantProfileDrawer's STATUS_TONE pattern.

interface Props {
  state: ConfidenceState;
  /** Compact variant (drops "Confidence:" prefix). Defaults to compact. */
  size?: 'sm' | 'md';
}

const LABELS: Record<ConfidenceState, string> = {
  high:         'High',
  medium:       'Medium',
  low:          'Low',
  needs_review: 'Needs Review',
};

const TONES: Record<ConfidenceState, string> = {
  high:         'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  medium:       'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20',
  low:          'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
  needs_review: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
};

export default function ConfidenceBadge({ state, size = 'sm' }: Props) {
  const sizing = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      data-testid="sotr-confidence-badge"
      data-state={state}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border ${sizing} ${TONES[state]}`}
    >
      {LABELS[state]}
    </span>
  );
}

export { LABELS as CONFIDENCE_LABELS };
