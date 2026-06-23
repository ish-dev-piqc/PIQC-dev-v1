// =============================================================================
// CohortBadge — Slice 2 (cohort applicability).
//
// Small chip showing a study cohort/arm a visit applies to (e.g. "SAD", "MAD",
// "S4"). Rendered on the snapshot card (and navigator rows) only when a visit's
// applies_to is non-null. Informational tone (indigo) — distinct from the
// amber/emerald review-status pair and the classification badges. Pure
// presentational; styling mirrors ExecutionReviewStatusBadge.
// =============================================================================

interface Props {
  label: string;
  size?: 'sm' | 'md';
}

export default function CohortBadge({ label, size = 'sm' }: Props) {
  const sizing = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      data-testid="vew-cohort-badge"
      data-cohort={label}
      title={`This visit applies to the ${label} cohort`}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border ${sizing} text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-400 dark:bg-indigo-400/10 dark:border-indigo-400/20`}
    >
      {label}
    </span>
  );
}
