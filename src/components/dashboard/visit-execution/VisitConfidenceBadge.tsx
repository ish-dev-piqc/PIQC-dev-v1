import { Sparkles, Info, AlertTriangle, AlertOctagon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitConfidenceState } from '../../../types/visit-execution';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_TOOLTIPS,
} from '../../../lib/visit-execution/deriveVisitConfidence';

// =============================================================================
// VisitConfidenceBadge — Sprint 7.
//
// Renders a confidence chip in one of three sizes/treatments:
//
//   variant='chip'  → standard chip for the snapshot card's attention-chip
//                     row. Polish-v2 discipline: filled chip ONLY for
//                     rare-loud states ('low' / 'needs_review'). Text-only
//                     for 'high' / 'medium' so the snapshot card doesn't
//                     shout on the expected-baseline case.
//
//   variant='dot'   → compact 6px circle for the VisitNavigator left of the
//                     visit name. Always visible (triage surface — even a
//                     green dot is positive signal worth showing).
//
//   variant='inline' → small filled chip for the ExecutionChecklist row,
//                     only renders for 'low' / 'needs_review' per the
//                     polish-v2 "alarm states earn pixels" rule.
//
// Hover tooltip (title attr) carries the actionable copy from
// CONFIDENCE_TOOLTIPS — coordinator learns WHAT to do, not just the label.
//
// VEW-namespaced. SOTR's old ConfidenceBadge was removed in post-#106
// cleanup; mode isolation forbids cross-mode imports regardless.
// =============================================================================

export type VisitConfidenceBadgeVariant = 'chip' | 'dot' | 'inline';

interface Props {
  confidence: VisitConfidenceState;
  variant: VisitConfidenceBadgeVariant;
  /**
   * Optional override for `title` tooltip. Default uses CONFIDENCE_TOOLTIPS.
   * Pass a more-specific phrasing when the badge represents per-item rather
   * than per-visit confidence ("PIQC is low-confidence on THIS requirement").
   */
  titleOverride?: string;
}

/**
 * Per-variant null-render rules. Centralized so the discipline lives in one
 * place — if Sprint 7.5 wants to surface 'high' chips on the snapshot, only
 * this function changes.
 */
function shouldRender(
  confidence: VisitConfidenceState,
  variant: VisitConfidenceBadgeVariant,
): boolean {
  if (variant === 'dot') return true; // navigator triage — always show
  if (variant === 'inline') {
    return confidence === 'low' || confidence === 'needs_review';
  }
  // variant === 'chip'
  return confidence !== 'high'; // hide on the expected baseline
}

export default function VisitConfidenceBadge({
  confidence,
  variant,
  titleOverride,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (!shouldRender(confidence, variant)) return null;

  const tooltip = titleOverride ?? CONFIDENCE_TOOLTIPS[confidence];
  const label = CONFIDENCE_LABELS[confidence];

  if (variant === 'dot') {
    // Polish-v2 palette: emerald = good baseline, blue = informational,
    // amber = caution, rose = alarm. Same tone family as the workspace's
    // review-status badges so the language is consistent.
    const dotClass = (() => {
      switch (confidence) {
        case 'high':
          return isLight ? 'bg-emerald-500' : 'bg-emerald-400';
        case 'medium':
          return isLight ? 'bg-brand-500' : 'bg-brand-400';
        case 'low':
          return isLight ? 'bg-amber-500' : 'bg-amber-400';
        case 'needs_review':
          return isLight ? 'bg-rose-500' : 'bg-rose-400';
      }
    })();
    return (
      <span
        title={tooltip}
        aria-label={label}
        data-testid="vew-confidence-dot"
        data-confidence={confidence}
        className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotClass}`}
      />
    );
  }

  // 'chip' and 'inline' variants share the chip shape; visibility differs
  // (controlled by shouldRender above). Tone follows the workspace's
  // existing rare-loud convention: emerald/blue text-only for the calm
  // states, amber/rose filled chips for the alarms.
  const toneClass = (() => {
    switch (confidence) {
      case 'high':
        return 'text-emerald-700 dark:text-emerald-400 bg-transparent border-transparent';
      case 'medium':
        return 'text-brand-700 dark:text-brand-400 bg-transparent border-transparent';
      case 'low':
        return isLight
          ? 'text-amber-700 bg-amber-50 border-amber-200'
          : 'text-amber-400 bg-amber-400/10 border-amber-400/20';
      case 'needs_review':
        return isLight
          ? 'text-rose-700 bg-rose-50 border-rose-200'
          : 'text-rose-400 bg-rose-400/10 border-rose-400/20';
    }
  })();

  const Icon = (() => {
    switch (confidence) {
      // 'high' chip never renders (shouldRender hides it) — defensive fallback.
      case 'high':         return Sparkles;
      // 'medium' uses Info (NOT Sparkles): Sparkles is already the
      // "PIQC drafted" attribution anchor at the top of the snapshot card.
      // Reusing Sparkles for medium-confidence would create visual confusion
      // — two sparkles in one card meaning two different things.
      case 'medium':       return Info;
      case 'low':          return AlertTriangle;
      case 'needs_review': return AlertOctagon;
    }
  })();

  return (
    <span
      title={tooltip}
      aria-label={label}
      data-testid="vew-confidence-chip"
      data-confidence={confidence}
      data-variant={variant}
      className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${toneClass}`}
    >
      <Icon size={10} aria-hidden />
      <span>{label}</span>
    </span>
  );
}
