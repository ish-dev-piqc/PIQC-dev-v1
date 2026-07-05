import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  FileWarning,
  Pin,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { listChannelAttachments } from '../../../lib/orgs/orgsApi';
import type { ChatAttachment } from '../../../types/orgs';
import type { SiteVisit, VisitStatus } from '../../../lib/site/types';
import AuditSignalsBanner from './AuditSignalsBanner';

// =============================================================================
// ProtocolDetailDrawer — read-only "this protocol" reference card.
//
// Six sections: header, audit signals, visit activity (last 30 days),
// enrollment, recent visits, pinned documents. Everything except the
// pinned attachments is computed client-side from useSiteData; the
// pinned list is a single listChannelAttachments call on open.
//
// Triggered from the Info icon button each Site Mode tab mounts next to
// the protocol code header.
// =============================================================================

interface ProtocolDetailDrawerProps {
  /** When non-null, drawer is open for that protocol. */
  protocolId: string | null;
  protocolCode: string | null;
  protocolTitle: string | null;
  protocolSponsor: string | null;
  onClose: () => void;
  /** Opens the hub Documents tab scoped to this protocol. */
  onOpenDocuments?: () => void;
}

const VISIT_STATUS_ORDER: VisitStatus[] = [
  'scheduled',
  'completed',
  'missed',
  'deviation',
  'overdue',
  'closing_soon',
  'cancelled',
];

