import { Clock, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitSnapshot } from '../../../types/visit-execution';

// =============================================================================
// TimingBanner — surfaces visit-level timing constraints as a banner above
// the checklist. Two variants:
//   - Visit window banner (always renders when window is non-zero): blue/info
//   - Hard-constraint warning (when has_safety_critical OR has tight window):
//     amber/warning
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
        : `Day ${studyDay}`;
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

  const baseClass = isLight
    ? 'bg-white border-[#e2e8ee]'
    : 'bg-[#131a22] border-white/5';
  const accentClass = isWarning
    ? isLight
      ? 'bg-amber-50 border-amber-200'
      : 'bg-amber-400/10 border-amber-400/20'
    : isLight
      ? 'bg-blue-50 border-blue-200'
      : 'bg-blue-400/10 border-blue-400/20';

  return (
    <div className="space-y-2">
      <div
        data-testid="vew-timing-banner-window"
        className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${accentClass}`}
        role="note"
      >
        <Clock
          size={14}
          className={`mt-0.5 flex-shrink-0 ${
            isWarning ? 'text-amber-700 dark:text-amber-400' : 'text-blue-700 dark:text-blue-400'
          }`}
          aria-hidden
        />
        <div className="flex-1 min-w-0">
          <p className={`text-[10px] uppercase tracking-wider font-semibold ${
            isWarning ? 'text-amber-800 dark:text-amber-300' : 'text-blue-800 dark:text-blue-300'
          }`}>
            Visit window
          </p>
          <p className={`text-sm font-medium mt-0.5 ${
            isWarning ? 'text-amber-900 dark:text-amber-200' : 'text-blue-900 dark:text-blue-200'
          }`}>
            {formatWindow(snapshot.window_minus_days, snapshot.window_plus_days, snapshot.study_day)}
          </p>
        </div>
      </div>

      {snapshot.has_safety_critical && (
        <div
          data-testid="vew-timing-banner-safety"
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${
            isLight ? 'bg-rose-50 border-rose-200' : 'bg-rose-400/10 border-rose-400/20'
          }`}
          role="alert"
        >
          <AlertTriangle
            size={14}
            className="mt-0.5 flex-shrink-0 text-rose-700 dark:text-rose-400"
            aria-hidden
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-rose-800 dark:text-rose-300">
              Safety-critical items at this visit
            </p>
            <p className="text-sm font-medium mt-0.5 text-rose-900 dark:text-rose-200">
              Vital sign and AE timing windows must be met. See item-level timing on the checklist.
            </p>
          </div>
        </div>
      )}

      <p className={`text-fg-muted text-[11px] leading-relaxed ${baseClass.includes('hidden') ? 'hidden' : ''}`}>
        Windows shown are from the protocol. Final execution timing is
        confirmed against the participant's anchor date in the calendar.
      </p>
    </div>
  );
}
