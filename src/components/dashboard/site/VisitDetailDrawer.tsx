import { useRef, useState } from 'react';
import {
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  FileWarning,
  Play,
  X,
  ExternalLink,
  Check,
  Users,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import {
  PROTOCOL_COLORS,
  type CalendarVisit,
  type VisitStatus,
} from '../../../lib/mockCalendarData';
import type { Protocol } from '../../../context/ProtocolContext';
import ParticipantProfileDrawer from './ParticipantProfileDrawer';

// =============================================================================
// VisitDetailDrawer — slide-in right panel for a single CalendarVisit.
//
// Used in TodayTab (calendar) and ReportsTab (deviation / missed visit rows).
// "Start visit" mode transforms the procedure list into a live checklist.
// =============================================================================

// Private date helpers (mirrored from TodayTab — small enough to duplicate)
function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}
function isPast(d: Date, today: Date): boolean {
  return startOfDay(d).getTime() < startOfDay(today).getTime();
}
function formatFullDate(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

function statusIcon(status: VisitStatus, size = 13) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={size} className="text-emerald-500" />;
    case 'missed':
      return <XCircle size={size} className="text-red-500" />;
    case 'deviation':
      return <FileWarning size={size} className="text-amber-500" />;
    case 'overdue':
      return <AlertCircle size={size} className="text-red-500" />;
    case 'closing_soon':
      return <Clock size={size} className="text-amber-500" />;
    default:
      return null;
  }
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
  }
}

export interface VisitDetailDrawerProps {
  visit: CalendarVisit;
  protocols: Protocol[];
  today: Date;
  onClose: () => void;
  onNavigateToVisits?: () => void;
}