function daysBetween(from: string, to: Date): number {
  const fromDate = new Date(from);
  const diff = to.getTime() - fromDate.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function ProtocolDetailDrawer({
  protocolId,
  protocolCode,
  protocolTitle,
  protocolSponsor,
  onClose,
  onOpenDocuments,
}: ProtocolDetailDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { visits, participants } = useSiteData();

  const [pinned, setPinned] = useState<ChatAttachment[]>([]);

  // Esc-to-close
  useEffect(() => {
    if (!protocolId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [protocolId, onClose]);

  // Load pinned attachments for the protocol channel.
  useEffect(() => {
    setPinned([]);
    if (!protocolId) return;
    let cancelled = false;
    listChannelAttachments('protocol', protocolId).then((res) => {
      if (cancelled) return;
      if (!res.ok) return;
      const pinnedRows = res.data
        .filter((a) => a.pinned_at !== null)
        .sort((a, b) => (b.pinned_at ?? '').localeCompare(a.pinned_at ?? ''))
        .slice(0, 5);
      setPinned(pinnedRows);
    });
    return () => {
      cancelled = true;
    };
  }, [protocolId]);

  // Aggregates — visit counts last 30 days, enrollment by status, recent
  // 5 visits. Re-derives on every open since visits/participants are live.
  const aggregates = useMemo(() => {
    if (!protocolId) {
      return {
        visitCounts: {
          scheduled: 0,
          completed: 0,
          missed: 0,
          deviation: 0,
          overdue: 0,
          closing_soon: 0,
          cancelled: 0,
        } as Record<VisitStatus, number>,
        enrollment: { screening: 0, active: 0, completed: 0, withdrawn: 0, screenFailure: 0 },
        recentVisits: [] as SiteVisit[],
        totalParticipants: 0,
        totalVisits30d: 0,
      };
    }
    const now = new Date();
    const protocolVisits = visits.filter((v) => v.protocolId === protocolId);
    const protocolParticipants = participants.filter((p) => p.protocol_id === protocolId);

    const visits30d = protocolVisits.filter((v) => daysBetween(v.date, now) <= 30);
    const visitCounts: Record<VisitStatus, number> = {
      scheduled: 0,
      completed: 0,
      missed: 0,
      deviation: 0,
      overdue: 0,
      closing_soon: 0,
      cancelled: 0,
    };
    for (const v of visits30d) {
      if (v.status in visitCounts) visitCounts[v.status as VisitStatus]++;
    }

    const enrollment = {
      screening: 0,
      active: 0,
      completed: 0,
      withdrawn: 0,
      screenFailure: 0,
    };
    for (const p of protocolParticipants) {
      switch (p.status) {
        case 'SCREENING':
          enrollment.screening++;
          break;
        case 'ACTIVE':
          enrollment.active++;
          break;
        case 'COMPLETED':
          enrollment.completed++;
          break;
        case 'WITHDRAWN':
          enrollment.withdrawn++;
          break;
        case 'SCREEN_FAILURE':
          enrollment.screenFailure++;
          break;
      }
    }

    const recentVisits = [...protocolVisits]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);

    return {
      visitCounts,
      enrollment,
      recentVisits,
      totalParticipants: protocolParticipants.length,
      totalVisits30d: visits30d.length,
    };
  }, [protocolId, visits, participants]);

  if (!protocolId) return null;

  const paneBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const paneBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';

  const enrollmentTotal =
    aggregates.enrollment.screening +
    aggregates.enrollment.active +
    aggregates.enrollment.completed +
    aggregates.enrollment.withdrawn +
    aggregates.enrollment.screenFailure;
  const enrollmentSegments = [
    { label: 'Active', value: aggregates.enrollment.active, color: '#1D9E75' },
    { label: 'Screening', value: aggregates.enrollment.screening, color: '#378ADD' },
    { label: 'Completed', value: aggregates.enrollment.completed, color: '#534AB7' },
    { label: 'Withdrawn', value: aggregates.enrollment.withdrawn, color: '#94A3B8' },
    { label: 'Screen failure', value: aggregates.enrollment.screenFailure, color: '#BA7517' },
  ];

  const visitStatStyles: Record<VisitStatus, { color: string; Icon: typeof Clock }> = {
    scheduled: { color: isLight ? '#0C447C' : '#85B7EB', Icon: Clock },
    completed: { color: isLight ? '#1D6E4D' : '#5DD1A0', Icon: CheckCircle2 },
    missed: { color: isLight ? '#9D2D2D' : '#F47A7A', Icon: XCircle },
    deviation: { color: '#BA7517', Icon: FileWarning },
    overdue: { color: isLight ? '#993C1D' : '#F0997B', Icon: AlertTriangle },
    closing_soon: { color: isLight ? '#993C1D' : '#F0997B', Icon: AlertTriangle },
    cancelled: { color: isLight ? '#64748B' : '#94A3B8', Icon: Ban },
  };

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-[#0F172A]/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Protocol details"
        className={`fixed top-0 right-0 z-50 h-full w-full sm:w-[520px] ${paneBg} border-l ${paneBorder} shadow-xl flex flex-col`}
      >
        {/* Header */}
        <div className={`flex items-start gap-2 px-4 py-3 border-b ${paneBorder}`}>
          <div className="flex-1 min-w-0">
            <p
              className={`text-[10px] uppercase tracking-wider font-semibold ${labelColor}`}
            >
              {protocolCode ?? 'Protocol'}
            </p>
            <p className="text-fg-heading text-sm font-semibold leading-snug mt-0.5">
              {protocolTitle ?? '(untitled)'}
            </p>
            {protocolSponsor && (
              <p className={`${subColor} text-[11px] mt-1`}>Sponsor: {protocolSponsor}</p>
            )}
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
          <AuditSignalsBanner protocolId={protocolId} />

          {/* Visit activity */}
          <section>
            <div
              className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor}`}
            >
              Visit activity · last 30 days ({aggregates.totalVisits30d})
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {VISIT_STATUS_ORDER.map((status) => {
                const { color, Icon } = visitStatStyles[status];
                return (
                  <div
                    key={status}
                    className={`rounded-md border ${paneBorder} p-2.5`}
                  >
                    <p
                      className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}
                    >
                      {status}
                    </p>
                    <p
                      className="text-base font-semibold mt-1 flex items-center gap-1.5"
                      style={{ color }}
                    >
                      <Icon size={13} />
                      {aggregates.visitCounts[status]}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Enrollment */}
          <section>
            <div
              className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor} flex items-center gap-1.5`}
            >
              <Users size={11} />
              Enrollment · {enrollmentTotal} total
            </div>
            {enrollmentTotal === 0 ? (
              <p className={`${subColor} text-xs italic px-1`}>
                No participants on this protocol yet.
              </p>
            ) : (
              <>
                <div
                  className={`flex w-full h-3 rounded-full overflow-hidden border ${paneBorder}`}
                  role="img"
                  aria-label={`Enrollment breakdown: ${enrollmentSegments
                    .filter((s) => s.value > 0)
                    .map((s) => `${s.value} ${s.label}`)
                    .join(', ')}`}
                >
                  {enrollmentSegments.map((s) =>
                    s.value > 0 ? (
                      <span
                        key={s.label}
                        style={{
                          backgroundColor: s.color,
                          width: `${(s.value / enrollmentTotal) * 100}%`,
                        }}
                      />
                    ) : null,
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5 mt-2">
                  {enrollmentSegments.map((s) => (
                    <div
                      key={s.label}
                      className="flex items-center gap-1.5 text-[11px]"
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-fg-sub truncate">{s.label}</span>
                      <span className="text-fg-heading font-semibold ml-auto">
                        {s.value}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>

          {/* Recent visits */}
          <section>
            <div
              className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor}`}
            >
              Recent visits · {aggregates.recentVisits.length}
            </div>
            {aggregates.recentVisits.length === 0 ? (
              <p className={`${subColor} text-xs italic px-1`}>
                No visits scheduled yet.
              </p>
            ) : (
              <div className={`rounded-md border ${paneBorder} divide-y ${paneBorder}`}>
                {aggregates.recentVisits.map((v) => {
                  const { color } = visitStatStyles[v.status as VisitStatus] ?? {
                    color: subColor,
                  };
                  return (
                    <div key={v.id} className="px-3 py-2 flex items-center gap-3">
                      <span
                        className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                        style={{
                          color,
                          backgroundColor: 'transparent',
                          border: `1px solid ${color}`,
                        }}
                      >
                        {v.status}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-fg-heading text-xs font-medium truncate">
                          {v.visitName} · {v.participantId}
                        </p>
                        <p className={`${subColor} text-[10px]`}>
                          {new Date(v.date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Pinned documents */}
          <section>
            <div
              className={`text-[10px] uppercase tracking-wider font-semibold mb-2 ${labelColor} flex items-center gap-1.5`}
            >
              <Pin size={11} style={{ color: '#BA7517' }} />
              Pinned documents · {pinned.length}
            </div>
            {pinned.length === 0 ? (
              <p className={`${subColor} text-xs italic px-1`}>
                No pinned attachments yet. Pin a chat attachment to surface
                it here.
              </p>
            ) : (
              <div className={`rounded-md border ${paneBorder} divide-y ${paneBorder}`}>
                {pinned.map((a) => (
                  <div key={a.id} className="px-3 py-2 flex items-center gap-2">
                    <FileText
                      size={13}
                      className={`flex-shrink-0 ${labelColor}`}
                    />
                    <p className="flex-1 min-w-0 text-fg-heading text-xs font-medium truncate">
                      {a.original_filename}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {onOpenDocuments && (
              <button
                type="button"
                onClick={onOpenDocuments}
                className={`mt-2 inline-flex items-center gap-1 text-[11px] font-medium ${
                  isLight ? 'text-[#0C447C] hover:underline' : 'text-[#85B7EB] hover:underline'
                }`}
              >
                <ExternalLink size={11} />
                See all in Documents tab
              </button>
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
