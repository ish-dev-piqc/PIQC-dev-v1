import type { ItemClassification } from '../../../types/visit-execution';

// =============================================================================
// ExecutionItemClassificationBadge — required / conditional / endpoint /
// safety_critical / etc.
//
// Polish-v2 (2026-05-27) color discipline:
//   Only safety_critical and primary_endpoint earn loud filled chips.
//   Everything else (the common cases — most rows are 'required') uses a
//   muted text-only treatment so the rare-loud states actually stand out.
//   Per feedback_vew_cognitive_load_test.md: "every chip a different tone
//   makes nothing pop."
//
// safety_critical keeps the ⚠ prefix so it's distinguishable from
// primary_endpoint at a glance even before color hits the eye (a11y).
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
  // Required is the default case on most rows — quiet text-color only.
  required:           'text-fg-sub bg-transparent border-transparent',
  // Conditional carries protocol-branching meaning — text-only amber so
  // it whispers, but the actual rule callout below the row carries weight.
  conditional:        'text-amber-700 dark:text-amber-400 bg-transparent border-transparent',
  if_applicable:      'text-fg-muted bg-transparent border-transparent',
  // Primary endpoint: loud filled rose. Clinical weight is high.
  primary_endpoint:   'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
  // Secondary endpoint: medium — text-only rose to share the visual family
  // with primary_endpoint without competing for attention with it.
  secondary_endpoint: 'text-rose-700 dark:text-rose-400 bg-transparent border-transparent',
  // Safety critical: the loudest chip. ⚠ prefix + filled deep rose + bold.
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
