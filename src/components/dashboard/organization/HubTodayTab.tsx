import { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Clock,
  ClipboardList,
  ShieldCheck,
  Building2,
  AlertTriangle,
  ChevronRight,
  CheckCircle2,
  FileWarning,
  UserCheck,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { useUnreadMentionsDisplay } from '../../../context/UnreadMentionsContext';
import { useMode } from '../../../context/ModeContext';
import { useChatNavigation } from '../../../context/ChatNavigationContext';
import {
  listMyPendingDecisionAcks,
  listProtocolAccessRequests,
  type PendingAckRow,
} from '../../../lib/orgs/orgsApi';
import type {
  DashboardTab,
} from '../Dashboard';
import type { ProtocolAccessRequest } from '../../../types/orgs';
import type { SiteVisit } from '../../../lib/site/types';

// =============================================================================
// HubTodayTab — workspace hub's default tab.
//
// Layout: greeting + sub-line + stats row + mode tiles + today's visits +
// pending decision acks. Each list row has an action button that routes
// to the right surface (Site Mode visit drawer / Chat tab pre-focused on
// the decision).
//
// Mini-calendar + "happening now" hot row + overdue deviations land in
// follow-up polish PRs.
// =============================================================================

interface HubTodayTabProps {
  /** Called by mode-tile clicks to route the user into the chosen mode. */
  onChangeDashboardTab: (tab: DashboardTab) => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeek(d = new Date()): Date {
  const day = d.getDay();
  // Use Sunday as week start to match the existing TodayTab.
  const diff = -day;
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() + diff);
  return out;
}

function ymd(d: Date): string {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Parse a visit's freeform `time` field ("9:00 AM" / "14:30" / etc.) into
 *  minutes-since-midnight. Returns null when time is absent or unparseable
 *  — caller treats those as all-day events. */
function parseTimeToMinutes(time: string | undefined): number | null {
  if (!time) return null;
  const t = time.trim();
  let m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }
  m = t.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    const mm = Number(m[2]);
    if (h > 23 || mm > 59) return null;
    return h * 60 + mm;
  }
  return null;
}

/** Human label for how a "happening now" visit relates to current time —
 *  "started 12m ago" or "starts in 35m". */
function relativeMinutes(visitMinutes: number, nowMinutes: number): string {
  const diff = visitMinutes - nowMinutes;
  if (diff < 0) {
    const ago = -diff;
    return ago < 60 ? `started ${ago}m ago` : `started ${Math.round(ago / 60)}h ago`;
  }
  if (diff === 0) return 'starting now';
  return `starts in ${diff}m`;
}

