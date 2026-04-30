import { useMemo, useState } from 'react';
import {
  Search,
  X,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  FileWarning,
  Calendar as CalendarIcon,
  ChevronRight,
  Play,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  MOCK_VISITS,
  PROTOCOL_COLORS,
  type CalendarVisit,
  type VisitStatus,
} from '../../../lib/mockCalendarData';

// =============================================================================
// VisitsTab — Site Mode list of visits scoped to the active protocol.
//
// Different cut from the Overview calendar: this is a sortable list with
// status filters and search, designed for the "find a specific visit and act
// on it" workflow rather than the time-based overview.
//
// ProtocolRequiredGate ensures activeProtocol is non-null.
// =============================================================================

type StatusFilter = VisitStatus | 'ALL' | 'PAST' | 'UPCOMING';
type GroupMode = 'date' | 'participant';

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: 'All',
  UPCOMING: 'Upcoming',
  PAST: 'Past',
  scheduled: 'Scheduled',
  completed: 'Completed',
  missed: 'Missed',
  deviation: 'Deviation',
  overdue: 'Overdue',
  closing_soon: 'Closing soon',
};

const STATUS_FILTERS: StatusFilter[] = [
  'ALL',
  'UPCOMING',
  'PAST',
  'overdue',
  'closing_soon',
  'deviation',
  'missed',
];

