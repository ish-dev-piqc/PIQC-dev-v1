import { getProtocolColorsById } from '../../../lib/site/protocolColors';
import {
  formatYmd,
  startOfWeek,
  startOfMonth,
  addDays,
  isSameDay,
  isSameMonth,
  isPast,
} from '../../../lib/site/dateUtils';
import type { ViewProps } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Month view
// ────────────────────────────────────────────────────────────────────────────

export function MonthView({ isLight, isHome, anchorDate, today, visitsByDate, protocols, onVisitClick, onDayClick }: ViewProps) {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const headerBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const headerText = 'text-fg-label';
  const dayBorder = isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]';
  const todayTint = isLight ? 'bg-brand-600/[0.04]' : 'bg-brand-300/[0.04]';
  const numberColor = 'text-fg-heading';
  const todayNumber = isLight ? 'bg-brand-600 text-white' : 'bg-brand-300 text-[#0F172A]';
  const outsideMonth = isLight ? 'text-[#334155]/25' : 'text-[#CBD5E1]/20';
  const mutedColor = 'text-fg-muted';

  const weekdayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className={`grid grid-cols-7 border-b ${dayBorder} ${headerBg} flex-shrink-0`}>
        {weekdayHeaders.map((w) => (
          <div key={w} className={`py-2 text-center border-r last:border-r-0 ${dayBorder}`}>
            <div className={`text-[10px] uppercase tracking-wider font-semibold ${headerText}`}>{w}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 grid-rows-6 flex-1 min-h-0">
        {days.map((d) => {
          const key = formatYmd(d);
          const dayVisits = visitsByDate.get(key) ?? [];
          const isToday = isSameDay(d, today);
          const inMonth = isSameMonth(d, monthStart);
          const past = isPast(d, today);
          const colors = dayVisits[0] ? getProtocolColorsById(dayVisits[0].protocolId, protocols) : undefined;

          return (
            <div
              key={key}
              className={`border-r border-b last:border-r-0 ${dayBorder} flex flex-col min-h-0 ${
                isToday ? todayTint : ''
              } ${past ? 'opacity-85' : ''}`}
            >
              <button
                type="button"
                onClick={() => onDayClick(d)}
                className="px-2 pt-1.5 pb-0.5 flex items-center justify-between w-full hover:opacity-80 transition-opacity"
              >
                <span
                  className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                    isToday ? todayNumber : inMonth ? numberColor : outsideMonth
                  }`}
                >
                  {d.getDate()}
                </span>
                {dayVisits.length > 0 && colors && (
                  <span
                    className={`text-[10px] font-semibold px-1.5 rounded ${
                      isLight ? colors.chipLight : colors.chipDark
                    } border`}
                  >
                    {dayVisits.length}
                  </span>
                )}
              </button>
              <div className="px-1 pb-1 space-y-0.5 overflow-hidden">
                {dayVisits.slice(0, 2).map((v) => {
                  const c = getProtocolColorsById(v.protocolId, protocols);
                  const accent = isLight ? c.accentLight : c.accentDark;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onVisitClick(v);
                      }}
                      className={`w-full text-left border-l-2 ${accent} px-1 text-[10px] truncate hover:opacity-75 ${
                        isLight ? 'text-[#0F172A]' : 'text-[#CBD5E1]'
                      }`}
                    >
                      {v.time && <span className="font-semibold mr-1">{v.time.replace(':00', '')}</span>}
                      {v.participantId}
                    </button>
                  );
                })}
                {dayVisits.length > 2 && (
                  <button
                    type="button"
                    onClick={() => onDayClick(d)}
                    className={`text-[10px] ${mutedColor} hover:underline px-1`}
                  >
                    +{dayVisits.length - 2} more
                  </button>
                )}
                {dayVisits.length === 0 && inMonth && !past && (
                  <span className={`text-[10px] ${mutedColor} italic px-1 block truncate`}>
                    {/* Empty placeholder kept subtle to avoid clutter */}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {/* Hint */}
      {isHome && (
        <div className={`px-4 py-2 text-[11px] border-t ${dayBorder} ${mutedColor} flex-shrink-0`}>
          Click a day for the full list. Empty days have nothing scheduled.
        </div>
      )}
    </div>
  );
}
