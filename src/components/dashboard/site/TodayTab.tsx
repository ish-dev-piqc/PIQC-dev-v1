import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  X,
  CheckCircle2,
  XCircle,
  FileWarning,
  Filter,
  CalendarDays,
  Play,
  ExternalLink,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useAuth } from '../../../context/AuthContext';
import HeatIndicator from '../../heatmap/HeatIndicator';
import { scoreVisit } from '../../../lib/heatmap';
import {
  MOCK_VISITS,
  PROTOCOL_COLORS,
  PROTOCOL_PARTICIPANTS,
  type CalendarVisit,
  type VisitStatus,
} from '../../../lib/mockCalendarData';

// ────────────────────────────────────────────────────────────────────────────
// Date utilities
// ────────────────────────────────────────────────────────────────────────────

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfWeek(d: Date): Date {
  // Week starts on Sunday.
  const copy = startOfDay(d);
  copy.setDate(copy.getDate() - copy.getDay());
  return copy;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function addMonths(d: Date, months: number): Date {
  const copy = new Date(d);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

function isPast(d: Date, today: Date): boolean {
  return startOfDay(d).getTime() < startOfDay(today).getTime();
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatFullDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function formatWeekRange(start: Date): string {
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endStr = sameMonth
    ? end.toLocaleDateString('en-US', { day: 'numeric' })
    : end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const yearStr = sameYear ? start.getFullYear() : `${start.getFullYear()} – ${end.getFullYear()}`;
  return `${startStr} – ${endStr}, ${yearStr}`;
}

function formatMonth(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatTime(t?: string): string {
  return t ?? 'All day';
}

// ────────────────────────────────────────────────────────────────────────────
// Filter state (persisted)
// ────────────────────────────────────────────────────────────────────────────

const FILTER_STORAGE_KEY = 'piq-today-filters-v1';

interface FilterState {
  hiddenProtocols: string[];
  hiddenParticipants: string[];
}

function loadFilters(): FilterState {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return { hiddenProtocols: [], hiddenParticipants: [] };
    const parsed = JSON.parse(raw);
    return {
      hiddenProtocols: Array.isArray(parsed.hiddenProtocols) ? parsed.hiddenProtocols : [],
      hiddenParticipants: Array.isArray(parsed.hiddenParticipants) ? parsed.hiddenParticipants : [],
    };
  } catch {
    return { hiddenProtocols: [], hiddenParticipants: [] };
  }
}

function saveFilters(state: FilterState) {
  try {
    localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Status display helpers
// ────────────────────────────────────────────────────────────────────────────

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

// ────────────────────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────────────────────

type ViewMode = 'week' | 'month';

export default function TodayTab() {
  const { theme } = useTheme();
  const { activeProtocol, protocols } = useProtocol();
  const { user } = useAuth();
  const isLight = theme === 'light';
  const isHome = activeProtocol === null;

  const today = useMemo(() => startOfDay(new Date()), []);

  const [view, setView] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(today);
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());
  const [openVisit, setOpenVisit] = useState<CalendarVisit | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState<boolean>(true);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // Scope visits by current protocol (scoped mode drops other protocols).
  const scopedVisits = useMemo(() => {
    if (isHome) return MOCK_VISITS;
    return MOCK_VISITS.filter((v) => v.protocolId === activeProtocol.id);
  }, [isHome, activeProtocol]);

  // Apply filters.
  const visibleVisits = useMemo(() => {
    const hiddenProtos = new Set(filters.hiddenProtocols);
    const hiddenParts = new Set(filters.hiddenParticipants);
    return scopedVisits.filter(
      (v) => !hiddenProtos.has(v.protocolId) && !hiddenParts.has(v.participantId),
    );
  }, [scopedVisits, filters]);

  // Group visits by date for fast lookup.
  const visitsByDate = useMemo(() => {
    const map = new Map<string, CalendarVisit[]>();
    for (const v of visibleVisits) {
      const arr = map.get(v.date) ?? [];
      arr.push(v);
      map.set(v.date, arr);
    }
    // Sort each day by time (undefined → end).
    for (const [, arr] of map) {
      arr.sort((a, b) => {
        if (!a.time && !b.time) return 0;
        if (!a.time) return 1;
        if (!b.time) return -1;
        return parseTime(a.time) - parseTime(b.time);
      });
    }
    return map;
  }, [visibleVisits]);

  const needsAttention = useMemo(() => {
    return visibleVisits.filter((v) => v.status === 'overdue' || v.status === 'closing_soon');
  }, [visibleVisits]);

  // Compute the date range for the current view, for empty-state detection.
  const viewRange = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      return { start, end: addDays(start, 6) };
    }
    const gridStart = startOfWeek(startOfMonth(anchorDate));
    return { start: gridStart, end: addDays(gridStart, 41) };
  }, [view, anchorDate]);

  const isInRange = (v: CalendarVisit) => {
    const d = parseYmd(v.date);
    return d >= viewRange.start && d <= viewRange.end;
  };

  const visibleInRange = useMemo(() => visibleVisits.filter(isInRange), [visibleVisits, viewRange]);
  const scopedInRange = useMemo(() => scopedVisits.filter(isInRange), [scopedVisits, viewRange]);

  const isEmptyRange = visibleInRange.length === 0;
  const isFilteredEmpty = isEmptyRange && scopedInRange.length > 0;

  const clearFilters = () => setFilters({ hiddenProtocols: [], hiddenParticipants: [] });

  // Theme tokens.
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';

  const displayName =
    (user?.user_metadata?.full_name as string)?.split(' ')[0] ??
    user?.email?.split('@')[0] ??
    'there';

  const handlePrev = () => setAnchorDate((d) => (view === 'week' ? addDays(d, -7) : addMonths(d, -1)));
  const handleNext = () => setAnchorDate((d) => (view === 'week' ? addDays(d, 7) : addMonths(d, 1)));
  const handleToday = () => setAnchorDate(today);

  const toggleProtocol = (id: string) => {
    setFilters((f) => ({
      ...f,
      hiddenProtocols: f.hiddenProtocols.includes(id)
        ? f.hiddenProtocols.filter((x) => x !== id)
        : [...f.hiddenProtocols, id],
    }));
  };

  const toggleParticipant = (id: string) => {
    setFilters((f) => ({
      ...f,
      hiddenParticipants: f.hiddenParticipants.includes(id)
        ? f.hiddenParticipants.filter((x) => x !== id)
        : [...f.hiddenParticipants, id],
    }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Greeting */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className={`${headingColor} font-semibold text-xl mb-1`}>
              {greeting()}, {displayName}
            </h2>
            <p className={`${subColor} text-sm`}>
              {formatFullDate(today)}
              {!isHome && <span className={mutedColor}> · Viewing {activeProtocol.code}</span>}
            </p>
          </div>
        </div>
      </div>

      {/* Needs Attention band */}
      {needsAttention.length > 0 && (
        <NeedsAttentionBand
          items={needsAttention}
          isLight={isLight}
          isHome={isHome}
          onItemClick={(v) => setOpenVisit(v)}
        />
      )}

      {/* Calendar toolbar */}
      <div className="px-6 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFilterPanelOpen((v) => !v)}
            className={`md:hidden inline-flex items-center justify-center w-8 h-8 rounded-lg border ${
              isLight
                ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border-white/5 text-[#d2d7e0]/65 hover:bg-white/[0.02]'
            }`}
            aria-label="Toggle filters"
          >
            <Filter size={14} />
          </button>
          <button
            type="button"
            onClick={handlePrev}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border ${
              isLight
                ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border-white/5 text-[#d2d7e0]/65 hover:bg-white/[0.02]'
            }`}
            aria-label="Previous"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className={`px-3 h-8 rounded-lg border text-xs font-medium ${
              isLight
                ? 'bg-white border-[#e2e8ee] text-[#374152]/75 hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border-white/5 text-[#d2d7e0]/75 hover:bg-white/[0.02]'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleNext}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border ${
              isLight
                ? 'bg-white border-[#e2e8ee] text-[#374152]/65 hover:bg-[#f5f7fa]'
                : 'bg-[#131a22] border-white/5 text-[#d2d7e0]/65 hover:bg-white/[0.02]'
            }`}
            aria-label="Next"
          >
            <ChevronRight size={16} />
          </button>
          <div className={`ml-2 text-sm font-medium ${headingColor}`}>
            {view === 'week' ? formatWeekRange(startOfWeek(anchorDate)) : formatMonth(anchorDate)}
          </div>
        </div>

        <div
          className={`inline-flex items-center rounded-lg border p-0.5 ${
            isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5'
          }`}
        >
          {(['week', 'month'] as ViewMode[]).map((v) => {
            const active = view === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`px-3 h-7 rounded-md text-xs font-medium capitalize transition-colors ${
                  active
                    ? isLight
                      ? 'bg-[#eef2f6] text-[#1a1f28]'
                      : 'bg-white/[0.06] text-white'
                    : isLight
                    ? 'text-[#374152]/65 hover:text-[#1a1f28]'
                    : 'text-[#d2d7e0]/55 hover:text-white'
                }`}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main calendar row */}
      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0 overflow-hidden">
        {/* Filters */}
        <CalendarFilters
          isLight={isLight}
          isHome={isHome}
          protocols={protocols}
          activeProtocolId={activeProtocol?.id ?? null}
          filters={filters}
          onToggleProtocol={toggleProtocol}
          onToggleParticipant={toggleParticipant}
          open={filterPanelOpen}
          onClose={() => setFilterPanelOpen(false)}
        />

        {/* Calendar */}
        <div className={`flex-1 min-w-0 ${cardBg} border rounded-xl overflow-hidden flex flex-col`}>
          {isEmptyRange ? (
            <CalendarEmptyState
              isLight={isLight}
              view={view}
              rangeLabel={view === 'week' ? formatWeekRange(startOfWeek(anchorDate)) : formatMonth(anchorDate)}
              filtered={isFilteredEmpty}
              hiddenCount={scopedInRange.length}
              onClearFilters={clearFilters}
              onJumpToToday={handleToday}
              isToday={isSameDay(anchorDate, today)}
            />
          ) : view === 'week' ? (
            <WeekView
              isLight={isLight}
              isHome={isHome}
              anchorDate={anchorDate}
              today={today}
              visitsByDate={visitsByDate}
              onVisitClick={setOpenVisit}
              onDayClick={setOpenDay}
            />
          ) : (
            <MonthView
              isLight={isLight}
              isHome={isHome}
              anchorDate={anchorDate}
              today={today}
              visitsByDate={visitsByDate}
              onVisitClick={setOpenVisit}
              onDayClick={setOpenDay}
            />
          )}
        </div>
      </div>

      {/* Drawers */}
      {openDay && (
        <DayDetailDrawer
          isLight={isLight}
          isHome={isHome}
          day={openDay}
          today={today}
          visits={visitsByDate.get(formatYmd(openDay)) ?? []}
          onClose={() => setOpenDay(null)}
          onVisitClick={(v) => {
            setOpenDay(null);
            setOpenVisit(v);
          }}
        />
      )}
      {openVisit && (
        <VisitDetailDrawer
          isLight={isLight}
          visit={openVisit}
          protocols={protocols}
          today={today}
          onClose={() => setOpenVisit(null)}
        />
      )}
    </div>
  );
}

function parseTime(t: string): number {
  // "9:00 AM" → minutes from midnight
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(t.trim());
  if (!m) return 0;
  let hour = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && hour < 12) hour += 12;
  if (ampm === 'AM' && hour === 12) hour = 0;
  return hour * 60 + min;
}

// ────────────────────────────────────────────────────────────────────────────
// Needs Attention band
// ────────────────────────────────────────────────────────────────────────────

interface NeedsAttentionBandProps {
  items: CalendarVisit[];
  isLight: boolean;
  isHome: boolean;
  onItemClick: (v: CalendarVisit) => void;
}

const NEEDS_ATTENTION_ORDER: Record<string, number> = {
  overdue: 0,
  closing_soon: 1,
};

function sortNeedsAttention(items: CalendarVisit[]): CalendarVisit[] {
  return [...items].sort((a, b) => {
    const sev = (NEEDS_ATTENTION_ORDER[a.status] ?? 99) - (NEEDS_ATTENTION_ORDER[b.status] ?? 99);
    if (sev !== 0) return sev;
    // Within severity, soonest-closing first
    const ac = a.windowCloses ? new Date(a.windowCloses).getTime() : Infinity;
    const bc = b.windowCloses ? new Date(b.windowCloses).getTime() : Infinity;
    return ac - bc;
  });
}

const INLINE_CAP = 2;

function NeedsAttentionBand({ items, isLight, isHome, onItemClick }: NeedsAttentionBandProps) {
  const [popoverMode, setPopoverMode] = useState<'all' | 'overflow' | null>(null);
  const popoverOpen = popoverMode !== null;
  const popoverRef = useRef<HTMLDivElement>(null);
  const wideToggleRef = useRef<HTMLButtonElement>(null);
  const narrowToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPopover = popoverRef.current?.contains(target) ?? false;
      const onWide = wideToggleRef.current?.contains(target) ?? false;
      const onNarrow = narrowToggleRef.current?.contains(target) ?? false;
      if (!inPopover && !onWide && !onNarrow) setPopoverMode(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverMode(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [popoverOpen]);

  const sorted = sortNeedsAttention(items);
  const inline = sorted.slice(0, INLINE_CAP);
  const overflow = sorted.slice(INLINE_CAP);
  const popoverItems = popoverMode === 'all' ? sorted : overflow;

  const overdueCount = sorted.filter((v) => v.status === 'overdue').length;
  const closingCount = sorted.filter((v) => v.status === 'closing_soon').length;
  const summaryParts: string[] = [];
  if (overdueCount > 0) summaryParts.push(`${overdueCount} overdue`);
  if (closingCount > 0) summaryParts.push(`${closingCount} closing soon`);
  const summary = summaryParts.join(' · ');

  const bandBg = isLight
    ? 'bg-amber-50 border-amber-200/80'
    : 'bg-amber-500/[0.04] border-amber-500/15';
  const labelColor = isLight ? 'text-amber-700' : 'text-amber-400';
  const textColor = isLight ? 'text-[#1a1f28]/85' : 'text-[#d2d7e0]/85';
  const mutedColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const popoverBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const rowHover = isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.03]';
  const moreChip = isLight
    ? 'bg-amber-100/60 border-amber-300/60 text-amber-800 hover:bg-amber-100'
    : 'bg-amber-500/[0.08] border-amber-500/25 text-amber-300 hover:bg-amber-500/[0.12]';

  const renderItemInline = (v: CalendarVisit) => (
    <button
      key={v.id}
      type="button"
      onClick={() => onItemClick(v)}
      className={`flex-shrink-0 inline-flex items-center gap-2 text-xs ${textColor} hover:underline min-w-0`}
    >
      {statusIcon(v.status, 12)}
      {isHome && (
        <span className={`${mutedColor} font-medium`}>{protoCode(v.protocolId)}</span>
      )}
      <span className="font-medium">{v.participantId}</span>
      <span className={mutedColor}>·</span>
      <span className="truncate max-w-[180px]">{v.visitName}</span>
      {v.windowCloses && (
        <span className={v.status === 'closing_soon' ? 'text-amber-600 font-medium' : mutedColor}>
          · closes {relativeClose(v.windowCloses)}
        </span>
      )}
    </button>
  );

  const renderItemPopover = (v: CalendarVisit) => (
    <button
      key={v.id}
      type="button"
      onClick={() => {
        setPopoverMode(null);
        onItemClick(v);
      }}
      className={`w-full text-left px-3 py-2.5 ${rowHover} flex items-start gap-2 transition-colors`}
    >
      <span className="flex-shrink-0 mt-0.5">{statusIcon(v.status, 12)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isHome && (
            <span className={`${mutedColor} text-[11px] font-medium`}>{protoCode(v.protocolId)}</span>
          )}
          <span className={`text-xs font-semibold ${textColor}`}>{v.participantId}</span>
          <span className={`${mutedColor} text-xs`}>·</span>
          <span className={`text-xs ${textColor}`}>{v.visitName}</span>
        </div>
        {v.windowCloses && (
          <div
            className={`text-[11px] mt-0.5 ${
              v.status === 'closing_soon' ? 'text-amber-600 font-medium' : mutedColor
            }`}
          >
            Closes {relativeClose(v.windowCloses)}
          </div>
        )}
      </div>
    </button>
  );

  return (
    <div className={`mx-6 mb-1 border rounded-lg ${bandBg} flex-shrink-0 relative`}>
      {/* Narrow layout: label + count summary (collapses all items) */}
      <button
        ref={narrowToggleRef}
        type="button"
        onClick={() => setPopoverMode((m) => (m === 'all' ? null : 'all'))}
        aria-expanded={popoverMode === 'all'}
        className={`md:hidden w-full px-3 py-2 flex items-center gap-2 text-left`}
      >
        <span className={`inline-flex items-center gap-1.5 ${labelColor} flex-shrink-0`}>
          <AlertCircle size={13} />
          <span className="text-[11px] uppercase tracking-wider font-semibold">Needs attention</span>
        </span>
        <span className={`text-xs font-medium ${textColor} truncate flex-1`}>{summary}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 ${labelColor} transition-transform ${
            popoverMode === 'all' ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Wide layout: inline top N + +more chip */}
      <div className="hidden md:flex px-3 py-2 items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 inline-flex items-center gap-1.5 ${labelColor}`}>
          <AlertCircle size={13} />
          <span className="text-[11px] uppercase tracking-wider font-semibold">Needs attention</span>
        </div>
        <div className="flex-1 flex items-center gap-4 min-w-0">{inline.map(renderItemInline)}</div>
        {overflow.length > 0 && (
          <button
            ref={wideToggleRef}
            type="button"
            onClick={() => setPopoverMode((m) => (m === 'overflow' ? null : 'overflow'))}
            className={`flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border ${moreChip} transition-colors`}
            aria-expanded={popoverMode === 'overflow'}
          >
            +{overflow.length} more
            <ChevronDown
              size={11}
              className={`transition-transform ${popoverMode === 'overflow' ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {popoverOpen && popoverItems.length > 0 && (
        <div
          ref={popoverRef}
          className={`absolute right-3 left-3 md:left-auto top-full mt-1 md:w-80 max-w-[calc(100vw-2rem)] z-30 border rounded-lg shadow-lg ${popoverBg} overflow-hidden`}
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#eef2f6]' : 'border-white/5'}`}>
            <div className={`text-[11px] uppercase tracking-wider font-semibold ${labelColor}`}>
              {popoverMode === 'all'
                ? `${popoverItems.length} ${popoverItems.length === 1 ? 'item' : 'items'}`
                : `${popoverItems.length} more ${popoverItems.length === 1 ? 'item' : 'items'}`}
            </div>
          </div>
          <div className={`max-h-80 overflow-y-auto divide-y ${isLight ? 'divide-[#f0f4f8]' : 'divide-white/[0.03]'}`}>
            {popoverItems.map(renderItemPopover)}
          </div>
        </div>
      )}
    </div>
  );
}

function protoCode(id: string): string {
  // Small helper for rendering; safe fallback on unknown id.
  const map: Record<string, string> = {
    'proto-001': 'BRIGHTEN-2',
    'proto-002': 'CARDIAC-7',
    'proto-003': 'IMMUNE-14',
  };
  return map[id] ?? id;
}

function relativeClose(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diffMin < 0) return `${Math.abs(Math.round(diffMin / 60))}h ago`;
  if (diffMin < 60) return `in ${diffMin}m`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// ────────────────────────────────────────────────────────────────────────────
// Filter panel (Google Calendar style)
// ────────────────────────────────────────────────────────────────────────────

interface CalendarFiltersProps {
  isLight: boolean;
  isHome: boolean;
  protocols: { id: string; code: string }[];
  activeProtocolId: string | null;
  filters: FilterState;
  onToggleProtocol: (id: string) => void;
  onToggleParticipant: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

function CalendarFilters({
  isLight,
  isHome,
  protocols,
  activeProtocolId,
  filters,
  onToggleProtocol,
  onToggleParticipant,
  open,
  onClose,
}: CalendarFiltersProps) {
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const sectionHeader = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/45';
  const textColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const mutedColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';

  const shownProtocols = isHome ? protocols : protocols.filter((p) => p.id === activeProtocolId);

  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(
    () => new Set(shownProtocols.map((p) => p.id)),
  );

  const toggleExpand = (id: string) => {
    setExpandedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hiddenProtos = new Set(filters.hiddenProtocols);
  const hiddenParts = new Set(filters.hiddenParticipants);

  return (
    <aside
      className={`${
        open ? 'block' : 'hidden'
      } md:block w-44 flex-shrink-0 ${cardBg} border rounded-xl overflow-y-auto`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${sectionHeader} text-[11px] uppercase tracking-wider font-semibold`}>
            Filters
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`md:hidden ${mutedColor} hover:opacity-75`}
            aria-label="Close filters"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-1">
          {shownProtocols.map((p) => {
            const colors = PROTOCOL_COLORS[p.id];
            if (!colors) return null;
            const dotCls = isLight ? colors.dotLight : colors.dotDark;
            const expanded = expandedProtocols.has(p.id);
            const protoHidden = hiddenProtos.has(p.id);
            const participants = PROTOCOL_PARTICIPANTS[p.id] ?? [];

            return (
              <div key={p.id}>
                <div className="flex items-center gap-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleProtocol(p.id)}
                    className="flex-shrink-0"
                    aria-label={`Toggle ${p.code}`}
                  >
                    <span
                      className={`inline-block w-3.5 h-3.5 rounded-sm ${
                        protoHidden
                          ? isLight
                            ? 'bg-white border border-[#cbd2db]'
                            : 'bg-[#0d1118] border border-white/15'
                          : dotCls
                      }`}
                    />
                  </button>
                  {isHome && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      className={`flex-shrink-0 ${mutedColor} hover:opacity-75`}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      <ChevronDown
                        size={12}
                        className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleProtocol(p.id)}
                    className={`flex-1 text-left text-xs font-medium truncate ${
                      protoHidden ? mutedColor : textColor
                    }`}
                  >
                    {p.code}
                  </button>
                </div>

                {expanded && participants.length > 0 && (
                  <div className="ml-6 pl-2 border-l border-dashed space-y-0.5 mb-1"
                       style={{ borderColor: isLight ? 'rgba(55,65,82,0.12)' : 'rgba(210,215,224,0.1)' }}>
                    {participants.map((pid) => {
                      const partHidden = hiddenParts.has(pid);
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => onToggleParticipant(pid)}
                          className={`w-full flex items-center gap-2 py-1 text-left text-xs ${
                            partHidden ? mutedColor : textColor
                          } hover:opacity-80`}
                        >
                          <span
                            className={`inline-block w-3 h-3 rounded-sm border ${
                              partHidden
                                ? isLight
                                  ? 'bg-white border-[#cbd2db]'
                                  : 'bg-[#0d1118] border-white/15'
                                : isLight
                                ? 'bg-[#4a6fa5]/60 border-[#4a6fa5]/60'
                                : 'bg-[#6e8fb5]/50 border-[#6e8fb5]/50'
                            }`}
                          />
                          <span className="truncate">{pid}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Week view
// ────────────────────────────────────────────────────────────────────────────

interface ViewProps {
  isLight: boolean;
  isHome: boolean;
  anchorDate: Date;
  today: Date;
  visitsByDate: Map<string, CalendarVisit[]>;
  onVisitClick: (v: CalendarVisit) => void;
  onDayClick: (d: Date) => void;
}

function WeekView({ isLight, isHome, anchorDate, today, visitsByDate, onVisitClick, onDayClick }: ViewProps) {
  const start = startOfWeek(anchorDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));

  const headerBg = isLight ? 'bg-[#f9fafc]' : 'bg-[#0e141b]';
  const headerText = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const dayBorder = isLight ? 'border-[#eef2f6]' : 'border-white/[0.04]';
  const todayTint = isLight ? 'bg-[#4a6fa5]/[0.04]' : 'bg-[#6e8fb5]/[0.04]';
  const numberColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const todayNumber = isLight ? 'bg-[#4a6fa5] text-white' : 'bg-[#6e8fb5] text-[#1a1f28]';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';

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
                      onClick={() => onVisitClick(v)}
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

interface WeekVisitRowProps {
  visit: CalendarVisit;
  isLight: boolean;
  isHome: boolean;
  past: boolean;
  onClick: () => void;
}

function WeekVisitRow({ visit, isLight, isHome, past, onClick }: WeekVisitRowProps) {
  const colors = PROTOCOL_COLORS[visit.protocolId];
  const accent = colors ? (isLight ? colors.accentLight : colors.accentDark) : '';
  const chip = colors ? (isLight ? colors.chipLight : colors.chipDark) : '';
  const rowBg = isLight ? 'bg-white hover:bg-[#f5f7fa]' : 'bg-[#131a22] hover:bg-white/[0.03]';
  const textColor = isLight ? 'text-[#1a1f28]' : 'text-[#d2d7e0]';
  const mutedColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';

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
          {isHome && (
            <span className={`inline-block text-[9px] font-semibold px-1 py-[1px] rounded border ${chip}`}>
              {protoCode(visit.protocolId)}
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

// ────────────────────────────────────────────────────────────────────────────
// Month view
// ────────────────────────────────────────────────────────────────────────────

function MonthView({ isLight, isHome, anchorDate, today, visitsByDate, onVisitClick, onDayClick }: ViewProps) {
  const monthStart = startOfMonth(anchorDate);
  const gridStart = startOfWeek(monthStart);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  const headerBg = isLight ? 'bg-[#f9fafc]' : 'bg-[#0e141b]';
  const headerText = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const dayBorder = isLight ? 'border-[#eef2f6]' : 'border-white/[0.04]';
  const todayTint = isLight ? 'bg-[#4a6fa5]/[0.04]' : 'bg-[#6e8fb5]/[0.04]';
  const numberColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const todayNumber = isLight ? 'bg-[#4a6fa5] text-white' : 'bg-[#6e8fb5] text-[#1a1f28]';
  const outsideMonth = isLight ? 'text-[#374152]/25' : 'text-[#d2d7e0]/20';
  const mutedColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';

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
          const colors = dayVisits[0] ? PROTOCOL_COLORS[dayVisits[0].protocolId] : undefined;

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
                  const c = PROTOCOL_COLORS[v.protocolId];
                  const accent = c ? (isLight ? c.accentLight : c.accentDark) : '';
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onVisitClick(v);
                      }}
                      className={`w-full text-left border-l-2 ${accent} px-1 text-[10px] truncate hover:opacity-75 ${
                        isLight ? 'text-[#1a1f28]' : 'text-[#d2d7e0]'
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

// ────────────────────────────────────────────────────────────────────────────
// Day detail drawer
// ────────────────────────────────────────────────────────────────────────────

interface DayDetailDrawerProps {
  isLight: boolean;
  isHome: boolean;
  day: Date;
  today: Date;
  visits: CalendarVisit[];
  onClose: () => void;
  onVisitClick: (v: CalendarVisit) => void;
}

function DayDetailDrawer({ isLight, isHome, day, today, visits, onClose, onVisitClick }: DayDetailDrawerProps) {
  const overlayClick = useRef<HTMLDivElement>(null);
  const past = isPast(day, today);
  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';

  return (
    <div
      ref={overlayClick}
      onClick={(e) => {
        if (e.target === overlayClick.current) onClose();
      }}
      className="fixed inset-0 z-40 bg-black/30 flex justify-end animate-fade-in"
    >
      <div className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}>
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
              const c = PROTOCOL_COLORS[v.protocolId];
              const accent = c ? (isLight ? c.accentLight : c.accentDark) : '';
              const chip = c ? (isLight ? c.chipLight : c.chipDark) : '';
              return (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onVisitClick(v)}
                  className={`w-full text-left border-l-2 ${accent} ${
                    isLight ? 'bg-[#f9fafc] hover:bg-[#f0f3f7]' : 'bg-white/[0.02] hover:bg-white/[0.04]'
                  } rounded-md px-3 py-2.5 transition-colors`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {statusIcon(v.status, 12)}
                    <span className={`text-xs font-semibold ${headingColor}`}>{formatTime(v.time)}</span>
                    {isHome && (
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${chip}`}>
                        {protoCode(v.protocolId)}
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

// ────────────────────────────────────────────────────────────────────────────
// Visit detail drawer
// ────────────────────────────────────────────────────────────────────────────

interface VisitDetailDrawerProps {
  isLight: boolean;
  visit: CalendarVisit;
  protocols: { id: string; code: string; name: string; sponsor: string; phase: string }[];
  today: Date;
  onClose: () => void;
}

function VisitDetailDrawer({ isLight, visit, protocols, today, onClose }: VisitDetailDrawerProps) {
  const overlay = useRef<HTMLDivElement>(null);
  const day = parseYmd(visit.date);
  const past = isPast(day, today);
  const isToday = isSameDay(day, today);
  const reviewMode = past && (visit.status === 'completed' || visit.status === 'missed' || visit.status === 'deviation');
  const protocol = protocols.find((p) => p.id === visit.protocolId);
  const colors = PROTOCOL_COLORS[visit.protocolId];

  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/60' : 'text-[#d2d7e0]/55';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/45';
  const chip = colors ? (isLight ? colors.chipLight : colors.chipDark) : '';
  const panelBg = isLight ? 'bg-[#f9fafc] border-[#eef2f6]' : 'bg-white/[0.02] border-white/[0.04]';
  const deviationBg = isLight ? 'bg-amber-50 border-amber-200/80' : 'bg-amber-500/[0.06] border-amber-500/15';
  const missedBg = isLight ? 'bg-red-50 border-red-200/80' : 'bg-red-500/[0.06] border-red-500/15';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/5 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/30 flex justify-end animate-fade-in"
    >
      <div className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}>
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2">
            {statusIcon(visit.status, 14)}
            <div>
              <div className={`text-[11px] uppercase tracking-wider font-semibold ${subColor}`}>
                {statusLabel(visit.status)}
              </div>
              <div className={`font-semibold text-base ${headingColor}`}>
                {isToday ? 'Today' : formatFullDate(day)}
                {visit.time && <span className={`${mutedColor} font-normal ml-2`}>{visit.time}</span>}
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

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Participant + visit */}
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-2">
              {protocol && (
                <span className={`inline-block text-[11px] font-semibold px-1.5 py-0.5 rounded border ${chip}`}>
                  {protocol.code}
                </span>
              )}
            </div>
            <h3 className={`${headingColor} font-semibold text-lg`}>
              {visit.participantId} · Day {visit.studyDay}
            </h3>
            <p className={`${subColor} text-sm`}>{visit.visitName}</p>
            {protocol && (
              <p className={`${mutedColor} text-xs mt-1`}>
                {protocol.name}
              </p>
            )}
          </div>

          {/* Timing / window */}
          {visit.windowCloses && (
            <div className={`border rounded-lg p-3 ${visit.status === 'closing_soon' || visit.status === 'overdue' ? deviationBg : panelBg}`}>
              <div className={`text-[11px] uppercase tracking-wider font-semibold mb-1 ${sectionHeader}`}>
                Visit window
              </div>
              <div className={`text-sm font-medium ${headingColor}`}>
                Closes {new Date(visit.windowCloses).toLocaleString('en-US', {
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
                  <div className={`text-[11px] uppercase tracking-wider font-semibold mb-1 text-amber-700`}>
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
                  <div className={`text-[11px] uppercase tracking-wider font-semibold mb-1 text-red-700`}>
                    Visit missed
                  </div>
                  <p className={`text-sm ${headingColor}`}>
                    Window closed without visit. Document outreach attempts and reschedule if applicable.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Procedures */}
          {visit.procedures && visit.procedures.length > 0 && (
            <div>
              <div className={`text-[11px] uppercase tracking-wider font-semibold mb-2 ${sectionHeader}`}>
                {reviewMode ? 'Scheduled procedures' : 'Procedures'}
              </div>
              <ul className="space-y-1.5">
                {visit.procedures.map((p, i) => (
                  <li key={i} className={`text-sm flex items-start gap-2 ${headingColor}`}>
                    <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                      isLight ? 'bg-[#4a6fa5]/50' : 'bg-[#6e8fb5]/60'
                    }`} />
                    {p}
                  </li>
                ))}
              </ul>
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

        {/* Footer actions */}
        <div className={`border-t ${border} px-5 py-4 flex items-center gap-2`}>
          {!reviewMode && !past && (
            <button
              type="button"
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium ${buttonPrimary}`}
            >
              <Play size={14} />
              Start visit
            </button>
          )}
          <button
            type="button"
            className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium ${buttonSecondary}`}
          >
            <ExternalLink size={14} />
            View in Visits
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Calendar empty state
// ────────────────────────────────────────────────────────────────────────────

interface CalendarEmptyStateProps {
  isLight: boolean;
  view: ViewMode;
  rangeLabel: string;
  filtered: boolean;
  hiddenCount: number;
  onClearFilters: () => void;
  onJumpToToday: () => void;
  isToday: boolean;
}

function CalendarEmptyState({
  isLight,
  view,
  rangeLabel,
  filtered,
  hiddenCount,
  onClearFilters,
  onJumpToToday,
  isToday,
}: CalendarEmptyStateProps) {
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/25 text-[#6e8fb5]';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/5 text-[#d2d7e0] hover:bg-white/[0.04]';

  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <div className={`inline-flex items-center justify-center w-14 h-14 rounded-2xl border mb-4 ${iconBg}`}>
          {filtered ? <Filter size={22} /> : <CalendarDays size={22} />}
        </div>
        {filtered ? (
          <>
            <h3 className={`${headingColor} font-semibold text-base mb-1.5`}>
              All visits hidden by filters
            </h3>
            <p className={`${subColor} text-sm mb-5`}>
              {hiddenCount} {hiddenCount === 1 ? 'visit is' : 'visits are'} scheduled this {view} but
              hidden by your active filters.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium ${buttonPrimary}`}
            >
              Clear filters
            </button>
          </>
        ) : (
          <>
            <h3 className={`${headingColor} font-semibold text-base mb-1.5`}>
              Nothing scheduled this {view}
            </h3>
            <p className={`${subColor} text-sm mb-1`}>{rangeLabel}</p>
            <p className={`${mutedColor} text-xs mb-5`}>
              No participant visits are scheduled in this range.
            </p>
            {!isToday && (
              <button
                type="button"
                onClick={onJumpToToday}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium ${buttonSecondary}`}
              >
                Jump to today
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
