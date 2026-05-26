import type { ItemClassification } from '../../../types/visit-execution';

// =============================================================================
// ExecutionItemClassificationBadge — required / conditional / endpoint /
// safety_critical / etc. The most visually loud badge in the workspace —
// safety_critical earns a ⚠ prefix and bold rose tone so it stands out
// even at-a-glance, and the prefix is the a11y-safe differentiator from
// primary_endpoint (which is also rose-toned).
//
// Rebuilt inline because ConfidenceBadge (the canonical reference pattern)
// was removed from main during the post-#106 cleanup. The LABELS/TONES
// shape mirrors what ConfidenceBadge used.
// =============================================================================

interface Props {
  classification: ItemClassification;
  size?: 'sm' | 'md';
}

const LABELS: Record<ItemClassification, string> = {
  required:            'Required',
  conditional:         'Conditional',
  if_applicable:       'If Applicable',
  primary_endpoint:    'Primary Endpoint',
  secondary_endpoint:  'Secondary Endpoint',
  safety_critical:     '⚠ Safety Critical',
};

const TONES: Record<ItemClassification, string> = {
  required:           'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  conditional:        'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-400/10 dark:border-amber-400/20',
  if_applicable:      'text-fg-muted bg-transparent border-transparent',
  primary_endpoint:   'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
  secondary_endpoint: 'text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-400/10 dark:border-orange-400/20',
  safety_critical:    'text-rose-800 bg-rose-100 border-rose-300 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-400/30 font-bold',
};

export default function ExecutionItemClassificationBadge({ classification, size = 'sm' }: Props) {
  const sizing = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5';
  return (
    <span
      data-testid="vew-classification-badge"
      data-classification={classification}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border ${sizing} ${TONES[classification]}`}
    >
      {LABELS[classification]}
    </span>
  );
}

export { LABELS as ITEM_CLASSIFICATION_LABELS };
