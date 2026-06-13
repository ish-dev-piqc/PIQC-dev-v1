import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  Loader2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { getSponsorProtocolDetail } from '../../../lib/sponsor/sponsorApi';
import type {
  SponsorEnrollment,
  SponsorPortfolioEntry,
  SponsorProtocolDetail,
  SponsorVisitCounts,
} from '../../../types/sponsor';

// =============================================================================
// SponsorProtocolDrawer — read-only drill-in for a single sponsored protocol.
//
// Three sections: visit activity (last 30 days), enrollment breakdown,
// recent deviations (max 10). No actions; sponsors observe, they don't
// edit. Esc / backdrop / X close.
// =============================================================================

interface SponsorProtocolDrawerProps {
  entry: SponsorPortfolioEntry | null;
  onClose: () => void;
}

export default function SponsorProtocolDrawer({ entry, onClose }: SponsorProtocolDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [detail, setDetail] = useState<SponsorProtocolDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!entry) return;
    let cancelled = false;
    setLoading(true);
    getSponsorProtocolDetail(entry.protocolId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setDetail(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  useEffect(() => {
    if (!entry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, onClose]);

  if (!entry) return null;

  const paneBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const paneBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[#0F172A]/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Protocol detail"
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[480px] ${paneBg} border-l ${paneBorder} shadow-xl flex flex-col`}
      >
        {/* Header */}
        <div className={`flex items-start gap-2 px-4 py-3 border-b ${paneBorder}`}>
          <div className="flex-1 min-w-0">
            <p
              className="text-[10px] uppercase tracking-wider font-semibold"
              style={{ color: isLight ? '#3C3489' : '#A29CE6' }}
            >
              {entry.protocolCode ?? 'Unassigned code'}
            </p>
            <p className="text-fg-heading text-sm font-semibold leading-snug mt-0.5">
              {entry.protocolTitle}
            </p>
            <p className={`${subColor} text-[11px] mt-1`}>{entry.siteOrgName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${
              isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/65 hover:bg-white/[0.05]'
            }`}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 size={20} className={`${labelColor} animate-spin`} />
            </div>
          )}
          {error && !loading && (
            <p className={`text-xs ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
              {error}
            </p>
          )}
          {!loading && !error && detail && (
            <>
              <VisitCountsSection counts={detail.visitCounts} isLight={isLight} />
              <EnrollmentSection enrollment={detail.enrollment} isLight={isLight} />
              <RecentDeviationsSection
                deviations={detail.recentDeviations}
                isLight={isLight}
              />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

// ---------------------------------------------------------------------------
// Visit counts — 5 stat cards in a wrapping grid.
// ---------------------------------------------------------------------------

function VisitCountsSection({
  counts,
  isLight,
}: {
  counts: SponsorVisitCounts;
  isLight: boolean;
}) {
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const stats = [
    {
      label: 'Scheduled',
      value: counts.scheduled,
      Icon: Clock,
      color: isLight ? '#0C447C' : '#85B7EB',
    },
    {
      label: 'Completed',
      value: counts.completed,
      Icon: CheckCircle2,
      color: isLight ? '#1D6E4D' : '#5DD1A0',
    },
    {
      label: 'Missed',
      value: counts.missed,
      Icon: XCircle,
      color: isLight ? '#9D2D2D' : '#F47A7A',
    },
    {
      label: 'Deviation',
      value: counts.deviation,
      Icon: FileWarning,
      color: '#BA7517',
    },
    {
      label: 'Overdue',
      value: counts.overdue,
      Icon: AlertTriangle,
      color: isLight ? '#993C1D' : '#F0997B',
    },
  ];
  return (
    <section>
      <div className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor}`}>
        Visit activity · last 30 days
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {stats.map(({ label, value, Icon, color }) => (
          <div key={label} className={`rounded-md border ${border} p-2.5`}>
            <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
              {label}
            </p>
            <p
              className="text-base font-semibold mt-1 flex items-center gap-1.5"
              style={{ color }}
            >
              <Icon size={13} />
              {value}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Enrollment — stacked horizontal bar + legend.
// ---------------------------------------------------------------------------

function EnrollmentSection({
  enrollment,
  isLight,
}: {
  enrollment: SponsorEnrollment;
  isLight: boolean;
}) {
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const segments = [
    { label: 'Active', value: enrollment.active, color: '#1D9E75' },
    { label: 'Screening', value: enrollment.screening, color: '#378ADD' },
    { label: 'Completed', value: enrollment.completed, color: '#534AB7' },
    { label: 'Withdrawn', value: enrollment.withdrawn, color: '#94A3B8' },
    { label: 'Screen failure', value: enrollment.screenFailure, color: '#BA7517' },
  ];
  const total = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <section>
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor} flex items-center gap-1.5`}
      >
        <Users size={11} />
        Enrollment · {total} total
      </div>
      {total === 0 ? (
        <p className={`text-fg-sub text-xs italic px-1 py-2`}>
          No participants on this protocol yet.
        </p>
      ) : (
        <>
          {/* Stacked bar */}
          <div
            className={`flex w-full h-3 rounded-full overflow-hidden border ${border}`}
            role="img"
            aria-label={`Enrollment breakdown: ${segments
              .filter((s) => s.value > 0)
              .map((s) => `${s.value} ${s.label}`)
              .join(', ')}`}
          >
            {segments.map((s) =>
              s.value > 0 ? (
                <span
                  key={s.label}
                  style={{ backgroundColor: s.color, width: `${(s.value / total) * 100}%` }}
                />
              ) : null,
            )}
          </div>
          {/* Legend */}
          <div className="grid grid-cols-2 gap-1.5 mt-2">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-1.5 text-[11px]">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="text-fg-sub truncate">{s.label}</span>
                <span className="text-fg-heading font-semibold ml-auto">{s.value}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Recent deviations — last 10 with date + participant + visit + reason.
// ---------------------------------------------------------------------------

function RecentDeviationsSection({
  deviations,
  isLight,
}: {
  deviations: SponsorProtocolDetail['recentDeviations'];
  isLight: boolean;
}) {
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';

  return (
    <section>
      <div
        className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor} flex items-center gap-1.5`}
      >
        <FileWarning size={11} style={{ color: '#BA7517' }} />
        Recent deviations · {deviations.length}
      </div>
      {deviations.length === 0 ? (
        <p className={`text-fg-sub text-xs italic px-1 py-2`}>
          No deviations logged on this protocol.
        </p>
      ) : (
        <div className={`rounded-md border ${border} divide-y ${border}`}>
          {deviations.map((d) => (
            <div key={d.visitId} className="px-3 py-2">
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <p className="text-fg-heading text-xs font-medium truncate">
                  {d.participantCode ?? 'Participant'} · {d.visitName ?? 'Visit'}
                </p>
                <p className={`${subColor} text-[10px] flex-shrink-0`}>
                  {new Date(d.date).toLocaleDateString()}
                </p>
              </div>
              {d.deviationReason ? (
                <p className={`${subColor} text-[11px] line-clamp-2`}>{d.deviationReason}</p>
              ) : (
                <p className={`${labelColor} text-[11px] italic`}>No reason logged</p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
