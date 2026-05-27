import { Clock, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitSnapshot } from '../../../types/visit-execution';

// =============================================================================
// TimingBanner — surfaces visit-level timing constraints above the checklist.
//
// Polish-v2 (2026-05-27) per feedback_vew_cognitive_load_test.md:
//   The previous version stacked two banners (window + safety) plus a
//   footer caption — three visual weights compete with each other on a
//   surface that only needs one signal. Polish consolidates into a single
//   banner with an optional safety sub-row, and the footer caption is
//   dropped (the "windows are confirmed at execution" reality is implicit
//   in the planning context).
//
// Three-tier severity ladder (the more urgent classification dominates the
// whole surface; no mixing of warning colors on one banner):
//   - has_safety_critical              → rose  (highest urgency)
//   - tight window (0/0) only          → amber (medium)
//   - otherwise                        → blue  (informational default)
//
// data-testid history: the per-banner ids `vew-timing-banner-window` +
// `vew-timing-banner-safety` were collapsed into a single root id
// `vew-timing-banner` (Polish-v2) since the two surfaces are now one DOM
// container. The safety sub-row keeps its own id for tests that need to
// assert presence of the sub-row specifically.
//
// Per-assessment timing (AssessmentTimingConstraint) is rendered inline
// on the checklist row, not here.
// =============================================================================

interface Props {
  snapshot: VisitSnapshot;
}

function formatWindow(minus: number, plus: number, studyDay: number): string {
  const dayLabel =
    studyDay < 0
      ? `Day ${studyDay}`
      : studyDay === 0
        ? 'Day 0'
        : `Day +${studyDay}`;
  if (minus === 0 && plus === 0) {
    return `${dayLabel} — fixed (no permissible window)`;
  }
  if (minus === plus) {
    return `${dayLabel} ± ${plus} day${plus === 1 ? '' : 's'}`;
  }
  return `${dayLabel} (−${minus} / +${plus} days)`;
}

export default function TimingBanner({ snapshot }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const isTight = snapshot.window_minus_days === 0 && snapshot.window_plus_days === 0;
  const isSafety = snapshot.has_safety_critical;

  // Three-tier severity (see header doc): rose wins on safety; amber for
  // tight-window-only; blue otherwise. The more urgent classification
  // dominates the whole surface — no mixed warning colors.
  const tone: 'blue' | 'amber' | 'rose' = isSafety ? 'rose' : isTight ? 'amber' : 'blue';

  const accentClass = (() => {
    if (tone === 'rose') {
      return isLight
        ? 'bg-rose-50 border-rose-200'
        : 'bg-rose-400/10 border-rose-400/20';
    }
    if (tone === 'amber') {
      return isLight
        ? 'bg-amber-50 border-amber-200'
        : 'bg-amber-400/10 border-amber-400/20';
    }
    return isLight
      ? 'bg-blue-50 border-blue-200'
      : 'bg-blue-400/10 border-blue-400/20';
  })();

  const iconTone = (() => {
    if (tone === 'rose') return 'text-rose-700 dark:text-rose-400';
    if (tone === 'amber') return 'text-amber-700 dark:text-amber-400';
    return 'text-blue-700 dark:text-blue-400';
  })();

  const labelTone = (() => {
    if (tone === 'rose') return 'text-rose-800 dark:text-rose-300';
    if (tone === 'amber') return 'text-amber-800 dark:text-amber-300';
    return 'text-blue-800 dark:text-blue-300';
  })();

  const valueTone = (() => {
    if (tone === 'rose') return 'text-rose-900 dark:text-rose-200';
    if (tone === 'amber') return 'text-amber-900 dark:text-amber-200';
    return 'text-blue-900 dark:text-blue-200';
  })();

  const subRowBorder = tone === 'rose'
    ? 'border-rose-300/40 dark:border-rose-400/20'
    : 'border-amber-300/40 dark:border-amber-400/20';

  return (
    <div
      data-testid="vew-timing-banner"
      className={`rounded-lg border px-4 py-3 ${accentClass}`}
      role={snapshot.has_safety_critical ? 'alert' : 'note'}
    >
      <div className="flex items-start gap-3">
        <Clock size={14} className={`mt-0.5 flex-shrink-0 ${iconTone}`} aria-hidden />
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-wider font-semibold ${labelTone}`}>
            Visit window
          </p>
          <p className={`text-sm font-medium mt-0.5 ${valueTone}`}>
            {formatWindow(snapshot.window_minus_days, snapshot.window_plus_days, snapshot.study_day)}
          </p>
        </div>
      </div>

      {isSafety && (
        <div
          data-testid="vew-timing-banner-safety"
          className={`flex items-start gap-3 mt-2.5 pt-2.5 border-t ${subRowBorder}`}
        >
          <AlertTriangle
            size={13}
            className={`mt-0.5 flex-shrink-0 ${iconTone}`}
            aria-hidden
          />
          <p className={`text-xs leading-relaxed ${valueTone}`}>
            Safety-critical items at this visit. Vital sign and AE timing
            windows must be met — see item-level timing on the checklist.
          </p>
        </div>
      )}
    </div>
  );
}
