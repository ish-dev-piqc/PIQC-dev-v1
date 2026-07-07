import HeatIndicator from '../../heatmap/HeatIndicator';
import { scoreVisit } from '../../../lib/heatmap';
import { getProtocolColorsById } from '../../../lib/site/protocolColors';
import type { SiteVisit } from '../../../lib/site/types';
import {
  formatYmd,
  startOfWeek,
  addDays,
  isSameDay,
  isPast,
} from '../../../lib/site/dateUtils';
import { statusIcon, protoCode } from './todayCalendarShared';
import type { ViewProps } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Week view
// ────────────────────────────────────────────────────────────────────────────

export function WeekView({ isLight, isHome, anchorDate, today, visitsByDate, protocols, onVisitClick, onDayClick }: ViewProps) {
  const start = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const headerBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const headerText = 'text-fg-label';
  const dayBorder = isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]';
  const todayTint = isLight ? 'bg-brand-600/[0.04]' : 'bg-brand-300/[0.04]';
  const numberColor = 'text-fg-heading';
  const todayNumber = isLight ? 'bg-brand-600 text-white' : 'bg-brand-300 text-[#0F172A]';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Mobile (below sm:): vertical stack of day cards */}
      <div className="sm:hidden flex-1 overflow-y-auto p-3 space-y-2">
        {days.map((d) => {
          const key = formatYmd(d);
          const dayVisits = visitsByDate.get(key) ?? [];
          const isToday = isSameDay(d, today);
          const past = isPast(d, today);
          return (
            <div
              key={key}
              className={`${cardBg} border rounded-lg ${isToday ? todayTint : ''} ${past ? 'opacity-80' : ''}`}
            >
              <button
                type="button"
                onClick={() => onDayClick(d)}
                className={`w-full flex items-center gap-3 px-3 py-2 hover:opacity-80 transition-opacity ${dayVisits.length > 0 ? `border-b ${dayBorder}` : ''}`}
              >
                <span
                  className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold flex-shrink-0 ${
                    isToday ? todayNumber : numberColor
                  }`}
                >
                  {d.getDate()}
                </span>
                <span className={`text-xs font-medium ${headerText} flex-1 text-left`}>
                  {d.toLocaleDateString('en-US', { weekday: 'long' })}
                </span>
                {dayVisits.length > 0 ? (
                  <span className={`text-[11px] font-medium ${headerText}`}>
                    {dayVisits.length} {dayVisits.length === 1 ? 'visit' : 'visits'}
                  </span>
                ) : (
                  <span className={`text-[11px] italic ${headerText}`}>Nothing scheduled</span>
                )}
              </button>
              {dayVisits.length > 0 && (
                <div className="px-2 py-2 space-y-1">
                  {dayVisits.map((v) => (
                    <WeekVisitRow
                      key={v.id}
                      visit={v}
                      isLight={isLight}
                      isHome={isHome}
                      past={past}
                      protocols={protocols}
                      onClick={() => onVisitClick(v)}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* sm: and above — original 7-column grid */}
      <div className="hidden sm:flex sm:flex-col flex-1 min-h-0">
        {/* Weekday headers */}
        <div className={`grid grid-cols-7 border-b ${dayBorder} ${headerBg} flex-shrink-0`}>
          {days.map((d) => (
            <div key={d.toISOString()} className={`py-2 text-center border-r last:border-r-0 ${dayBorder}`}>
              <div className={`text-[10px] uppercase tracking-wider font-semibold ${headerText}`}>
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </div>
            </div>
          ))}
        </div>

        {/* Day columns */}
        <div className="grid grid-cols-7 flex-1 min-h-0">
          {days.map((d) => {
            const key = formatYmd(d);
            const dayVisits = visitsByDate.get(key) ?? [];
            const isToday = isSameDay(d, today);
            const past = isPast(d, today);

            return (
              <div
                key={key}
                className={`border-r last:border-r-0 ${dayBorder} flex flex-col min-h-0 ${
                  isToday ? todayTint : ''
                } ${past ? 'opacity-80' : ''}`}
              >
                <button
                  type="button"
                  onClick={() => onDayClick(d)}
                  className="px-2 pt-2 pb-1 flex items-center justify-between w-full hover:opacity-80 transition-opacity"
                >
                  <span
                    className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${
                      isToday ? todayNumber : numberColor
                    }`}
                  >
                    {d.getDate()}
                  </span>
                  {dayVisits.length > 0 && (
                    <span className={`text-[10px] font-medium ${headerText}`}>{dayVisits.length}</span>
                  )}
                </button>
                <div className="px-1.5 pb-2 space-y-1 overflow-hidden">
                  {dayVisits.slice(0, 3).map((v) => (
                    <WeekVisitRow
                      key={v.id}
                      visit={v}
                      isLight={isLight}
                      isHome={isHome}
                      past={past}
                      protocols={protocols}
                      onClick={() => onVisitClick(v)}
                      compact
                    />
                  ))}
                  {dayVisits.length > 3 && (
                    <button
                      type="button"
                      onClick={() => onDayClick(d)}
                      className={`w-full text-left text-[10px] font-medium px-1.5 py-1 rounded hover:underline ${headerText}`}
                    >
                      +{dayVisits.length - 3} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export interface WeekVisitRowProps {
  visit: SiteVisit;
  isLight: boolean;
  isHome: boolean;
  past: boolean;
  protocols: { id: string; code: string }[];
  onClick: () => void;
  // `compact` suppresses the protocol-code text chip when this row is
  // rendered inside a narrow container (e.g. the 7-column week grid).
  // The colored left stripe already identifies the protocol visually, and
  // the chip's variable width was pushing participant ID + visit name past
  // the truncate cutoff in split-screen viewports. Defaults to false so
  // wider call sites (the mobile day stack) still show the chip.
  compact?: boolean;
}

export function WeekVisitRow({
  visit,
  isLight,
  isHome,
  past,
  protocols,
  onClick,
  compact = false,
}: WeekVisitRowProps) {
  const colors = getProtocolColorsById(visit.protocolId, protocols);
  const accent = isLight ? colors.accentLight : colors.accentDark;
  const chip = isLight ? colors.chipLight : colors.chipDark;
  const rowBg = isLight ? 'bg-white hover:bg-[#F8FAFC]' : 'bg-[#0F172A] hover:bg-white/[0.03]';
  const textColor = 'text-fg-heading';
  const mutedColor = 'text-fg-muted';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`w-full text-left rounded-md border-l-2 ${accent} ${rowBg} flex items-stretch transition-colors ${
        past ? 'opacity-70' : ''
      }`}
    >
      <div className="flex-1 min-w-0 px-1.5 py-1">
        <div className="flex items-center gap-1 mb-0.5">
          {statusIcon(visit.status, 11)}
          {visit.time && (
            <span className={`text-[10px] font-semibold ${textColor}`}>
              {visit.time.replace(':00', '')}
            </span>
          )}
          {isHome && !compact && (
            <span className={`inline-block text-[9px] font-semibold px-1 py-[1px] rounded border ${chip}`}>
              {protoCode(visit.protocolId, protocols)}
            </span>
          )}
        </div>
        <div className={`text-[11px] font-medium truncate ${textColor}`}>{visit.participantId}</div>
        <div className={`text-[10px] truncate ${mutedColor}`}>
          Day {visit.studyDay} · {visit.visitName}
        </div>
      </div>
      {/* Heatmap right-edge bar — surfaces cross-study friction signal */}
      <HeatIndicator
        score={scoreVisit(visit)}
        variant="bar"
        hint="similar visits commonly drift on window or procedures"
        className="my-1 mr-1"
      />
    </button>
  );
}
