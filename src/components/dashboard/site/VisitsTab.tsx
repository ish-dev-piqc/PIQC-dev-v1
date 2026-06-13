import { useEffect, useMemo, useState } from 'react';
import VisitFormDrawer from './VisitFormDrawer';
import { Plus } from 'lucide-react';
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
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import VisitDetailDrawer from './VisitDetailDrawer';
import { buildVisitIcsBlob } from '../../../lib/site/calendarExport';
import { CalendarPlus } from 'lucide-react';
import VisitConfidenceChip from './VisitConfidenceChip';
import AuditSignalsBanner from './AuditSignalsBanner';
import ProtocolDetailDrawer from './ProtocolDetailDrawer';
import { Info } from 'lucide-react';
import { getProtocolColorsById } from '../../../lib/site/protocolColors';
import type { SiteVisit, VisitStatus } from '../../../lib/site/types';

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
  const { activeProtocol, protocols } = useProtocol();
  const { visits, participants, loading, error, refresh } = useSiteData();
  const isLight = theme === 'light';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [groupMode, setGroupMode] = useState<GroupMode>('date');
  // When grouping by participant, optionally pin the view to a single
  // participant's visits — picker dropdown becomes visible. 'ALL' shows the
  // multi-group view (every participant on this protocol).
  const [participantFilter, setParticipantFilter] = useState<string>('ALL');
  const [openVisit, setOpenVisit] = useState<SiteVisit | null>(null);
  const [scheduleFormOpen, setScheduleFormOpen] = useState(false);

  // Deep-link pickup — chat reference chips can drop a visit UUID into
  // `piq-pending-visit-v1` then navigate the user here. Once the visits
  // list is loaded, find the visit (if it belongs to the active protocol
  // and is loaded) and auto-open its detail drawer.
  useEffect(() => {
    if (loading || !visits.length) return;
    let pending: string | null = null;
    try {
      pending = localStorage.getItem('piq-pending-visit-v1');
    } catch {
      /* ignore */
    }
    if (!pending) return;
    const target = visits.find((v) => v.id === pending);
    if (!target) return;
    try {
      localStorage.removeItem('piq-pending-visit-v1');
    } catch {
      /* ignore */
    }
    setOpenVisit(target);
  }, [loading, visits]);
  // Surfaced briefly after a manual "Schedule visit" so the new row doesn't
  // disappear into the materialized list. Auto-clears after 5s.
  const [recentSchedule, setRecentSchedule] = useState<{ visit_name: string; date: string } | null>(null);
  useEffect(() => {
    if (!recentSchedule) return;
    const t = setTimeout(() => setRecentSchedule(null), 5000);
    return () => clearTimeout(t);
  }, [recentSchedule]);

  // Scope to the active protocol — empty array when no protocol selected so
  // the hooks below can run unconditionally.
  const scoped = useMemo(
    () =>
      activeProtocol
        ? visits.filter((v) => v.protocolId === activeProtocol.id)
        : [],
    [activeProtocol, visits],
  );

  const today = useMemo(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  }, []);
  const todayDate = useMemo(() => new Date(), []);

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
        groupMode === 'participant' && participantFilter !== 'ALL'
          ? v.participantId === participantFilter
          : true,
      )
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
  }, [scoped, statusFilter, search, groupMode, participantFilter, today]);

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
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const filterActive = isLight
    ? 'bg-brand-600/10 border-brand-600 text-brand-600'
    : 'bg-brand-600/15 border-brand-300 text-brand-300';
  const filterInactive = isLight
    ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-[#CBD5E1] hover:text-[#0F172A]'
    : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/55 hover:border-white/20 hover:text-[#CBD5E1]';
  const rowHover = isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]';

  // Group visits for rendering
  const groups = useMemo(() => {
    const map = new Map<string, SiteVisit[]>();
    for (const v of visible) {
      const key = groupMode === 'date' ? v.date : v.participantId;
      const arr = map.get(key) ?? [];
      arr.push(v);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [visible, groupMode]);

  const [detailOpen, setDetailOpen] = useState(false);

  // Defer the no-protocol guard until after all hooks are declared.
  if (!activeProtocol) return null;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 overflow-y-auto h-full">
      <AuditSignalsBanner protocolId={activeProtocol.id} />
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1`}>
            {activeProtocol.code}
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="opacity-60 hover:opacity-100"
              aria-label="Protocol details"
              title="Protocol details"
            >
              <Info size={11} />
            </button>
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Visits</h2>
          <p className={`${subColor} text-sm mt-1`}>
            All visits across participants on this protocol.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <p className={`${subColor} text-sm`}>
            {scoped.length} total · {counts.UPCOMING} upcoming
          </p>
          <button
            type="button"
            onClick={() => {
              const blob = buildVisitIcsBlob({
                visits: visible,
                protocolCodeById: new Map(protocols.map((p) => [p.id, p.code])),
                calendarName: activeProtocol
                  ? `${activeProtocol.code} visits`
                  : 'PIQC visits',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `visits_${activeProtocol?.code ?? 'all'}_${new Date()
                .toISOString()
                .slice(0, 10)}.ics`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            disabled={visible.length === 0}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              isLight
                ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
            } disabled:opacity-50`}
            title="Download as .ics for Outlook / Google Calendar"
          >
            <CalendarPlus size={13} />
            Export calendar
          </button>
          <button
            type="button"
            onClick={() => setScheduleFormOpen(true)}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
              isLight
                ? 'bg-brand-600 text-white hover:bg-brand-800'
                : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700'
            }`}
          >
            <Plus size={13} />
            Schedule visit
          </button>
        </div>
      </div>

      {/* Recently-scheduled banner — keeps the just-created row visible so it
          doesn't get lost among the auto-materialized visits. */}
      {recentSchedule && (
        <div
          className={`flex items-center gap-2 px-3.5 py-2 rounded-md border text-xs ${
            isLight
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-emerald-500/[0.08] border-emerald-500/25 text-emerald-300'
          }`}
        >
          <CheckCircle2 size={13} className="flex-shrink-0" />
          <span>
            Scheduled <span className="font-semibold">{recentSchedule.visit_name}</span> on{' '}
            <span className="font-mono">{recentSchedule.date}</span>. Search or sort the list to find it.
          </span>
        </div>
      )}

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
                      ? 'bg-brand-600/20'
                      : 'bg-brand-300/20'
                    : isLight
                    ? 'bg-[#0F172A]/[0.04]'
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
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className={`inline-flex items-center rounded-md border p-0.5 ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
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
                        ? 'bg-[#F2F2F2] text-[#0F172A]'
                        : 'bg-white/[0.06] text-white'
                      : isLight
                      ? 'text-[#334155]/65 hover:text-[#0F172A]'
                      : 'text-[#CBD5E1]/55 hover:text-white'
                  }`}
                >
                  Group by {g}
                </button>
              );
            })}
          </div>
          {/* When grouping by participant, let the user narrow to a single
              one. Defaults to 'All' so the multi-group view is unchanged. */}
          {groupMode === 'participant' && (
            <select
              value={participantFilter}
              onChange={(e) => setParticipantFilter(e.target.value)}
              className={`px-2 h-7 rounded-md border text-xs ${
                isLight
                  ? 'bg-white border-[#E2E8F0] text-[#0F172A]'
                  : 'bg-[#0F172A] border-white/5 text-white'
              }`}
            >
              <option value="ALL">All participants</option>
              {participants
                .filter((p) => p.protocol_id === activeProtocol.id)
                .map((p) => (
                  <option key={p.uuid} value={p.id}>
                    {p.id}
                  </option>
                ))}
            </select>
          )}
        </div>
      </div>

      {error && (
        <div
          className={`border rounded-md px-3 py-2 text-xs ${
            isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
          }`}
        >
          Failed to load visits: {error}
        </div>
      )}

      {/* Visit list */}
      {visible.length === 0 ? (
        <div className={`${cardBg} border rounded-xl px-6 py-10 text-center border-dashed`}>
          <CalendarIcon className={`mx-auto mb-2 ${mutedColor}`} size={28} />
          <p className={`${subColor} text-sm`}>
            {loading
              ? 'Loading visits…'
              : search
                ? 'No visits match your search.'
                : scoped.length === 0
                  ? 'No visits scheduled for this protocol yet.'
                  : 'No visits in this status.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(([key, items]) => (
            <div key={key} className={`${cardBg} border rounded-xl overflow-hidden`}>
              <div
                className={`px-4 py-2 border-b text-[10px] uppercase tracking-wider font-semibold ${sectionHeader} ${
                  isLight ? 'border-[#F2F2F2] bg-[#F8FAFC]' : 'border-white/[0.04] bg-white/[0.02]'
                }`}
              >
                {groupMode === 'date' ? formatDate(key) : key}
                <span className={`ml-2 ${mutedColor}`}>· {items.length}</span>
              </div>
              <div
                className={`divide-y ${isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.03]'}`}
              >
                {items.map((v) => (
                  <VisitRow
                    key={v.id}
                    visit={v}
                    showDate={groupMode === 'participant'}
                    showParticipant={groupMode === 'date'}
                    protocols={protocols}
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

      {openVisit && (
        <VisitDetailDrawer
          visit={openVisit}
          protocols={protocols}
          today={todayDate}
          onClose={() => setOpenVisit(null)}
        />
      )}
      {scheduleFormOpen && (
        <VisitFormDrawer
          protocolId={activeProtocol.id}
          onClose={() => setScheduleFormOpen(false)}
          onSaved={(summary) => {
            setRecentSchedule(summary);
            refresh();
          }}
        />
      )}
      <ProtocolDetailDrawer
        protocolId={detailOpen ? activeProtocol.id : null}
        protocolCode={activeProtocol.code}
        protocolTitle={activeProtocol.name}
        protocolSponsor={activeProtocol.sponsor}
        onClose={() => setDetailOpen(false)}
      />
    </div>
  );
}

// ============================================================================
// VisitRow
// ============================================================================

interface VisitRowProps {
  visit: SiteVisit;
  showDate: boolean;
  showParticipant: boolean;
  protocols: { id: string; code: string }[];
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
  protocols,
  isLight,
  rowHover,
  headingColor,
  subColor,
  mutedColor,
  onClick,
}: VisitRowProps) {
  const colors = getProtocolColorsById(visit.protocolId, protocols);
  const accent = isLight ? colors.accentLight : colors.accentDark;

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
          <VisitConfidenceChip confidence={visit.confidenceState} />
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
