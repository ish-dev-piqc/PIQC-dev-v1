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
  type PendingAckRow,
} from '../../../lib/orgs/orgsApi';
import type { DashboardTab } from '../Dashboard';

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
    </div>
  );
}
