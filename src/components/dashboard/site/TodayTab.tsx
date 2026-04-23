import { AlertCircle, Clock, Calendar, CheckCircle2, FileWarning, ChevronRight } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol, type Protocol } from '../../../context/ProtocolContext';
import { useAuth } from '../../../context/AuthContext';

type Urgency = 'overdue' | 'warning' | 'today' | 'upcoming' | 'followup';

interface NextUpItem {
  id: string;
  urgency: Urgency;
  timing: string;
  protocolCode: string;
  participant: string;
  action: string;
}

interface ProtocolStats {
  enrolled: number;
  target: number;
  visitsToday: number;
  openDeviations: number;
  nextVisit?: string;
}

const NEXT_UP: NextUpItem[] = [
  { id: '1', urgency: 'overdue', timing: '2d overdue', protocolCode: 'BRIGHTEN-2', participant: 'P-0045', action: 'Week 4 follow-up visit' },
  { id: '2', urgency: 'warning', timing: 'Closes in 4h', protocolCode: 'CARDIAC-7', participant: 'P-0012', action: 'Day 14 visit window' },
  { id: '3', urgency: 'today', timing: 'Today 2:00 PM', protocolCode: 'BRIGHTEN-2', participant: 'P-0023', action: 'Screening visit' },
  { id: '4', urgency: 'today', timing: 'Today 3:30 PM', protocolCode: 'IMMUNE-14', participant: 'P-0031', action: 'Dose administration' },
  { id: '5', urgency: 'upcoming', timing: 'Tomorrow 9:00 AM', protocolCode: 'BRIGHTEN-2', participant: 'P-0019', action: 'Week 2 visit' },
  { id: '6', urgency: 'followup', timing: 'Follow-up', protocolCode: 'BRIGHTEN-2', participant: '—', action: 'Deviation 4/19 · PI sign-off' },
  { id: '7', urgency: 'followup', timing: 'Follow-up', protocolCode: 'CARDIAC-7', participant: 'P-0008', action: 'Adverse event report due' },
];

const PROTOCOL_STATS: Record<string, ProtocolStats> = {
  'proto-001': { enrolled: 24, target: 50, visitsToday: 3, openDeviations: 1 },
  'proto-002': { enrolled: 18, target: 30, visitsToday: 1, openDeviations: 0 },
  'proto-003': { enrolled: 7, target: 12, visitsToday: 0, openDeviations: 0, nextVisit: 'tomorrow' },
};

const URGENCY_ORDER: Record<Urgency, number> = {
  overdue: 0,
  warning: 1,
  today: 2,
  upcoming: 3,
  followup: 4,
};

function urgencyIcon(urgency: Urgency, isLight: boolean) {
  const colors: Record<Urgency, string> = {
    overdue: 'text-red-500',
    warning: 'text-amber-500',
    today: isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]',
    upcoming: isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/45',
    followup: isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/45',
  };
  const icon = {
    overdue: AlertCircle,
    warning: Clock,
    today: Calendar,
    upcoming: Calendar,
    followup: FileWarning,
  }[urgency];
  const Icon = icon;
  return <Icon size={15} className={colors[urgency]} />;
}

