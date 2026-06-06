import { Bell, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';

// =============================================================================
// TodayFreshnessBanner — slim "N new since you opened this tab" notification.
//
// Stateless. TodayTab owns the baseline snapshot + delta count. Renders
// nothing when both deltas are 0.
// =============================================================================

interface TodayFreshnessBannerProps {
  newVisitCount: number;
  newParticipantCount: number;
  onDismiss: () => void;
}

function pluralize(n: number, single: string, plural: string): string {
  return `${n} ${n === 1 ? single : plural}`;
}

export default function TodayFreshnessBanner({
  newVisitCount,
  newParticipantCount,
  onDismiss,
}: TodayFreshnessBannerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (newVisitCount === 0 && newParticipantCount === 0) return null;

  const fragments: string[] = [];
  if (newVisitCount > 0) {
    fragments.push(pluralize(newVisitCount, 'new visit', 'new visits'));
  }
  if (newParticipantCount > 0) {
    fragments.push(
      pluralize(newParticipantCount, 'new participant', 'new participants'),
    );
  }
  // Two-fragment case joins with "and"; one-fragment case is unchanged.
  const message =
    fragments.length === 2 ? fragments.join(' and ') : fragments[0];

  return (
    <div
      className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-xs ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-amber-500/[0.08] border-amber-500/30 text-amber-300'
      }`}
      role="status"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Bell size={12} className="flex-shrink-0" />
        <span className="truncate">
          <strong className="font-semibold">{message}</strong> since you opened
          this tab.
        </span>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className={`flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded ${
          isLight
            ? 'hover:bg-amber-100 text-amber-800'
            : 'hover:bg-amber-500/[0.12] text-amber-300'
        }`}
        aria-label="Dismiss freshness banner"
      >
        Dismiss
        <X size={11} />
      </button>
    </div>
  );
}
