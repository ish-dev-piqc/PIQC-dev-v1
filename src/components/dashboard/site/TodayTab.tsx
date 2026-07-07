import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Filter,
  CalendarDays,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { useDemoMode } from '../../../context/DemoModeContext';
import SiteWelcomePanel from './SiteWelcomePanel';
import TodayFreshnessBanner from './TodayFreshnessBanner';
import AuditSignalsBanner from './AuditSignalsBanner';
import { useAuth } from '../../../context/AuthContext';
import VisitDetailDrawer from './VisitDetailDrawer';
import { fetchVisitTemplates, materializeVisits } from '../../../lib/site/siteApi';
import AnchorDateModal from './AnchorDateModal';
import type { SiteVisit } from '../../../lib/site/types';
import { Info } from 'lucide-react';
import ProtocolDetailDrawer from './ProtocolDetailDrawer';
import {
  formatYmd,
  parseYmd,
  startOfDay,
  startOfWeek,
  startOfMonth,
  addDays,
  addMonths,
  formatFullDate,
  formatMonth,
  formatWeekRange,
  isCertExpired,
  isCertExpiringSoon,
  daysUntilCertExpiry,
} from '../../../lib/site/dateUtils';
import type { FilterState, ViewMode } from './todayCalendarShared';
import { CertExpiryBand } from './CertExpiryBand';
import { NeedsAttentionBand } from './NeedsAttentionBand';
import { CalendarFilters } from './CalendarFilters';
import { WeekView } from './WeekView';
import { MonthView } from './MonthView';
import { DayDetailDrawer } from './DayDetailDrawer';
import { CalendarEmptyBanner } from './CalendarEmptyBanner';

// ────────────────────────────────────────────────────────────────────────────
// TodayTab-only helpers — date utilities live in src/lib/site/dateUtils.ts
// ────────────────────────────────────────────────────────────────────────────

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ────────────────────────────────────────────────────────────────────────────
// Filter state (persisted)
// ────────────────────────────────────────────────────────────────────────────

const FILTER_STORAGE_KEY = 'piq-today-filters-v1';

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
// Main component
// ────────────────────────────────────────────────────────────────────────────

interface TodayTabProps {
  onNavigateToVisits?: () => void;
  onNavigateToTeam?: () => void;
}

