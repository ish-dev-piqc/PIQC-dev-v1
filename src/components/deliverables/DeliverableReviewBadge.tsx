import { useTheme } from '../../context/ThemeContext';
import {
  REVIEW_STATE_LABELS,
  type DeliverableReviewState,
} from '../../types/deliverables';

// =============================================================================
// DeliverableReviewBadge — review-state pill for one deliverable block.
//
// Draft-only vocabulary: the engine has no "approved" state anywhere and this
// badge must never suggest one (labels come from the frozen
// REVIEW_STATE_LABELS map — 'reviewed' means "a human looked", not approval).
//
// Color discipline mirrors the VEW rare-loud convention: exactly two states
// earn filled chips — needs_review (amber = open action, visually alarmed)
// and reviewed (emerald = calm done-signal). Everything else is text-only so
// the actionable pair pops on a dense checklist:
//
//   draft       → muted text (the expected baseline; most rows start here)
//   edited      → brand text (human overlay exists)
//   rejected    → rose text ("Removed" — excluded from render/export, kept in
//                 the DB so regeneration won't resurrect it; packet rows
//                 normally never carry this state since the server filters
//                 them, but the badge supports it for edit-log surfaces)
//   human_added → indigo text (reviewer-authored)
//
// Generic deliverables component: pure presentation, no data access.
// =============================================================================

interface Props {
  state: DeliverableReviewState;
}

export function DeliverableReviewBadge({ state }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const tone = (() => {
    switch (state) {
      case 'draft':
        return 'text-fg-muted bg-transparent border-transparent';
      // Open action: loud filled amber.
      case 'needs_review':
        return isLight
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      // Human looked at it: calm filled emerald.
      case 'reviewed':
        return isLight
          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
          : 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20';
      case 'edited':
        return isLight
          ? 'text-brand-700 bg-transparent border-transparent'
          : 'text-brand-400 bg-transparent border-transparent';
      case 'rejected':
        return isLight
          ? 'text-rose-700 bg-transparent border-transparent'
          : 'text-rose-300 bg-transparent border-transparent';
      case 'human_added':
        return isLight
          ? 'text-indigo-700 bg-transparent border-transparent'
          : 'text-indigo-400 bg-transparent border-transparent';
    }
  })();

  return (
    <span
      data-testid="deliverable-review-badge"
      data-state={state}
      className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${tone}`}
    >
      {REVIEW_STATE_LABELS[state]}
    </span>
  );
}