export default function HubTodayTab({ onChangeDashboardTab }: HubTodayTabProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { profile } = useAuth();
  const { activeOrg } = useOrg();
  const { protocols } = useProtocol();
  const { visits } = useSiteData();
  const { count: mentionsCount } = useUnreadMentionsDisplay();
  const { setMode } = useMode();
  const { navigateToVisit, navigateToOrgChat } = useChatNavigation();

  const firstName = (profile?.name ?? '').split(/\s+/)[0] || 'there';
  const today = todayIso();

  const protocolCodeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of protocols) m.set(p.id, p.code);
    return m;
  }, [protocols]);

  // Visits this week — used for the blue stat callout.
  const visitsThisWeek = useMemo(() => {
    const start = startOfWeek();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return visits.filter((v) => {
      const d = new Date(v.date + 'T00:00:00');
      return d >= start && d < end;
    });
  }, [visits]);

  // Today's visits — used in the list section, sorted by time.
  const todaysVisits = useMemo(() => {
    return visits
      .filter((v) => v.date === today)
      .slice()
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }, [visits, today]);

  // Pending decision acks.
  const [pendingAcks, setPendingAcks] = useState<PendingAckRow[]>([]);
  useEffect(() => {
    let cancelled = false;
    listMyPendingDecisionAcks().then((res) => {
      if (cancelled) return;
      if (res.ok) setPendingAcks(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Pending access requests across the user's protocols. RLS gates the
  // returned rows so non-admins won't see anything actionable.
  const [pendingRequests, setPendingRequests] = useState<ProtocolAccessRequest[]>([]);
  useEffect(() => {
    if (protocols.length === 0) {
      setPendingRequests([]);
      return;
    }
    let cancelled = false;
    Promise.all(protocols.map((p) => listProtocolAccessRequests(p.id))).then(
      (results) => {
        if (cancelled) return;
        const all: ProtocolAccessRequest[] = [];
        for (const r of results) {
          if (r.ok) all.push(...r.data.filter((req) => req.status === 'pending'));
        }
        all.sort((a, b) => b.requested_at.localeCompare(a.requested_at));
        setPendingRequests(all);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [protocols]);

  // "Happening now" — visits today within ±60 min of current time.
  const nowMinutes = useMemo(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }, [todaysVisits]); // eslint-disable-line react-hooks/exhaustive-deps
  const happeningNow = useMemo(() => {
    const out: Array<{ visit: SiteVisit; minutes: number }> = [];
    for (const v of todaysVisits) {
      const m = parseTimeToMinutes(v.time);
      if (m === null) continue;
      const diff = Math.abs(m - nowMinutes);
      if (diff <= 60) out.push({ visit: v, minutes: m });
    }
    out.sort((a, b) => a.minutes - b.minutes);
    return out;
  }, [todaysVisits, nowMinutes]);

  // Overdue deviation sign-offs — visits in last 30d with status='deviation'
  // AND no deviationReason filled in (auditors flag these).
  const overdueDeviations = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffStr = ymd(cutoff);
    return visits
      .filter(
        (v) =>
          v.status === 'deviation' &&
          (!v.deviationReason || v.deviationReason.trim().length === 0) &&
          v.date >= cutoffStr,
      )
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 20);
  }, [visits]);

  // Week calendar — Sun..Sat strip. Event-density dots per day.
  const weekDays = useMemo(() => {
    const start = startOfWeek();
    return Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, []);
  const visitsByDate = useMemo(() => {
    const m = new Map<string, SiteVisit[]>();
    for (const v of visits) {
      const list = m.get(v.date) ?? [];
      list.push(v);
      m.set(v.date, list);
    }
    return m;
  }, [visits]);

  // Mode tile click — enters the mode + lands on a sensible tab.
  const enterMode = (target: 'site' | 'audit' | 'sponsor') => {
    if (target === 'sponsor') {
      onChangeDashboardTab('sponsor');
      return;
    }
    setMode(target);
    onChangeDashboardTab(target === 'site' ? 'today' : 'audit-overview');
  };

  // --- Styling tokens ----------------------------------------------------
  const tileBorderBase = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const cardBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const rowBg = isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]';

  // ----------------------------------------------------------------------

  return (
    <div className="space-y-5 max-w-5xl">
      {/* Greeting + sub-line */}
      <div>
        <h2 className="text-fg-heading text-lg font-semibold">
          Welcome back, {firstName}
        </h2>
        <p className="text-fg-sub text-xs mt-0.5">
          {protocols.length} protocol{protocols.length === 1 ? '' : 's'}
          {activeOrg ? ` · ${activeOrg.name}` : ''}
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div
          className="rounded-md p-3"
          style={{ backgroundColor: isLight ? '#E6F1FB' : 'rgba(53,138,221,0.12)' }}
        >
          <div
            className="text-lg font-semibold"
            style={{ color: isLight ? '#0C447C' : '#85B7EB' }}
          >
            {visitsThisWeek.length}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: isLight ? '#185FA5' : '#85B7EB' }}
          >
            visits this week
          </div>
        </div>
        <div
          className="rounded-md p-3"
          style={{ backgroundColor: isLight ? '#FAEEDA' : 'rgba(239,159,39,0.12)' }}
        >
          <div
            className="text-lg font-semibold"
            style={{ color: isLight ? '#854F0B' : '#EF9F27' }}
          >
            {mentionsCount}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: isLight ? '#BA7517' : '#EF9F27' }}
          >
            mentions waiting
          </div>
        </div>
        <div
          className="rounded-md p-3"
          style={{ backgroundColor: isLight ? '#E1F5EE' : 'rgba(29,158,117,0.12)' }}
        >
          <div
            className="text-lg font-semibold"
            style={{ color: isLight ? '#085041' : '#5DCAA5' }}
          >
            {pendingAcks.length}
          </div>
          <div
            className="text-[11px] mt-0.5"
            style={{ color: isLight ? '#0F6E56' : '#5DCAA5' }}
          >
            decisions need ack
          </div>
        </div>
      </div>

      {/* Mode tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => enterMode('site')}
          className={`text-left rounded-md p-3 border ${tileBorderBase} ${cardBg} hover:shadow-sm transition-shadow`}
          style={{ borderLeftColor: '#378ADD', borderLeftWidth: '3px' }}
        >
          <ClipboardList size={16} style={{ color: '#185FA5' }} className="mb-1.5" />
          <p className="text-fg-heading text-sm font-medium">Site mode</p>
          <p className="text-fg-sub text-[11px] mt-0.5">Today, visits, participants</p>
        </button>
        <button
          type="button"
          onClick={() => enterMode('audit')}
          className={`text-left rounded-md p-3 border ${tileBorderBase} ${cardBg} hover:shadow-sm transition-shadow`}
          style={{ borderLeftColor: '#1D9E75', borderLeftWidth: '3px' }}
        >
          <ShieldCheck size={16} style={{ color: '#0F6E56' }} className="mb-1.5" />
          <p className="text-fg-heading text-sm font-medium">Audit mode</p>
          <p className="text-fg-sub text-[11px] mt-0.5">Findings, questionnaires, risk</p>
        </button>
        <button
          type="button"
          onClick={() => enterMode('sponsor')}
          className={`text-left rounded-md p-3 border ${tileBorderBase} ${rowBg} hover:shadow-sm transition-shadow`}
          style={{ borderLeftColor: '#7F77DD', borderLeftWidth: '3px' }}
        >
          <Building2 size={16} style={{ color: '#534AB7' }} className="mb-1.5" />
          <p className="text-fg-heading text-sm font-medium">Sponsor mode</p>
          <p className="text-fg-sub text-[11px] mt-0.5">Cross-site roll-ups</p>
          <span
            className="inline-block text-[10px] px-2 py-0.5 rounded-full mt-1.5"
            style={{
              backgroundColor: isLight ? '#EEEDFE' : 'rgba(127,119,221,0.15)',
              color: isLight ? '#3C3489' : '#AFA9EC',
            }}
          >
            Coming soon
          </span>
        </button>
      </div>

      {/* 2-column layout: mini calendar on the left (lg+), stacked sections
          on the right. Below lg, both stack vertically with the calendar
          on top so phone users still see today's date context. */}
      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        {/* Mini calendar */}
        <aside className={`rounded-md border ${tileBorderBase} p-3 self-start`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-fg-heading text-xs font-semibold">
              {weekDays[3].toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1 text-center text-fg-muted text-[10px]">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {weekDays.map((d) => {
              const key = ymd(d);
              const isToday = key === today;
              const dayVisits = visitsByDate.get(key) ?? [];
              const hasDeviation = dayVisits.some((v) => v.status === 'deviation');
              const hasCompleted = dayVisits.some((v) => v.status === 'completed');
              const hasScheduled = dayVisits.some((v) => v.status === 'scheduled');
              return (
                <div
                  key={key}
                  className={`aspect-square rounded-md flex flex-col items-center justify-center text-[11px] ${
                    isToday
                      ? 'text-white font-semibold'
                      : isLight
                        ? 'hover:bg-[#0F172A]/[0.04]'
                        : 'hover:bg-white/[0.04]'
                  }`}
                  style={isToday ? { backgroundColor: '#378ADD' } : undefined}
                >
                  <span>{d.getDate()}</span>
                  <div className="flex gap-0.5 mt-0.5 h-1.5">
                    {hasScheduled && (
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: isToday ? 'white' : '#378ADD' }}
                      />
                    )}
                    {hasCompleted && (
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: isToday ? 'white' : '#1D9E75' }}
                      />
                    )}
                    {hasDeviation && (
                      <span
                        className="w-1 h-1 rounded-full"
                        style={{ backgroundColor: isToday ? 'white' : '#BA7517' }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className={`mt-3 pt-3 border-t ${tileBorderBase} space-y-1`}>
            <div className="flex items-center gap-1.5 text-fg-sub text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#378ADD' }} />
              Scheduled
            </div>
            <div className="flex items-center gap-1.5 text-fg-sub text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#1D9E75' }} />
              Completed
            </div>
            <div className="flex items-center gap-1.5 text-fg-sub text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#BA7517' }} />
              Deviation
            </div>
          </div>
        </aside>

        {/* Stacked sections */}
        <div className="space-y-5 min-w-0">
          {/* Happening now — coral highlighted, visits ±60min of current time */}
          {happeningNow.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    backgroundColor: '#D85A30',
                    boxShadow: '0 0 0 4px rgba(216, 90, 48, 0.18)',
                  }}
                  aria-hidden="true"
                />
                <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  Happening now
                </h3>
              </div>
              <div
                className={`rounded-md divide-y border`}
                style={{
                  borderColor: isLight ? '#F0997B' : 'rgba(216,90,48,0.3)',
                  backgroundColor: isLight ? '#FAECE7' : 'rgba(216,90,48,0.08)',
                }}
              >
                {happeningNow.map(({ visit: v, minutes }) => (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-20 flex-shrink-0">
                      <p
                        className="text-xs font-semibold"
                        style={{ color: isLight ? '#993C1D' : '#F0997B' }}
                      >
                        {v.time}
                      </p>
                      <p
                        className="text-[10px] mt-0.5"
                        style={{ color: isLight ? '#993C1D' : '#F0997B' }}
                      >
                        {relativeMinutes(minutes, nowMinutes)}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-fg-heading text-sm font-medium truncate">
                        {v.visitName} · {v.participantId}
                      </p>
                      <p className="text-fg-sub text-[11px] mt-0.5">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1.5"
                          style={{
                            backgroundColor: isLight ? '#E6F1FB' : 'rgba(53,138,221,0.15)',
                            color: isLight ? '#0C447C' : '#85B7EB',
                          }}
                        >
                          {protocolCodeById.get(v.protocolId) ?? 'protocol'}
                        </span>
                        Study day {v.studyDay}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToVisit(v.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md text-white"
                      style={{ backgroundColor: '#993C1D' }}
                    >
                      Open visit
                      <ChevronRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Today's visits */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <Calendar size={11} />
                Today's visits ({todaysVisits.length})
              </h3>
              <span className="text-fg-sub text-[11px]">
                {new Date().toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                })}
              </span>
            </div>
            {todaysVisits.length === 0 ? (
              <div className={`rounded-md border ${tileBorderBase} px-4 py-6 text-center`}>
                <p className="text-fg-body text-sm">Nothing scheduled today.</p>
                <p className="text-fg-sub text-xs mt-1">Visits across all your protocols.</p>
              </div>
            ) : (
              <div className={`rounded-md border ${tileBorderBase} divide-y ${tileBorderBase}`}>
                {todaysVisits.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="w-16 flex-shrink-0">
                      <p className="text-fg-heading text-xs font-semibold">{v.time ?? 'All day'}</p>
                      <p className="text-fg-muted text-[10px] mt-0.5 inline-flex items-center gap-0.5">
                        <Clock size={9} />
                        {v.status}
                      </p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-fg-heading text-sm font-medium truncate">
                        {v.visitName} · {v.participantId}
                      </p>
                      <p className="text-fg-sub text-[11px] mt-0.5 flex items-center gap-1.5">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium"
                          style={{
                            backgroundColor: isLight ? '#E6F1FB' : 'rgba(53,138,221,0.15)',
                            color: isLight ? '#0C447C' : '#85B7EB',
                          }}
                        >
                          {protocolCodeById.get(v.protocolId) ?? 'protocol'}
                        </span>
                        Study day {v.studyDay}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToVisit(v.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-brand-300 text-brand-300 hover:bg-brand-300/[0.08]"
                    >
                      Open
                      <ChevronRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pending decision acks */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
                <CheckCircle2 size={11} />
                Decisions awaiting your ack ({pendingAcks.length})
              </h3>
            </div>
            {pendingAcks.length === 0 ? (
              <div className={`rounded-md border ${tileBorderBase} px-4 py-6 text-center`}>
                <p className="text-fg-body text-sm">All caught up.</p>
                <p className="text-fg-sub text-xs mt-1">
                  You'll see decisions here when teammates ask for your sign-off.
                </p>
              </div>
            ) : (
              <div className={`rounded-md border ${tileBorderBase} divide-y ${tileBorderBase}`}>
                {pendingAcks.map((ack) => {
                  const channelKey: 'org' | `protocol:${string}` = ack.org_id
                    ? 'org'
                    : `protocol:${ack.protocol_id ?? ''}`;
                  const channelLabel = ack.org_id
                    ? '#general'
                    : `#${protocolCodeById.get(ack.protocol_id ?? '') ?? 'protocol'}`;
                  return (
                    <div key={ack.ack_id} className="flex items-center gap-3 px-3 py-2.5">
                      <AlertTriangle
                        size={14}
                        className={isLight ? 'text-amber-600' : 'text-amber-400'}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-fg-heading text-sm font-medium truncate">
                          {ack.decision_title}
                        </p>
                        <p className="text-fg-sub text-[11px] mt-0.5">
                          {channelLabel} · decided{' '}
                          {new Date(ack.decision_decided_at).toLocaleDateString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigateToOrgChat(channelKey)}
                        className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-brand-300 text-brand-300 hover:bg-brand-300/[0.08]"
                      >
                        Review
                        <ChevronRight size={11} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Overdue deviation sign-offs */}
          {overdueDeviations.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <FileWarning size={11} style={{ color: '#BA7517' }} />
                <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  Overdue deviation sign-offs ({overdueDeviations.length})
                </h3>
              </div>
              <div className={`rounded-md border ${tileBorderBase} divide-y ${tileBorderBase}`}>
                {overdueDeviations.map((v) => (
                  <div key={v.id} className="flex items-center gap-3 px-3 py-2.5">
                    <FileWarning
                      size={14}
                      className="flex-shrink-0"
                      style={{ color: '#BA7517' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-fg-heading text-sm font-medium truncate">
                        {v.visitName} · {v.participantId}
                      </p>
                      <p className="text-fg-sub text-[11px] mt-0.5">
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mr-1.5"
                          style={{
                            backgroundColor: isLight ? '#E6F1FB' : 'rgba(53,138,221,0.15)',
                            color: isLight ? '#0C447C' : '#85B7EB',
                          }}
                        >
                          {protocolCodeById.get(v.protocolId) ?? 'protocol'}
                        </span>
                        Deviation logged {new Date(v.date).toLocaleDateString()} — no reason yet
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigateToVisit(v.id)}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md text-white"
                      style={{ backgroundColor: '#BA7517' }}
                    >
                      Sign off
                      <ChevronRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pending access requests */}
          {pendingRequests.length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-2">
                <UserCheck size={11} />
                <h3 className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                  Pending access requests ({pendingRequests.length})
                </h3>
              </div>
              <div className={`rounded-md border ${tileBorderBase} divide-y ${tileBorderBase}`}>
                {pendingRequests.map((req) => (
                  <div key={req.id} className="flex items-center gap-3 px-3 py-2.5">
                    <UserCheck size={14} className="flex-shrink-0 text-fg-sub" />
                    <div className="flex-1 min-w-0">
                      <p className="text-fg-heading text-sm font-medium truncate">
                        Access request · {protocolCodeById.get(req.protocol_id) ?? 'protocol'}
                      </p>
                      <p className="text-fg-sub text-[11px] mt-0.5">
                        Requested {new Date(req.requested_at).toLocaleDateString()}
                        {req.message ? ` · "${req.message}"` : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        // Route to OrganizationPage → Manage tab where the
                        // actual approve/deny controls live.
                        try {
                          localStorage.setItem('piq-org-tab-v1', 'manage');
                        } catch {
                          /* ignore */
                        }
                        onChangeDashboardTab('organization');
                      }}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md border border-brand-300 text-brand-300 hover:bg-brand-300/[0.08]"
                    >
                      Review in Manage
                      <ChevronRight size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
