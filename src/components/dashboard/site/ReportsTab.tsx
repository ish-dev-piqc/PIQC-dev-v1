import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Calendar,
  Users,
  Download,
  TrendingUp,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  MOCK_VISITS,
  PROTOCOL_COLORS,
  type CalendarVisit,
} from '../../../lib/mockCalendarData';
import {
  MOCK_PARTICIPANTS,
} from '../../../lib/mockSiteData';
import VisitDetailDrawer from './VisitDetailDrawer';

// =============================================================================
// ReportsTab — Site Mode summary metrics, protocol compliance, deviation log.
//
// Works in cross-protocol ("All protocols") and single-protocol scope.
// Mock-backed; real data lands with Supabase wire-up.
// =============================================================================

export default function ReportsTab({ onNavigateToVisits }: { onNavigateToVisits?: () => void } = {}) {
  const { theme } = useTheme();
  const { activeProtocol, protocols } = useProtocol();
  const isLight = theme === 'light';
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => today.toISOString().slice(0, 10), [today]);
  const [selectedVisit, setSelectedVisit] = useState<CalendarVisit | null>(null);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const rowBorder = isLight ? 'border-[#f0f3f6]' : 'border-white/[0.04]';
  const pageBg = isLight ? 'bg-[#f5f7fa]' : 'bg-[#0d1118]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';

  const scopedVisits = useMemo(() => {
    if (!activeProtocol) return MOCK_VISITS;
    return MOCK_VISITS.filter((v) => v.protocolId === activeProtocol.id);
  }, [activeProtocol]);

  const scopedParticipants = useMemo(() => {
    if (!activeProtocol) return MOCK_PARTICIPANTS;
    return MOCK_PARTICIPANTS.filter((p) => p.protocol_id === activeProtocol.id);
  }, [activeProtocol]);

  const stats = useMemo(() => {
    const concluded = scopedVisits.filter((v) =>
      ['completed', 'missed', 'deviation'].includes(v.status),
    );
    const completed = concluded.filter((v) => v.status === 'completed').length;
    const missed = concluded.filter((v) => v.status === 'missed').length;
    const deviations = concluded.filter((v) => v.status === 'deviation').length;
    const activeParticipants = scopedParticipants.filter(
      (p) => p.status === 'ACTIVE',
    ).length;
    const openDeviations = scopedParticipants.reduce(
      (sum, p) => sum + p.open_deviations,
      0,
    );
    const complianceRate =
      concluded.length > 0
        ? Math.round((completed / concluded.length) * 100)
        : null;
    const upcoming = scopedVisits.filter(
      (v) => v.status === 'scheduled' && v.date >= todayStr,
    ).length;
    return {
      completed,
      missed,
      deviations,
      activeParticipants,
      openDeviations,
      complianceRate,
      upcoming,
      concluded: concluded.length,
    };
  }, [scopedVisits, scopedParticipants, todayStr]);

  const protocolRows = useMemo(
    () =>
      protocols.map((p) => {
        const pv = MOCK_VISITS.filter((v) => v.protocolId === p.id);
        const concluded = pv.filter((v) =>
          ['completed', 'missed', 'deviation'].includes(v.status),
        );
        const completed = concluded.filter((v) => v.status === 'completed').length;
        const missed = concluded.filter((v) => v.status === 'missed').length;
        const deviation = concluded.filter((v) => v.status === 'deviation').length;
        const enrolled = MOCK_PARTICIPANTS.filter(
          (pt) =>
            pt.protocol_id === p.id &&
            ['ACTIVE', 'COMPLETED'].includes(pt.status),
        ).length;
        const rate =
          concluded.length > 0
            ? Math.round((completed / concluded.length) * 100)
            : null;
        return { protocol: p, enrolled, completed, missed, deviation, rate, total: concluded.length };
      }),
    [protocols],
  );

  const deviationLog = useMemo(
    () =>
      scopedVisits
        .filter((v) => v.status === 'deviation')
        .sort((a, b) => b.date.localeCompare(a.date)),
    [scopedVisits],
  );

  const missedLog = useMemo(
    () =>
      scopedVisits
        .filter((v) => v.status === 'missed')
        .sort((a, b) => b.date.localeCompare(a.date)),
    [scopedVisits],
  );

  return (
    <div className={`${pageBg} h-full overflow-y-auto`}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              {activeProtocol ? activeProtocol.code : 'All protocols'}
            </p>
            <h2 className={`${headingColor} text-xl font-semibold mt-0.5`}>Reports</h2>
            <p className={`${subColor} text-sm mt-1`}>
              {activeProtocol
                ? `Visit compliance and deviations for ${activeProtocol.code}`
                : 'Summary across all active protocols'}
            </p>
          </div>
          <button
            type="button"
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            title="Export as CSV — coming soon"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Active participants"
            value={stats.activeParticipants}
            icon={<Users size={14} />}
            isLight={isLight}
          />
          <StatCard
            label="Visit compliance"
            value={
              stats.complianceRate !== null
                ? `${stats.complianceRate}%`
                : '—'
            }
            sub={stats.concluded > 0 ? `${stats.completed} of ${stats.concluded} concluded` : undefined}
            icon={<TrendingUp size={14} />}
            highlight={
              stats.complianceRate !== null
                ? stats.complianceRate >= 85
                  ? 'green'
                  : stats.complianceRate >= 70
                  ? 'amber'
                  : 'red'
                : undefined
            }
            isLight={isLight}
          />
          <StatCard
            label="Open deviations"
            value={stats.openDeviations}
            icon={<AlertTriangle size={14} />}
            highlight={stats.openDeviations > 0 ? 'amber' : undefined}
            isLight={isLight}
          />
          <StatCard
            label="Upcoming visits"
            value={stats.upcoming}
            icon={<Calendar size={14} />}
            isLight={isLight}
          />
        </div>

        {/* Protocol compliance table (cross-protocol only) */}
        {!activeProtocol && (
          <div className={`${cardBg} border rounded-xl overflow-hidden`}>
            <div className={`px-5 py-3.5 border-b ${rowBorder}`}>
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                Protocol compliance
              </p>
            </div>
            <div className="divide-y divide-inherit">
              {protocolRows.map(({ protocol, enrolled, completed, missed, deviation, rate, total }) => {
                const colors = PROTOCOL_COLORS[protocol.id];
                return (
                  <div
                    key={protocol.id}
                    className="px-5 py-3.5 flex items-center gap-4 flex-wrap"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                            isLight ? colors.chipLight : colors.chipDark
                          }`}
                        >
                          {protocol.code}
                        </span>
                        <span className={`${mutedColor} text-xs`}>{protocol.phase}</span>
                      </div>
                      <p className={`${headingColor} text-xs mt-1.5 font-medium`}>
                        {enrolled} enrolled
                        <span className={`${mutedColor} font-normal`}>
                          {' '}· {total} concluded visits
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs flex-wrap">
                      <MetricPill icon={<CheckCircle2 size={11} />} value={completed} tone="green" isLight={isLight} label="Completed" />
                      <MetricPill icon={<XCircle size={11} />} value={missed} tone={missed > 0 ? 'red' : 'neutral'} isLight={isLight} label="Missed" />
                      <MetricPill icon={<AlertTriangle size={11} />} value={deviation} tone={deviation > 0 ? 'amber' : 'neutral'} isLight={isLight} label="Deviation" />
                      {rate !== null && (
                        <span
                          className={`font-semibold text-sm ${
                            rate >= 85
                              ? isLight ? 'text-emerald-600' : 'text-emerald-400'
                              : rate >= 70
                              ? isLight ? 'text-amber-600' : 'text-amber-400'
                              : isLight ? 'text-rose-600' : 'text-rose-400'
                          }`}
                        >
                          {rate}%
                        </span>
                      )}
                      {rate === null && (
                        <span className={`${mutedColor} text-xs`}>No concluded visits</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Deviation log */}
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div className={`px-5 py-3.5 border-b ${rowBorder} flex items-center justify-between`}>
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Deviation log
            </p>
            <span className={`${mutedColor} text-xs`}>{deviationLog.length} records</span>
          </div>
          {deviationLog.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 size={20} className={`mx-auto mb-2 ${isLight ? 'text-emerald-500/50' : 'text-emerald-400/40'}`} />
              <p className={`${mutedColor} text-sm`}>No deviations recorded{activeProtocol ? ' for this protocol' : ''}.</p>
            </div>
          ) : (
            <div className="divide-y divide-inherit">
              {deviationLog.map((v) => {
                const protocol = protocols.find((p) => p.id === v.protocolId);
                const colors = protocol ? PROTOCOL_COLORS[protocol.id] : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVisit(v)}
                    className={`w-full text-left px-5 py-4 transition-colors ${isLight ? 'hover:bg-[#f9fafc]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={`${headingColor} text-xs font-semibold`}>
                        {formatDate(v.date)}
                      </span>
                      <span className={mutedColor}>·</span>
                      <span className={`${headingColor} text-xs`}>{v.participantId}</span>
                      <span className={mutedColor}>·</span>
                      <span className={`${subColor} text-xs`}>{v.visitName}</span>
                      {protocol && colors && (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                            isLight ? colors.chipLight : colors.chipDark
                          }`}
                        >
                          {protocol.code}
                        </span>
                      )}
                    </div>
                    {v.deviationReason && (
                      <p className={`${subColor} text-xs leading-relaxed`}>{v.deviationReason}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Missed visits log */}
        <div className={`${cardBg} border rounded-xl overflow-hidden`}>
          <div className={`px-5 py-3.5 border-b ${rowBorder} flex items-center justify-between`}>
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Missed visits
            </p>
            <span className={`${mutedColor} text-xs`}>{missedLog.length} records</span>
          </div>
          {missedLog.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 size={20} className={`mx-auto mb-2 ${isLight ? 'text-emerald-500/50' : 'text-emerald-400/40'}`} />
              <p className={`${mutedColor} text-sm`}>No missed visits{activeProtocol ? ' for this protocol' : ''}.</p>
            </div>
          ) : (
            <div className="divide-y divide-inherit">
              {missedLog.map((v) => {
                const protocol = protocols.find((p) => p.id === v.protocolId);
                const colors = protocol ? PROTOCOL_COLORS[protocol.id] : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVisit(v)}
                    className={`w-full text-left px-5 py-3.5 transition-colors ${isLight ? 'hover:bg-[#f9fafc]' : 'hover:bg-white/[0.02]'}`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`${headingColor} text-xs font-semibold`}>
                        {formatDate(v.date)}
                      </span>
                      <span className={mutedColor}>·</span>
                      <span className={`${headingColor} text-xs`}>{v.participantId}</span>
                      <span className={mutedColor}>·</span>
                      <span className={`${subColor} text-xs`}>{v.visitName}</span>
                      {protocol && colors && (
                        <span
                          className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
                            isLight ? colors.chipLight : colors.chipDark
                          }`}
                        >
                          {protocol.code}
                        </span>
                      )}
                    </div>
                    {v.priorNote && (
                      <p className={`${mutedColor} text-[11px] mt-1 leading-snug`}>{v.priorNote}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {selectedVisit && (
        <VisitDetailDrawer
          visit={selectedVisit}
          protocols={protocols}
          today={today}
          onClose={() => setSelectedVisit(null)}
          onNavigateToVisits={onNavigateToVisits}
        />
      )}
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

interface StatCardProps {
  label: string;
  value: number | string;
  sub?: string;
  icon: React.ReactNode;
  highlight?: 'green' | 'amber' | 'red';
  isLight: boolean;
}

function StatCard({ label, value, sub, icon, highlight, isLight }: StatCardProps) {
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const valueColor = highlight
    ? highlight === 'green'
      ? isLight ? 'text-emerald-600' : 'text-emerald-400'
      : highlight === 'amber'
      ? isLight ? 'text-amber-600' : 'text-amber-400'
      : isLight ? 'text-rose-600' : 'text-rose-400'
    : 'text-fg-heading';
  const iconColor = isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/25';

  return (
    <div className={`${cardBg} border rounded-xl p-4`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">{label}</p>
        <span className={iconColor}>{icon}</span>
      </div>
      <p className={`${valueColor} text-2xl font-semibold leading-none`}>{value}</p>
      {sub && <p className="text-fg-muted text-[11px] mt-1">{sub}</p>}
    </div>
  );
}

interface MetricPillProps {
  icon: React.ReactNode;
  value: number;
  tone: 'green' | 'amber' | 'red' | 'neutral';
  isLight: boolean;
  label: string;
}

function MetricPill({ icon, value, tone, isLight, label }: MetricPillProps) {
  const tones = {
    green: isLight ? 'text-emerald-600' : 'text-emerald-400',
    amber: isLight ? 'text-amber-600' : 'text-amber-400',
    red: isLight ? 'text-rose-600' : 'text-rose-400',
    neutral: 'text-fg-muted',
  };
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs ${tones[tone]}`}
      title={label}
    >
      {icon}
      {value}
    </span>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
