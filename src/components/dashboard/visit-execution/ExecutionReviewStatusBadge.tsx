import type { ExecutionReviewStatus } from '../../../types/visit-execution';

// =============================================================================
// ExecutionReviewStatusBadge — small status pill for a single execution item.
//
// Semantically distinct from the SOTR ReviewStatusBadge. That tracks
// "is the parser output accurate?". This tracks "is the site coordinator
// ready to execute this requirement at the visit?".
//
// Polish-v2 (2026-05-27) color discipline:
//   Two states earn loud filled chips — `reviewed` (green = done) and
//   `needs_review` (amber = open action). The other three states (default
//   not_reviewed, edited, site_note_added) use text-only treatment so the
//   high-signal pair pops on a busy checklist.
//
// `edited` and `site_note_added` still get a recognizable tone (blue,
// indigo) so coordinators can tell them apart at a glance — just without
// the filled-chip visual weight that competes with the reviewed/needs_review
// pair.
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
  // Open-action: loud filled amber.
  needs_review:    'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
  // Done: loud filled emerald.
  reviewed:        'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  // Secondary states: text-color only — preserves semantic differentiation
  // (blue = edited, indigo = note added) without competing with the filled
  // primary pair.
  edited:          'text-blue-700 dark:text-blue-400 bg-transparent border-transparent',
  site_note_added: 'text-indigo-700 dark:text-indigo-400 bg-transparent border-transparent',
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