export default function VisitDetailDrawer({
  visit,
  protocols,
  today,
  onClose,
  onNavigateToVisits,
}: VisitDetailDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const [startMode, setStartMode] = useState(false);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [showProfile, setShowProfile] = useState(false);

  const day = parseYmd(visit.date);
  const past = isPast(day, today);
  const isToday = isSameDay(day, today);
  const reviewMode =
    past &&
    (visit.status === 'completed' ||
      visit.status === 'missed' ||
      visit.status === 'deviation');
  const protocol = protocols.find((p) => p.id === visit.protocolId);
  const colors = PROTOCOL_COLORS[visit.protocolId];
  const procedures = visit.procedures ?? [];
  const allChecked = procedures.length > 0 && checked.size === procedures.length;

  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const chip = colors ? (isLight ? colors.chipLight : colors.chipDark) : '';
  const panelBg = isLight
    ? 'bg-[#f9fafc] border-[#eef2f6]'
    : 'bg-white/[0.02] border-white/[0.04]';
  const deviationBg = isLight
    ? 'bg-amber-50 border-amber-200/80'
    : 'bg-amber-500/[0.06] border-amber-500/15';
  const missedBg = isLight
    ? 'bg-red-50 border-red-200/80'
    : 'bg-red-500/[0.06] border-red-500/15';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/5 text-[#d2d7e0] hover:bg-white/[0.04]';
  const checkboxIdle = isLight
    ? 'border-[#cbd2db] bg-white'
    : 'border-white/20 bg-[#1a2230]';
  const checkboxDone = isLight
    ? 'border-[#4a6fa5] bg-[#4a6fa5]'
    : 'border-[#6e8fb5] bg-[#6e8fb5]';

  const toggleCheck = (i: number) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <>
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/30 flex justify-end animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
        {...swipe}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2">
            {statusIcon(visit.status, 14)}
            <div>
              <div className={`text-[11px] uppercase tracking-wider font-semibold ${subColor}`}>
                {startMode ? 'Visit in progress' : statusLabel(visit.status)}
              </div>
              <div className={`font-semibold text-base ${headingColor}`}>
                {isToday ? 'Today' : formatFullDate(day)}
                {visit.time && (
                  <span className={`${mutedColor} font-normal ml-2`}>{visit.time}</span>
                )}
              </div>
            </div>
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

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Participant + visit */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {protocol && (
                <span
                  className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded border ${chip}`}
                >
                  {protocol.code}
                </span>
              )}
            </div>
            <h3 className={`${headingColor} font-semibold text-lg`}>
              {visit.participantId} · Day {visit.studyDay}
            </h3>
            <p className={`${subColor} text-sm`}>{visit.visitName}</p>
            {protocol && (
              <p className={`${mutedColor} text-xs mt-1`}>{protocol.name}</p>
            )}
          </div>

          {/* Visit window */}
          {visit.windowCloses && (
            <div
              className={`border rounded-lg p-3 ${
                visit.status === 'closing_soon' || visit.status === 'overdue'
                  ? deviationBg
                  : panelBg
              }`}
            >
              <div className={`text-[11px] uppercase tracking-wider font-semibold mb-1 ${sectionHeader}`}>
                Visit window
              </div>
              <div className={`text-sm font-medium ${headingColor}`}>
                Closes{' '}
                {new Date(visit.windowCloses).toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </div>
            </div>
          )}

          {/* Deviation callout */}
          {visit.status === 'deviation' && visit.deviationReason && (
            <div className={`border rounded-lg p-3 ${deviationBg}`}>
              <div className="flex items-start gap-2">
                <FileWarning size={14} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold mb-1 text-amber-700">
                    Deviation logged
                  </div>
                  <p className={`text-sm ${headingColor}`}>{visit.deviationReason}</p>
                </div>
              </div>
            </div>
          )}

          {/* Missed callout */}
          {visit.status === 'missed' && (
            <div className={`border rounded-lg p-3 ${missedBg}`}>
              <div className="flex items-start gap-2">
                <XCircle size={14} className="text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-[11px] uppercase tracking-wider font-semibold mb-1 text-red-700">
                    Visit missed
                  </div>
                  <p className={`text-sm ${headingColor}`}>
                    Window closed without visit. Document outreach attempts and reschedule if
                    applicable.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Procedures — live checklist in start mode, bullets otherwise */}
          {procedures.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <div className={`text-[11px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
                  {startMode
                    ? 'Procedure checklist'
                    : reviewMode
                    ? 'Scheduled procedures'
                    : 'Procedures'}
                </div>
                {startMode && allChecked && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 size={11} /> All done
                  </span>
                )}
              </div>
              {startMode ? (
                <ul className="space-y-2">
                  {procedures.map((p, i) => (
                    <li key={i}>
                      <button
                        type="button"
                        onClick={() => toggleCheck(i)}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <span
                          className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                            checked.has(i) ? checkboxDone : checkboxIdle
                          }`}
                        >
                          {checked.has(i) && <Check size={10} className="text-white" />}
                        </span>
                        <span
                          className={`text-sm transition-colors ${
                            checked.has(i) ? `${mutedColor} line-through` : headingColor
                          }`}
                        >
                          {p}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <ul className="space-y-1.5">
                  {procedures.map((p, i) => (
                    <li key={i} className={`text-sm flex items-start gap-2 ${headingColor}`}>
                      <span
                        className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                          isLight ? 'bg-[#4a6fa5]/50' : 'bg-[#6e8fb5]/60'
                        }`}
                      />
                      {p}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Prior visit note */}
          {visit.priorNote && (
            <div>
              <div className={`text-[11px] uppercase tracking-wider font-semibold mb-2 ${sectionHeader}`}>
                Context
              </div>
              <div className={`border rounded-lg p-3 ${panelBg}`}>
                <p className={`${subColor} text-sm`}>{visit.priorNote}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className={`border-t ${border} px-5 py-4 flex items-center gap-2 flex-wrap`}>
          {startMode ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${
                  allChecked
                    ? isLight
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400'
                    : buttonPrimary
                }`}
              >
                <CheckCircle2 size={14} />
                {allChecked
                  ? 'Complete visit'
                  : `Complete visit (${checked.size}/${procedures.length})`}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartMode(false);
                  setChecked(new Set());
                }}
                className={`text-sm ${mutedColor} hover:opacity-75 px-2`}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              {!reviewMode && !past && (
                <button
                  type="button"
                  onClick={() => setStartMode(true)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${buttonPrimary}`}
                >
                  <Play size={14} />
                  Start visit
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  onNavigateToVisits?.();
                  onClose();
                }}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${buttonSecondary}`}
              >
                <ExternalLink size={14} />
                View in Visits
              </button>
              <button
                type="button"
                onClick={() => setShowProfile(true)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors ${isLight ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]' : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]'}`}
              >
                <Users size={14} />
                View participant profile
              </button>
            </>
          )}
        </div>
      </div>
    </div>

    {showProfile && (
      <ParticipantProfileDrawer
        participantId={visit.participantId}
        protocols={protocols}
        onClose={() => setShowProfile(false)}
      />
    )}
    </>
  );
}
