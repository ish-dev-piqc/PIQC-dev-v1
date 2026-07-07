import { Filter, CalendarDays } from 'lucide-react';
import type { ViewMode } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Calendar empty state
// ────────────────────────────────────────────────────────────────────────────

export interface CalendarEmptyBannerProps {
  isLight: boolean;
  view: ViewMode;
  filtered: boolean;
  hiddenCount: number;
  onClearFilters: () => void;
  // A3: when the active protocol's document is still parsing (or failed to
  // parse), the calendar being empty isn't the user's fault — swap the
  // "add a participant" nudge for a parsing-aware message. null/undefined =
  // no relevant document status (or home/all-protocols scope).
  docStatus?: 'pending' | 'failed' | null;
}

// Compact banner that sits above the still-rendered calendar grid when there
// are no visible visits in the current range. Distinguishes between "nothing
// scheduled at all" and "everything hidden by filters" so the user can
// either pick a participant or clear filters without losing the grid view.
export function CalendarEmptyBanner({
  isLight,
  view,
  filtered,
  hiddenCount,
  onClearFilters,
  docStatus,
}: CalendarEmptyBannerProps) {
  const subColor = 'text-fg-sub';

  const emptyMessage =
    docStatus === 'pending'
      ? "Your protocol is still parsing — visits will appear once it's ready."
      : docStatus === 'failed'
      ? 'Parsing failed — check the Protocol panel.'
      : `No visits scheduled this ${view}. Add a participant or schedule a visit to populate the calendar.`;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b text-xs ${
        isLight
          ? 'bg-[#F8FAFC] border-[#E2E8F0]'
          : 'bg-white/[0.02] border-white/5'
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        {filtered ? (
          <Filter size={13} className="flex-shrink-0 text-fg-muted" />
        ) : (
          <CalendarDays size={13} className="flex-shrink-0 text-fg-muted" />
        )}
        <span className={`${subColor} truncate`}>
          {filtered
            ? `${hiddenCount} ${hiddenCount === 1 ? 'visit is' : 'visits are'} hidden this ${view} — pick a participant in the filter panel to see their visits.`
            : emptyMessage}
        </span>
      </div>
      {filtered && (
        <button
          type="button"
          onClick={onClearFilters}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-medium border ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F2F2F2]'
              : 'bg-[#0F172A] border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
          }`}
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
