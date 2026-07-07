import { useRef } from 'react';
import { X, CalendarDays } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { getProtocolColorsById } from '../../../lib/site/protocolColors';
import type { SiteVisit, VisitStatus } from '../../../lib/site/types';
import { isSameDay, isPast, formatFullDate } from '../../../lib/site/dateUtils';
import { statusIcon, protoCode } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Day detail drawer
// ────────────────────────────────────────────────────────────────────────────

function formatTime(t?: string): string {
  return t ?? 'All day';
}

function statusLabel(status: VisitStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'missed':
      return 'Missed';
    case 'deviation':
      return 'Logged with deviation';
    case 'overdue':
      return 'Overdue';
    case 'closing_soon':
      return 'Window closing soon';
    case 'scheduled':
      return 'Scheduled';
    case 'cancelled':
      return 'Cancelled';
  }
}

export interface DayDetailDrawerProps {
  isLight: boolean;
  isHome: boolean;
  day: Date;
  today: Date;
  visits: SiteVisit[];
  protocols: { id: string; code: string }[];
  onClose: () => void;
  onVisitClick: (v: SiteVisit) => void;
}

export function DayDetailDrawer({ isLight, isHome, day, today, visits, protocols, onClose, onVisitClick }: DayDetailDrawerProps) {
  const overlayClick = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });
  const past = isPast(day, today);
  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';

  return (
    <div
      ref={overlayClick}
      onClick={(e) => {
        if (e.target === overlayClick.current) onClose();
      }}
      className="fixed inset-0 z-40 bg-black/30 flex justify-end animate-fade-in"
    >
      <div ref={panelRef} className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`} {...swipe}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div>
            <div className={`text-[11px] uppercase tracking-wider font-semibold ${subColor}`}>
              {isSameDay(day, today) ? 'Today' : past ? 'Past day' : 'Upcoming'}
            </div>
            <div className={`font-semibold text-base ${headingColor}`}>{formatFullDate(day)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${subColor} hover:opacity-75`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {visits.length === 0 ? (
            <div className={`text-center py-10 ${subColor} text-sm italic`}>
              <CalendarDays className="mx-auto mb-2 opacity-50" size={22} />
              Nothing scheduled.
            </div>
          ) : (
            visits.map((v) => {
              const c = getProtocolColorsById(v.protocolId, protocols);
              const accent = isLight ? c.accentLight : c.accentDark;
              const chip = isLight ? c.chipLight : c.chipDark;
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onVisitClick(v)}
                  className={`w-full text-left border-l-2 ${accent} ${
                    isLight ? 'bg-[#F8FAFC] hover:bg-[#f0f3f7]' : 'bg-white/[0.02] hover:bg-white/[0.04]'
                  } rounded-md px-3 py-2.5 transition-colors`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon(v.status, 12)}
                    <span className={`text-xs font-semibold ${headingColor}`}>{formatTime(v.time)}</span>
                    {isHome && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${chip}`}>
                        {protoCode(v.protocolId, protocols)}
                      </span>
                    )}
                    <span className={`text-[10px] ${mutedColor} ml-auto`}>{statusLabel(v.status)}</span>
                  </div>
                  <div className={`text-sm font-medium ${headingColor}`}>
                    {v.participantId} · Day {v.studyDay}
                  </div>
                  <div className={`text-xs ${subColor}`}>{v.visitName}</div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
