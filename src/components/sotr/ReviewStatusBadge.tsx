import type { DraftReviewStatus } from '../../types/sotr';

// Small status pill mirroring ConfidenceBadge's tone palette. Only renders
// when the status is something other than 'draft' (the default) — avoids
// visual noise on items the reviewer hasn't touched yet.

interface Props {
  status: DraftReviewStatus | undefined;
}

const LABELS: Record<DraftReviewStatus, string> = {
  draft:              'Draft',
  accepted_for_draft: 'Accepted for Draft',
  edited:             'Edited',
  rejected_from_draft:'Rejected from Draft',
  flagged:            'Flagged',
};

const TONES: Record<DraftReviewStatus, string> = {
  draft:              'text-fg-muted bg-transparent border-transparent',
  accepted_for_draft: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  edited:             'text-blue-700 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20',
  rejected_from_draft:'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
  flagged:            'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
};

export default function ReviewStatusBadge({ status }: Props) {
  if (!status || status === 'draft') return null;
  return (
    <span
      data-testid="sotr-review-status-badge"
      data-status={status}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${TONES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}

export { LABELS as REVIEW_STATUS_LABELS };
