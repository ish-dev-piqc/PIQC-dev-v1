import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Calendar,
  Users,
  Download,
  FileText,
  Sheet,
  CalendarPlus,
  TrendingUp,
} from 'lucide-react';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { getProtocolColors } from '../../../lib/site/protocolColors';
import { buildReportWorkbook } from '../../../lib/site/reportsExport';
import { buildVisitIcsBlob } from '../../../lib/site/calendarExport';
import type { SiteVisit } from '../../../lib/site/types';
import VisitDetailDrawer from './VisitDetailDrawer';
import AuditSignalsBanner from './AuditSignalsBanner';

// =============================================================================
// ReportsTab — Site Mode summary metrics, protocol compliance, deviation log.
//
// Works in cross-protocol ("All protocols") and single-protocol scope.
// =============================================================================

export default function ReportsTab({ onNavigateToVisits }: { onNavigateToVisits?: () => void } = {}) {
  const { theme } = useTheme();
  const { activeProtocol, protocols } = useProtocol();
  const { visits: allSiteVisits, participants: allSiteParticipants, error } = useSiteData();
  const isLight = theme === 'light';
  const today = useMemo(() => new Date(), []);
  const todayStr = useMemo(() => today.toISOString().slice(0, 10), [today]);
  const [selectedVisit, setSelectedVisit] = useState<SiteVisit | null>(null);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowBorder = isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]';
  const pageBg = isLight ? 'bg-[#F8FAFC]' : 'bg-[#020617]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';

  const scopedVisits = useMemo(() => {
    if (!activeProtocol) return allSiteVisits;
    return allSiteVisits.filter((v) => v.protocolId === activeProtocol.id);
  }, [activeProtocol, allSiteVisits]);

  const scopedParticipants = useMemo(() => {
    if (!activeProtocol) return allSiteParticipants;
    return allSiteParticipants.filter((p) => p.protocol_id === activeProtocol.id);
  }, [activeProtocol, allSiteParticipants]);

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
        const pv = allSiteVisits.filter((v) => v.protocolId === p.id);
        const concluded = pv.filter((v) =>
          ['completed', 'missed', 'deviation'].includes(v.status),
        );
        const completed = concluded.filter((v) => v.status === 'completed').length;
        const missed = concluded.filter((v) => v.status === 'missed').length;
        const deviation = concluded.filter((v) => v.status === 'deviation').length;
        const enrolled = allSiteParticipants.filter(
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
    [protocols, allSiteVisits, allSiteParticipants],
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

  const exportCSV = () => {
    const headers = ['Date', 'Participant', 'Protocol', 'Visit', 'Status', 'Deviation Reason', 'Note'];
    const rows = scopedVisits
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((v) => {
        const protocol = protocols.find((p) => p.id === v.protocolId);
        return [v.date, v.participantId, protocol?.code ?? '', v.visitName, v.status, v.deviationReason ?? '', v.priorNote ?? '']
          .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
          .join(',');
      });
    const csv = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `visits_${activeProtocol ? activeProtocol.code : 'all-protocols'}_${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportICS = () => {
    const blob = buildVisitIcsBlob({
      visits: scopedVisits,
      protocolCodeById: new Map(protocols.map((p) => [p.id, p.code])),
      calendarName: activeProtocol ? `${activeProtocol.code} visits` : 'PIQC visits',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `visits_${activeProtocol ? activeProtocol.code : 'all-protocols'}_${todayStr}.ics`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportXLSX = () => {
    const scopeLabel = activeProtocol ? activeProtocol.code : 'All protocols';
    const protocolCodeById = new Map<string, string>(
      protocols.map((p) => [p.id, p.code]),
    );
    const blob = buildReportWorkbook({
      scopeLabel,
      generatedAt: todayStr,
      stats,
      visits: scopedVisits,
      participants: scopedParticipants,
      // Cross-protocol breakdown only when scope is "all protocols";
      // the per-protocol table is meaningless when filtered to one.
      protocolRows: activeProtocol ? [] : protocolRows,
      protocolCodeById,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `report_${activeProtocol ? activeProtocol.code : 'all-protocols'}_${todayStr}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const scopeLabel = activeProtocol ? activeProtocol.code : 'All protocols';

    doc.setFontSize(16);
    doc.text(`PIQ Clinical — Site Report`, 40, 50);
    doc.setFontSize(11);
    doc.setTextColor(120);
    doc.text(`${scopeLabel} · Generated ${todayStr}`, 40, 68);
    doc.setTextColor(0);

    const summaryRows: [string, string][] = [
      ['Active participants', String(stats.activeParticipants)],
      [
        'Visit compliance',
        stats.complianceRate !== null ? `${stats.complianceRate}%` : '—',
      ],
      ['Completed visits', String(stats.completed)],
      ['Missed visits', String(stats.missed)],
      ['Deviations', String(stats.deviations)],
      ['Open deviations', String(stats.openDeviations)],
      ['Upcoming visits', String(stats.upcoming)],
    ];
    autoTable(doc, {
      startY: 90,
      head: [['Metric', 'Value']],
      body: summaryRows,
      theme: 'grid',
      headStyles: { fillColor: [55, 65, 82] },
      styles: { fontSize: 10 },
    });

    if (!activeProtocol && protocolRows.length > 0) {
      autoTable(doc, {
        head: [['Protocol', 'Enrolled', 'Concluded', 'Completed', 'Missed', 'Deviations', 'Rate']],
        body: protocolRows.map((r) => [
          r.protocol.code,
          String(r.enrolled),
          String(r.total),
          String(r.completed),
          String(r.missed),
          String(r.deviation),
          r.rate !== null ? `${r.rate}%` : '—',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [55, 65, 82] },
        styles: { fontSize: 9 },
      });
    }

    if (deviationLog.length > 0) {
      autoTable(doc, {
        head: [['Date', 'Participant', 'Visit', 'Reason']],
        body: deviationLog.map((v) => [
          v.date,
          v.participantId,
          v.visitName,
          v.deviationReason ?? '',
        ]),
        theme: 'striped',
        headStyles: { fillColor: [180, 80, 80] },
        styles: { fontSize: 9 },
        didDrawPage: (data) => {
          if (data.cursor && data.pageNumber === 1) {
            doc.setFontSize(11);
            doc.text('Deviations', 40, data.cursor.y - 14);
          }
        },
      });
    }

    if (missedLog.length > 0) {
      autoTable(doc, {
        head: [['Date', 'Participant', 'Visit']],
        body: missedLog.map((v) => [v.date, v.participantId, v.visitName]),
        theme: 'striped',
        headStyles: { fillColor: [120, 90, 30] },
        styles: { fontSize: 9 },
      });
    }

    doc.save(
      `report_${activeProtocol ? activeProtocol.code : 'all-protocols'}_${todayStr}.pdf`,
    );
  };

  return (
    <div className={`${pageBg} h-full overflow-y-auto`}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {activeProtocol && <AuditSignalsBanner protocolId={activeProtocol.id} />}

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
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportCSV}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <Download size={13} />
              Export CSV
            </button>
            <button
              type="button"
              onClick={exportXLSX}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              title="Multi-sheet workbook — summary, visits, participants, deviations"
            >
              <Sheet size={13} />
              Export XLSX
            </button>
            <button
              type="button"
              onClick={exportICS}
              disabled={scopedVisits.length === 0}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary} disabled:opacity-50`}
              title="Download as .ics for Outlook / Google Calendar"
            >
              <CalendarPlus size={13} />
              Export calendar
            </button>
            <button
              type="button"
              onClick={exportPDF}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <FileText size={13} />
              Export PDF
            </button>
          </div>
        </div>

        {error && (
          <div
            className={`border rounded-md px-3 py-2 text-xs ${
              isLight ? 'bg-rose-50 border-rose-200 text-rose-700' : 'bg-rose-500/[0.06] border-rose-500/20 text-rose-300'
            }`}
          >
            Failed to load report data: {error}
          </div>
        )}

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
                const colors = getProtocolColors(protocol.code);
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
                const colors = protocol ? getProtocolColors(protocol.code) : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVisit(v)}
                    className={`w-full text-left px-5 py-4 transition-colors ${isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]'}`}
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
                const colors = protocol ? getProtocolColors(protocol.code) : null;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVisit(v)}
                    className={`w-full text-left px-5 py-3.5 transition-colors ${isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]'}`}
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
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const valueColor = highlight
    ? highlight === 'green'
      ? isLight ? 'text-emerald-600' : 'text-emerald-400'
      : highlight === 'amber'
      ? isLight ? 'text-amber-600' : 'text-amber-400'
      : isLight ? 'text-rose-600' : 'text-rose-400'
    : 'text-fg-heading';
  const iconColor = isLight ? 'text-[#334155]/30' : 'text-[#CBD5E1]/25';

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