export default function TodayTab({ onNavigateToVisits, onNavigateToTeam }: TodayTabProps = {}) {
  const { theme } = useTheme();
  const { activeProtocol, protocols, isLoading: protocolsLoading } = useProtocol();
  const { demoActive } = useDemoMode();
  const { visits: allSiteVisits, participants: allSiteParticipants, teamMembers: allSiteTeam, documents, loading, refresh } = useSiteData();
  const { user } = useAuth();
  const isLight = theme === 'light';
  const isHome = activeProtocol === null;

  const today = useMemo(() => startOfDay(new Date()), []);

  const [view, setView] = useState<ViewMode>('week');
  const [anchorDate, setAnchorDate] = useState<Date>(today);
  const [filters, setFilters] = useState<FilterState>(() => loadFilters());
  const [openVisit, setOpenVisit] = useState<SiteVisit | null>(null);
  const [openDay, setOpenDay] = useState<Date | null>(null);
  const [filterPanelOpen, setFilterPanelOpen] = useState<boolean>(true);

  // Keep the open drawer in sync with realtime refreshes — the click handler
  // captures the visit object as it was at click time, but SiteDataContext
  // rebuilds the visits array on every refresh. Look the row back up by id:
  // replace the snapshot when the reference changed (refresh only fires on
  // real events, and once replaced `fresh === openVisit`, so this can't
  // loop), and close the drawer when the visit disappeared (deleted or
  // cancelled elsewhere).
  useEffect(() => {
    if (!openVisit) return;
    const fresh = allSiteVisits.find((v) => v.id === openVisit.id);
    if (!fresh) {
      setOpenVisit(null);
    } else if (fresh !== openVisit) {
      setOpenVisit(fresh);
    }
  }, [allSiteVisits, openVisit]);

  // --- Freshness banner ---------------------------------------------------
  // Snapshot the ID set of currently-loaded visits + participants on first
  // non-empty load; whenever the live id sets grow past the snapshot,
  // surface a "N new since you opened this tab" banner. Dismiss
  // re-snapshots to current. Reset on protocol switch so each scope gets
  // its own baseline.
  const [baselineVisitIds, setBaselineVisitIds] = useState<Set<string> | null>(null);
  const [baselineParticipantIds, setBaselineParticipantIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    // Re-baseline on protocol change so the user doesn't see "37 new visits"
    // when switching from a quiet protocol to a busy one.
    setBaselineVisitIds(null);
    setBaselineParticipantIds(null);
  }, [activeProtocol?.id]);

  useEffect(() => {
    if (baselineVisitIds === null && allSiteVisits.length > 0) {
      setBaselineVisitIds(new Set(allSiteVisits.map((v) => v.id)));
    }
  }, [baselineVisitIds, allSiteVisits]);

  useEffect(() => {
    if (baselineParticipantIds === null && allSiteParticipants.length > 0) {
      setBaselineParticipantIds(new Set(allSiteParticipants.map((p) => p.id)));
    }
  }, [baselineParticipantIds, allSiteParticipants]);

  const newVisitCount = useMemo(() => {
    if (!baselineVisitIds) return 0;
    let n = 0;
    for (const v of allSiteVisits) if (!baselineVisitIds.has(v.id)) n++;
    return n;
  }, [allSiteVisits, baselineVisitIds]);

  const newParticipantCount = useMemo(() => {
    if (!baselineParticipantIds) return 0;
    let n = 0;
    for (const p of allSiteParticipants) if (!baselineParticipantIds.has(p.id)) n++;
    return n;
  }, [allSiteParticipants, baselineParticipantIds]);

  const dismissFreshness = () => {
    setBaselineVisitIds(new Set(allSiteVisits.map((v) => v.id)));
    setBaselineParticipantIds(new Set(allSiteParticipants.map((p) => p.id)));
  };

  // Phase E: detect templates extracted but not yet projected — show a banner
  // pointing the user at Set anchor / Re-project.
  const [templateCount, setTemplateCount] = useState(0);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  const [reprojecting, setReprojecting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    if (!activeProtocol) {
      setTemplateCount(0);
      return;
    }
    let cancelled = false;
    fetchVisitTemplates(activeProtocol.id).then((r) => {
      if (cancelled) return;
      setTemplateCount(r.ok ? r.data.length : 0);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  // Scope visits by current protocol (scoped mode drops other protocols).
  const scopedVisits = useMemo(() => {
    if (isHome) return allSiteVisits;
    return allSiteVisits.filter((v) => v.protocolId === activeProtocol.id);
  }, [isHome, activeProtocol, allSiteVisits]);

  // Per-protocol participant rosters for the filter panel — derived from live
  // site_participants instead of the old hardcoded PROTOCOL_PARTICIPANTS map.
  const participantsByProtocol = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const p of allSiteParticipants) {
      const arr = map.get(p.protocol_id) ?? [];
      if (!arr.includes(p.id)) arr.push(p.id);
      map.set(p.protocol_id, arr);
    }
    return map;
  }, [allSiteParticipants]);

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
    const map = new Map<string, SiteVisit[]>();
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

  // Team-member certification alerts — scoped the same way as visits. Hidden
  // protocols filter out their members. Inactive members are skipped because
  // they're already off the delegation log.
  const certAlerts = useMemo(() => {
    const hiddenProtos = new Set(filters.hiddenProtocols);
    const scope = isHome
      ? allSiteTeam.filter((m) => !hiddenProtos.has(m.protocol_id))
      : allSiteTeam.filter((m) => m.protocol_id === activeProtocol?.id);
    return scope
      .filter((m) => m.status === 'ACTIVE' && m.certified_through)
      .filter((m) => isCertExpired(m.certified_through) || isCertExpiringSoon(m.certified_through))
      .sort((a, b) => daysUntilCertExpiry(a.certified_through) - daysUntilCertExpiry(b.certified_through));
  }, [allSiteTeam, filters.hiddenProtocols, isHome, activeProtocol]);

  // Compute the date range for the current view, for empty-state detection.
  const viewRange = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(anchorDate);
      return { start, end: addDays(start, 6) };
    }
    const gridStart = startOfWeek(startOfMonth(anchorDate));
    return { start: gridStart, end: addDays(gridStart, 41) };
  }, [view, anchorDate]);

  const isInRange = useCallback(
    (v: SiteVisit) => {
      const d = parseYmd(v.date);
      return d >= viewRange.start && d <= viewRange.end;
    },
    [viewRange],
  );

  const visibleInRange = useMemo(() => visibleVisits.filter(isInRange), [visibleVisits, isInRange]);
  const scopedInRange = useMemo(() => scopedVisits.filter(isInRange), [scopedVisits, isInRange]);

  const isEmptyRange = visibleInRange.length === 0;
  const isFilteredEmpty = isEmptyRange && scopedInRange.length > 0;

  // A3: same pending/failed-parse derivation as VisitExecutionTab, so the
  // "no visits scheduled" banner doesn't read as a user error while a
  // protocol document is still being parsed (or failed to parse).
  const pendingDoc = useMemo(
    () => documents.find((d) => d.status === 'pending'),
    [documents],
  );
  const failedDoc = useMemo(
    () => documents.find((d) => d.status === 'failed'),
    [documents],
  );
  const docStatus: 'pending' | 'failed' | null = pendingDoc
    ? 'pending'
    : failedDoc
    ? 'failed'
    : null;

  const clearFilters = () => setFilters({ hiddenProtocols: [], hiddenParticipants: [] });

  // Theme tokens.
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';

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

  // First-run state: user is in real mode (not demo), has no protocols
  // anywhere, and the Home/All-protocols scope is active. Replace the empty
  // calendar with the welcome panel. While protocols are still loading we
  // don't know yet whether the user is genuinely zero-protocol, so render
  // nothing here — Dashboard.tsx's own onboarding gate already waits for
  // loading to finish before deciding what a zero-protocol user sees, and
  // rendering the welcome panel here first would flash it even for users
  // who do have protocols.
  if (protocolsLoading && isHome) {
    return null;
  }
  if (!demoActive && protocols.length === 0 && isHome) {
    return <SiteWelcomePanel />;
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Greeting */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        {!isHome && (
          <div className="mb-3">
            <AuditSignalsBanner protocolId={activeProtocol.id} />
          </div>
        )}
        {(newVisitCount > 0 || newParticipantCount > 0) && (
          <div className="mb-3">
            <TodayFreshnessBanner
              newVisitCount={newVisitCount}
              newParticipantCount={newParticipantCount}
              onDismiss={dismissFreshness}
            />
          </div>
        )}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className={`${headingColor} font-semibold text-xl mb-1`}>
              {greeting()}, {displayName}
            </h2>
            <p className={`${subColor} text-sm`}>
              {formatFullDate(today)}
              {!isHome && (
                <span className={`${mutedColor} inline-flex items-center gap-1`}>
                  {' '}· Viewing {activeProtocol.code}
                  <button
                    type="button"
                    onClick={() => setDetailOpen(true)}
                    className="opacity-60 hover:opacity-100"
                    aria-label="Protocol details"
                    title="Protocol details"
                  >
                    <Info size={11} />
                  </button>
                </span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Cert-expiry band */}
      {certAlerts.length > 0 && (
        <CertExpiryBand
          items={certAlerts}
          isLight={isLight}
          onClick={onNavigateToTeam}
        />
      )}

      {/* Needs Attention band */}
      {needsAttention.length > 0 && (
        <NeedsAttentionBand
          items={needsAttention}
          isLight={isLight}
          isHome={isHome}
          protocols={protocols}
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
                ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border-white/5 text-[#CBD5E1]/65 hover:bg-white/[0.02]'
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
                ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border-white/5 text-[#CBD5E1]/65 hover:bg-white/[0.02]'
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
                ? 'bg-white border-[#E2E8F0] text-[#334155]/75 hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border-white/5 text-[#CBD5E1]/75 hover:bg-white/[0.02]'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleNext}
            className={`inline-flex items-center justify-center w-8 h-8 rounded-lg border ${
              isLight
                ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border-white/5 text-[#CBD5E1]/65 hover:bg-white/[0.02]'
            }`}
            aria-label="Next"
          >
            <ChevronRight size={16} />
          </button>
          <div className={`ml-2 text-sm font-medium ${headingColor}`}>
            {view === 'week' ? formatWeekRange(startOfWeek(anchorDate)) : formatMonth(anchorDate)}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div
            className={`inline-flex items-center rounded-lg border p-0.5 ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
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
                        ? 'bg-[#F2F2F2] text-[#0F172A]'
                        : 'bg-white/[0.06] text-white'
                      : isLight
                      ? 'text-[#334155]/65 hover:text-[#0F172A]'
                      : 'text-[#CBD5E1]/55 hover:text-white'
                  }`}
                >
                  {v}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Phase E: schedule-extracted-but-not-projected banner */}
      {!isHome && templateCount > 0 && !activeProtocol.demoAnchorDate && (
        <div
          className={`mx-6 mt-3 flex items-start gap-2 border rounded-md px-3 py-2 ${
            isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-500/[0.06] border-amber-500/20'
          }`}
        >
          <AlertCircle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0 text-xs">
            <p className={isLight ? 'text-amber-800 font-medium' : 'text-amber-300 font-medium'}>
              {templateCount} visit template{templateCount === 1 ? '' : 's'} extracted from PDF — visits not projected yet
            </p>
            <p className={isLight ? 'text-amber-700/85' : 'text-amber-300/75'}>
              Set the Day 0 calendar date to populate the calendar.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowAnchorModal(true)}
            className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white ${
              isLight ? 'bg-amber-600 hover:bg-amber-700' : 'bg-amber-500 hover:bg-amber-400'
            }`}
          >
            Set anchor
          </button>
        </div>
      )}

      {/* Phase E: anchor set + templates exist — quick re-project shortcut */}
      {!isHome && templateCount > 0 && activeProtocol.demoAnchorDate && scopedVisits.length === 0 && (
        <div
          className={`mx-6 mt-3 flex items-start gap-2 border rounded-md px-3 py-2 ${
            isLight ? 'bg-brand-600/[0.05] border-brand-600/20' : 'bg-brand-300/[0.06] border-brand-300/25'
          }`}
        >
          <CalendarDays size={13} className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-brand-600' : 'text-brand-300'}`} />
          <div className="flex-1 min-w-0 text-xs">
            <p className="text-fg-heading font-medium">
              Templates and anchor set, but no visits projected yet
            </p>
            <p className={`${isLight ? 'text-[#334155]/65' : 'text-[#CBD5E1]/55'}`}>
              Click re-project to populate visits for every enrolled participant.
            </p>
          </div>
          <button
            type="button"
            disabled={reprojecting}
            onClick={async () => {
              setReprojecting(true);
              const r = await materializeVisits(activeProtocol.id);
              setReprojecting(false);
              if (r.ok) refresh();
            }}
            className={`flex-shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-md text-white disabled:opacity-50 ${
              isLight ? 'bg-brand-600 hover:bg-brand-800' : 'bg-brand-300 hover:bg-brand-400'
            }`}
          >
            {reprojecting ? 'Projecting…' : 'Re-project'}
          </button>
        </div>
      )}


      {/* Main calendar row */}
      <div className="flex-1 flex gap-4 px-6 pb-6 min-h-0 overflow-hidden">
        {/* Filters */}
        <CalendarFilters
          isLight={isLight}
          isHome={isHome}
          protocols={protocols}
          activeProtocolId={activeProtocol?.id ?? null}
          filters={filters}
          participantsByProtocol={participantsByProtocol}
          onToggleProtocol={toggleProtocol}
          onToggleParticipant={toggleParticipant}
          open={filterPanelOpen}
          onClose={() => setFilterPanelOpen(false)}
        />

        {/* Calendar — always render the grid so the user can see the
            week/month structure; surface empty/filtered states as a compact
            banner above it instead of replacing the calendar. */}
        <div className={`flex-1 min-w-0 ${cardBg} border rounded-xl overflow-hidden flex flex-col`}>
          {isEmptyRange && !loading && (
            <CalendarEmptyBanner
              isLight={isLight}
              view={view}
              filtered={isFilteredEmpty}
              hiddenCount={scopedInRange.length}
              onClearFilters={clearFilters}
              docStatus={isHome ? null : docStatus}
            />
          )}
          {view === 'week' ? (
            <WeekView
              isLight={isLight}
              isHome={isHome}
              anchorDate={anchorDate}
              today={today}
              visitsByDate={visitsByDate}
              protocols={protocols}
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
              protocols={protocols}
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
          protocols={protocols}
          onClose={() => setOpenDay(null)}
          onVisitClick={(v) => {
            setOpenDay(null);
            setOpenVisit(v);
          }}
        />
      )}
      {openVisit && (
        <VisitDetailDrawer
          visit={openVisit}
          protocols={protocols}
          today={today}
          onClose={() => setOpenVisit(null)}
          onNavigateToVisits={onNavigateToVisits}
        />
      )}

      {showAnchorModal && activeProtocol && (
        <AnchorDateModal
          protocolId={activeProtocol.id}
          protocolCode={activeProtocol.code}
          initialDate={activeProtocol.demoAnchorDate}
          initialTimezone={activeProtocol.timezone}
          onSaved={() => refresh()}
          onClose={() => setShowAnchorModal(false)}
        />
      )}
      <ProtocolDetailDrawer
        protocolId={detailOpen && activeProtocol ? activeProtocol.id : null}
        protocolCode={activeProtocol?.code ?? null}
        protocolTitle={activeProtocol?.name ?? null}
        protocolSponsor={activeProtocol?.sponsor ?? null}
        onClose={() => setDetailOpen(false)}
      />
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