export default function VisitsTab() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [groupMode, setGroupMode] = useState<GroupMode>('date');
  const [openVisit, setOpenVisit] = useState<CalendarVisit | null>(null);

  // Scope to the active protocol — empty array when no protocol selected so
  // the hooks below can run unconditionally.
  const scoped = useMemo(
    () =>
      activeProtocol
        ? MOCK_VISITS.filter((v) => v.protocolId === activeProtocol.id)
        : [],
    [activeProtocol],
  );

  const today = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);

  // Filter + search
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scoped
      .filter((v) => {
        if (statusFilter === 'ALL') return true;
        if (statusFilter === 'PAST') return v.date < today;
        if (statusFilter === 'UPCOMING') return v.date >= today;
        return v.status === statusFilter;
      })
      .filter((v) =>
        q
          ? v.participantId.toLowerCase().includes(q) ||
            v.visitName.toLowerCase().includes(q)
          : true,
      )
      .sort((a, b) => {
        if (groupMode === 'date') {
          if (a.date !== b.date) return a.date.localeCompare(b.date);
          return (a.time ?? '').localeCompare(b.time ?? '');
        }
        if (a.participantId !== b.participantId)
          return a.participantId.localeCompare(b.participantId);
        return a.date.localeCompare(b.date);
      });
  }, [scoped, statusFilter, search, groupMode, today]);

  // Counts for the filter row
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = {
      ALL: scoped.length,
      PAST: 0,
      UPCOMING: 0,
      scheduled: 0,
      completed: 0,
      missed: 0,
      deviation: 0,
      overdue: 0,
      closing_soon: 0,
    };
    for (const v of scoped) {
      if (v.date < today) c.PAST++;
      else c.UPCOMING++;
      c[v.status]++;
    }
    return c;
  }, [scoped, today]);

  // Theme tokens
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const filterActive = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5] text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#6e8fb5] text-[#6e8fb5]';
  const filterInactive = isLight
    ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:border-[#cbd2db] hover:text-[#1a1f28]'
    : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/55 hover:border-white/20 hover:text-[#d2d7e0]';
  const rowHover = isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.02]';

  // Group visits for rendering
  const groups = useMemo(() => {
    const map = new Map<string, CalendarVisit[]>();
    for (const v of visible) {
      const key = groupMode === 'date' ? v.date : v.participantId;
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [visible, groupMode]);

  // Defer the no-protocol guard until after all hooks are declared.
  if (!activeProtocol) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            {activeProtocol.code}
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Visits</h2>
          <p className={`${subColor} text-sm mt-1`}>
            All visits across participants on this protocol.
          </p>
        </div>
        <p className={`${subColor} text-sm`}>
          {scoped.length} total · {counts.UPCOMING} upcoming
        </p>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-2 flex-wrap">
        {STATUS_FILTERS.map((s) => {
          const isActive = statusFilter === s;
          const count = counts[s];
          if (s !== 'ALL' && s !== 'UPCOMING' && s !== 'PAST' && count === 0) return null;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md border transition-colors ${isActive ? filterActive : filterInactive}`}
            >
              {STATUS_FILTER_LABELS[s]}
              <span
                className={`text-[10px] font-semibold px-1 rounded ${
                  isActive
                    ? isLight
                      ? 'bg-[#4a6fa5]/20'
                      : 'bg-[#6e8fb5]/20'
                    : isLight
                    ? 'bg-[#1a1f28]/[0.04]'
                    : 'bg-white/[0.06]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + group toggle */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search
            size={14}
            className={`absolute left-3 top-1/2 -translate-y-1/2 ${mutedColor}`}
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by participant or visit name…"
            className={`w-full rounded-md border pl-9 pr-9 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className={`absolute right-3 top-1/2 -translate-y-1/2 ${mutedColor} hover:opacity-75`}
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div
          className={`inline-flex items-center rounded-md border p-0.5 ${
            isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5'
          }`}
        >
          {(['date', 'participant'] as GroupMode[]).map((g) => {
            const active = groupMode === g;
            return (
              <button
                key={g}
                type="button"
                onClick={() => setGroupMode(g)}
                className={`px-3 h-7 rounded text-xs font-medium capitalize transition-colors ${
                  active
                    ? isLight
                      ? 'bg-[#eef2f6] text-[#1a1f28]'
                      : 'bg-white/[0.06] text-white'
                    : isLight
                    ? 'text-[#374152]/65 hover:text-[#1a1f28]'
                    : 'text-[#d2d7e0]/55 hover:text-white'
                }`}
              >
                Group by {g}
              </button>
            );
          })}
        </div>
      </div>

      {/* Visit list */}
      {visible.length === 0 ? (
        <div className={`${cardBg} border rounded-xl px-6 py-10 text-center border-dashed`}>
          <CalendarIcon className={`mx-auto mb-2 ${mutedColor}`} size={28} />
          <p className={`${subColor} text-sm`}>
            {search ? 'No visits match your search.' : 'No visits in this status.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, items]) => (
            <div key={key} className={`${cardBg} border rounded-xl overflow-hidden`}>
              <div
                className={`px-4 py-2 border-b text-[10px] uppercase tracking-wider font-semibold ${sectionHeader} ${
                  isLight ? 'border-[#eef2f6] bg-[#f9fafc]' : 'border-white/[0.04] bg-white/[0.02]'
                }`}
              >
                {groupMode === 'date' ? formatDate(key) : key}
                <span className={`ml-2 ${mutedColor}`}>· {items.length}</span>
              </div>
              <div
                className={`divide-y ${isLight ? 'divide-[#f0f4f8]' : 'divide-white/[0.03]'}`}
              >
                {items.map((v) => (
                  <VisitRow
                    key={v.id}
                    visit={v}
                    showDate={groupMode === 'participant'}
                    showParticipant={groupMode === 'date'}
                    isLight={isLight}
                    rowHover={rowHover}
                    headingColor={headingColor}
                    subColor={subColor}
                    mutedColor={mutedColor}
                    onClick={() => setOpenVisit(v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail drawer */}
      {openVisit && (
        <VisitDrawer
          visit={openVisit}
          isLight={isLight}
          onClose={() => setOpenVisit(null)}
        />
      )}
    </div>
  );
}

// ============================================================================
// VisitRow
// ============================================================================

interface VisitRowProps {
  visit: CalendarVisit;
  showDate: boolean;
  showParticipant: boolean;
  isLight: boolean;
  rowHover: string;
  headingColor: string;
  subColor: string;
  mutedColor: string;
  onClick: () => void;
}

function VisitRow({
  visit,
  showDate,
  showParticipant,
  isLight,
  rowHover,
  headingColor,
  subColor,
  mutedColor,
  onClick,
}: VisitRowProps) {
  const colors = PROTOCOL_COLORS[visit.protocolId];
  const accent = colors ? (isLight ? colors.accentLight : colors.accentDark) : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-4 py-3 ${rowHover} transition-colors border-l-2 ${accent}`}
    >
      <span className="flex-shrink-0">{statusIcon(visit.status, 14)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          {showParticipant && (
            <span className={`${headingColor} text-sm font-semibold`}>
              {visit.participantId}
            </span>
          )}
          <span className={`text-xs ${mutedColor}`}>Day {visit.studyDay}</span>
          <span className={mutedColor}>·</span>
          <span className={`text-sm ${headingColor}`}>{visit.visitName}</span>
        </div>
        <div className={`flex items-center gap-2 mt-0.5 text-xs ${subColor}`}>
          {showDate && <span>{formatDate(visit.date)}</span>}
          {visit.time && (
            <>
              {showDate && <span className={mutedColor}>·</span>}
              <span>{visit.time}</span>
            </>
          )}
          <span className={mutedColor}>·</span>
          <span>{statusLabel(visit.status)}</span>
        </div>
      </div>
      <ChevronRight size={14} className={`flex-shrink-0 ${mutedColor}`} />
    </button>
  );
}

// ============================================================================
// VisitDrawer (lightweight version of TodayTab's drawer)
// ============================================================================

function VisitDrawer({
  visit,
  isLight,
  onClose,
}: {
  visit: CalendarVisit;
  isLight: boolean;
  onClose: () => void;
}) {
  const overlay = isLight ? 'bg-black/30' : 'bg-black/50';
  const panelBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <div className={`fixed inset-0 z-50 ${overlay} flex justify-end`} onClick={onClose}>
      <div
        className={`w-full max-w-md h-full ${panelBg} border-l shadow-xl flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${isLight ? 'border-[#e2e8ee]' : 'border-white/5'}`}>
          <div className="flex items-center gap-2 min-w-0">
            {statusIcon(visit.status, 14)}
            <div className="min-w-0">
              <p className={`${subColor} text-[11px] uppercase tracking-wider font-semibold`}>
                {statusLabel(visit.status)}
              </p>
              <h3 className={`${headingColor} font-semibold text-base truncate`}>
                {formatDate(visit.date)}
                {visit.time && <span className={`${mutedColor} font-normal ml-2`}>{visit.time}</span>}
              </h3>
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
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <h4 className={`${headingColor} font-semibold text-lg`}>
              {visit.participantId} · Day {visit.studyDay}
            </h4>
            <p className={`${subColor} text-sm`}>{visit.visitName}</p>
          </div>

          {visit.windowCloses && (
            <div
              className={`border rounded-md px-3 py-2 ${
                visit.status === 'overdue' || visit.status === 'closing_soon'
                  ? isLight
                    ? 'bg-amber-50 border-amber-200/80'
                    : 'bg-amber-500/[0.06] border-amber-500/15'
                  : isLight
                  ? 'bg-[#f9fafc] border-[#eef2f6]'
                  : 'bg-white/[0.02] border-white/[0.04]'
              }`}
            >
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                Visit window
              </p>
              <p className={`${headingColor} text-sm font-medium mt-0.5`}>
                Closes{' '}
                {new Date(visit.windowCloses).toLocaleString('en-US', {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </p>
            </div>
          )}

          {visit.procedures && visit.procedures.length > 0 && (
            <div>
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
                Scheduled procedures
              </p>
              <ul className="space-y-1.5">
                {visit.procedures.map((p, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${headingColor}`}>
                    <span
                      className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                        isLight ? 'bg-[#4a6fa5]/55' : 'bg-[#6e8fb5]/55'
                      }`}
                    />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {visit.priorNote && (
            <div>
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
                Context
              </p>
              <div
                className={`border rounded-md px-3 py-2 ${
                  isLight
                    ? 'bg-[#f9fafc] border-[#eef2f6]'
                    : 'bg-white/[0.02] border-white/[0.04]'
                }`}
              >
                <p className={`${subColor} text-sm`}>{visit.priorNote}</p>
              </div>
            </div>
          )}

          {visit.deviationReason && (
            <div
              className={`border rounded-md px-3 py-2 ${
                isLight
                  ? 'bg-amber-50 border-amber-200/80'
                  : 'bg-amber-500/[0.06] border-amber-500/15'
              }`}
            >
              <p
                className={`${
                  isLight ? 'text-amber-700' : 'text-amber-300'
                } text-[10px] uppercase tracking-wider font-semibold mb-1`}
              >
                Deviation logged
              </p>
              <p className={`${headingColor} text-sm`}>{visit.deviationReason}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className={`border-t px-5 py-4 flex items-center gap-2 ${
            isLight ? 'border-[#e2e8ee]' : 'border-white/5'
          }`}
        >
          {visit.status === 'scheduled' || visit.status === 'closing_soon' || visit.status === 'overdue' ? (
            <button
              type="button"
              className={`inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md ${buttonPrimary}`}
            >
              <Play size={14} />
              Start visit
            </button>
          ) : null}
          <button
            type="button"
            className={`inline-flex items-center gap-2 text-sm font-medium px-3.5 py-2 rounded-md ${buttonSecondary}`}
          >
            View participant profile
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

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
      return <CalendarIcon size={size} className="opacity-50" />;
  }
}

function statusLabel(status: VisitStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'scheduled':
      return 'Scheduled';
    case 'missed':
      return 'Missed';
    case 'deviation':
      return 'Logged with deviation';
    case 'overdue':
      return 'Overdue';
    case 'closing_soon':
      return 'Window closing soon';
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T12:00:00' : ''));
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}