function formatDate(): string {
  const now = new Date();
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function TodayTab() {
  const { theme } = useTheme();
  const { activeProtocol, protocols, setActiveProtocol } = useProtocol();
  const { user } = useAuth();
  const isLight = theme === 'light';

  const isHome = activeProtocol === null;

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const rowHover = isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.02]';
  const rowDivide = isLight ? 'divide-[#f0f4f8]' : 'divide-white/[0.03]';
  const progressTrack = isLight ? 'bg-[#eef2f6]' : 'bg-white/[0.06]';
  const accent = isLight ? 'bg-[#4a6fa5]' : 'bg-[#6e8fb5]';
  const sectionHeader = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/45';

  const displayName = (user?.user_metadata?.full_name as string)?.split(' ')[0] ?? user?.email?.split('@')[0] ?? 'there';

  const nextUp = isHome
    ? [...NEXT_UP].sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency])
    : NEXT_UP.filter((i) => i.protocolCode === activeProtocol.code).sort(
        (a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]
      );

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Greeting */}
      <div>
        <h2 className={`${headingColor} font-semibold text-xl mb-1`}>
          {greeting()}, {displayName}
        </h2>
        <p className={`${subColor} text-sm`}>
          {formatDate()}
          {!isHome && <span className={mutedColor}> · Viewing {activeProtocol.code}</span>}
        </p>
      </div>

      {/* Next Up */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${sectionHeader} text-[11px] uppercase tracking-wider font-semibold`}>Next up</h3>
          {nextUp.length > 0 && (
            <span className={`${mutedColor} text-xs`}>{nextUp.length} items</span>
          )}
        </div>
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          {nextUp.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 className={`mx-auto mb-2 ${isLight ? 'text-[#4a6fa5]/50' : 'text-[#6e8fb5]/50'}`} size={24} />
              <p className={`${subColor} text-sm`}>You're all caught up.</p>
            </div>
          ) : (
            <div className={`divide-y ${rowDivide}`}>
              {nextUp.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full text-left px-5 py-3.5 flex items-center gap-3 ${rowHover} transition-colors`}
                >
                  <div className="flex-shrink-0">{urgencyIcon(item.urgency, isLight)}</div>
                  <div className={`flex-shrink-0 text-xs font-medium min-w-[110px] ${
                    item.urgency === 'overdue'
                      ? 'text-red-500'
                      : item.urgency === 'warning'
                      ? 'text-amber-500'
                      : isLight
                      ? 'text-[#374152]/65'
                      : 'text-[#d2d7e0]/55'
                  }`}>
                    {item.timing}
                  </div>
                  <div className="flex-1 min-w-0 flex items-center gap-2 text-sm">
                    {isHome && (
                      <span className={`flex-shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded ${isLight ? 'bg-[#eef2f6] text-[#4a6fa5]' : 'bg-white/[0.06] text-[#6e8fb5]'}`}>
                        {item.protocolCode}
                      </span>
                    )}
                    <span className={`flex-shrink-0 text-xs ${mutedColor}`}>{item.participant}</span>
                    <span className={`${isLight ? 'text-[#1a1f28]/85' : 'text-[#d2d7e0]/85'} truncate`}>
                      {item.action}
                    </span>
                  </div>
                  <ChevronRight size={14} className={`flex-shrink-0 ${mutedColor}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Active protocols (Home) OR Protocol summary (scoped) */}
      {isHome ? (
        <section>
          <h3 className={`${sectionHeader} text-[11px] uppercase tracking-wider font-semibold mb-3`}>
            Active protocols
          </h3>
          <div className={`${cardBg} border rounded-xl overflow-hidden`}>
            <div className={`divide-y ${rowDivide}`}>
              {protocols.map((p) => {
                const stats = PROTOCOL_STATS[p.id];
                const pct = stats ? Math.round((stats.enrolled / stats.target) * 100) : 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setActiveProtocol(p)}
                    className={`w-full text-left px-5 py-4 ${rowHover} transition-colors group`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`${headingColor} font-semibold text-sm`}>{p.code}</span>
                          <span className={`${mutedColor} text-xs`}>·</span>
                          <span className={`${subColor} text-xs`}>{p.sponsor}</span>
                          <span className={`${mutedColor} text-xs`}>·</span>
                          <span className={`${subColor} text-xs`}>{p.phase}</span>
                        </div>
                        {stats && (
                          <div className={`${subColor} text-xs mt-1 flex items-center gap-3 flex-wrap`}>
                            {stats.visitsToday > 0 && (
                              <span>{stats.visitsToday} {stats.visitsToday === 1 ? 'visit' : 'visits'} today</span>
                            )}
                            {stats.openDeviations > 0 && (
                              <span className="text-amber-500">
                                {stats.openDeviations} open {stats.openDeviations === 1 ? 'deviation' : 'deviations'}
                              </span>
                            )}
                            {stats.nextVisit && stats.visitsToday === 0 && (
                              <span>Next visit {stats.nextVisit}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight
                        size={16}
                        className={`flex-shrink-0 ${mutedColor} group-hover:translate-x-0.5 transition-transform`}
                      />
                    </div>
                    {stats && (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className={`${mutedColor} text-[11px] uppercase tracking-wider font-medium`}>
                            Enrollment
                          </span>
                          <span className={`${subColor} text-xs font-medium`}>
                            {stats.enrolled} / {stats.target}
                          </span>
                        </div>
                        <div className={`h-1.5 rounded-full overflow-hidden ${progressTrack}`}>
                          <div
                            className={`h-full ${accent} transition-all`}
                            style={{ width: `${Math.min(pct, 100)}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </section>
      ) : (
        <ProtocolSummary protocol={activeProtocol} />
      )}
    </div>
  );
}

interface ProtocolSummaryProps {
  protocol: Protocol;
}

function ProtocolSummary({ protocol }: ProtocolSummaryProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const stats = PROTOCOL_STATS[protocol.id];
  if (!stats) return null;

  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const progressTrack = isLight ? 'bg-[#eef2f6]' : 'bg-white/[0.06]';
  const accent = isLight ? 'bg-[#4a6fa5]' : 'bg-[#6e8fb5]';
  const sectionHeader = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/45';
  const statCardBg = isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/5';

  const pct = Math.round((stats.enrolled / stats.target) * 100);

  return (
    <section>
      <h3 className={`${sectionHeader} text-[11px] uppercase tracking-wider font-semibold mb-3`}>
        Protocol summary
      </h3>
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${headingColor} font-semibold text-base`}>{protocol.code}</span>
            <span className={`${mutedColor} text-xs`}>·</span>
            <span className={`${subColor} text-xs`}>{protocol.sponsor}</span>
            <span className={`${mutedColor} text-xs`}>·</span>
            <span className={`${subColor} text-xs`}>{protocol.phase}</span>
          </div>
          <p className={`${subColor} text-sm`}>{protocol.name}</p>
        </div>

        <div className="mb-5">
          <div className="flex items-center justify-between mb-1.5">
            <span className={`${mutedColor} text-[11px] uppercase tracking-wider font-medium`}>
              Enrollment
            </span>
            <span className={`${subColor} text-xs font-medium`}>
              {stats.enrolled} of {stats.target} · {pct}%
            </span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${progressTrack}`}>
            <div className={`h-full ${accent}`} style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className={`${statCardBg} border rounded-lg p-3`}>
            <p className={`${mutedColor} text-[11px] uppercase tracking-wider font-medium mb-1`}>
              Visits today
            </p>
            <p className={`${headingColor} text-lg font-semibold`}>{stats.visitsToday}</p>
          </div>
          <div className={`${statCardBg} border rounded-lg p-3`}>
            <p className={`${mutedColor} text-[11px] uppercase tracking-wider font-medium mb-1`}>
              Open deviations
            </p>
            <p className={`text-lg font-semibold ${stats.openDeviations > 0 ? 'text-amber-500' : headingColor}`}>
              {stats.openDeviations}
            </p>
          </div>
          <div className={`${statCardBg} border rounded-lg p-3`}>
            <p className={`${mutedColor} text-[11px] uppercase tracking-wider font-medium mb-1`}>
              Enrolled
            </p>
            <p className={`${headingColor} text-lg font-semibold`}>{stats.enrolled}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
