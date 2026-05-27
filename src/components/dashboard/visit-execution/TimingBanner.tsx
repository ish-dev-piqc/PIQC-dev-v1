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
// Tone selection:
//   - Tight window (0/0) or safety-critical present → amber accent
//   - Otherwise                                       → quiet info accent
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
  const isWarning = snapshot.has_safety_critical || isTight;

  // Polish-v2: a single consolidated surface. Tone shifts when warning;
  // safety sub-row appears nested rather than as a separate banner so the
  // user reads "this visit's timing" as one thing, with sub-detail.
  const accentClass = isWarning
    ? isLight
      ? 'bg-amber-50 border-amber-200'
      : 'bg-amber-400/10 border-amber-400/20'
    : isLight
      ? 'bg-blue-50 border-blue-200'
      : 'bg-blue-400/10 border-blue-400/20';

  const iconTone = isWarning
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-blue-700 dark:text-blue-400';

  const labelTone = isWarning
    ? 'text-amber-800 dark:text-amber-300'
    : 'text-blue-800 dark:text-blue-300';

  const valueTone = isWarning
    ? 'text-amber-900 dark:text-amber-200'
    : 'text-blue-900 dark:text-blue-200';

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

      {snapshot.has_safety_critical && (
        <div
          data-testid="vew-timing-banner-safety"
          className="flex items-start gap-3 mt-2.5 pt-2.5 border-t border-amber-300/40 dark:border-amber-400/20"
        >
          <AlertTriangle
            size={13}
            className="mt-0.5 flex-shrink-0 text-rose-700 dark:text-rose-400"
            aria-hidden
          />
          <p className="text-rose-900 dark:text-rose-200 text-xs leading-relaxed">
            Safety-critical items at this visit. Vital sign and AE timing
            windows must be met — see item-level timing on the checklist.
          </p>
        </div>
      )}
    </div>
  );
}
