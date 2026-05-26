import type { ExecutionReviewStatus } from '../../../types/visit-execution';

// =============================================================================
// ExecutionReviewStatusBadge — small status pill for a single execution item.
//
// Semantically distinct from the SOTR ReviewStatusBadge. That tracks
// "is the parser output accurate?". This tracks "is the site coordinator
// ready to execute this requirement at the visit?".
//
// The 'not_reviewed' tone is intentionally muted (transparent) so it doesn't
// shout on every untouched row. Only colored states earn visual weight.
// =============================================================================

interface Props {
  status: ExecutionReviewStatus;
  size?: 'sm' | 'md';
}

const LABELS: Record<ExecutionReviewStatus, string> = {
  not_reviewed:    'Not Reviewed',
  needs_review:    'Needs Review',
  reviewed:        'Reviewed',
  edited:          'Edited',
  site_note_added: 'Note Added',
};

const TONES: Record<ExecutionReviewStatus, string> = {
  not_reviewed:    'text-fg-muted bg-transparent border-transparent',
  needs_review:    'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
  reviewed:        'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  edited:          'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20',
  site_note_added: 'text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-400/10 dark:border-indigo-400/20',
};

export default function ExecutionReviewStatusBadge({ status, size = 'sm' }: Props) {
  const sizing = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      data-testid="vew-review-status-badge"
      data-status={status}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border ${sizing} ${TONES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

export { LABELS as EXECUTION_REVIEW_STATUS_LABELS };
