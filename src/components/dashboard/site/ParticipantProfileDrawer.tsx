import { useRef } from 'react';
import {
  X,
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  XCircle,
  FileWarning,
  AlertCircle,
  Clock,
  UserCircle2,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import {
  MOCK_PARTICIPANTS,
  PARTICIPANT_STATUS_LABELS,
  type ParticipantStatus,
} from '../../../lib/mockSiteData';
import { MOCK_VISITS, type VisitStatus } from '../../../lib/mockCalendarData';
import type { Protocol } from '../../../context/ProtocolContext';

// =============================================================================
// ParticipantProfileDrawer — participant detail panel, mock-backed.
//
// Stacks above VisitDetailDrawer (z-[60]). Shows enrollment info, visit
// history, open deviations, and coordinator. Supabase wire-up deferred until
// Site Mode API files land.
// =============================================================================

interface Props {
  participantId: string;
  protocols: Protocol[];
  onClose: () => void;
}

const STATUS_TONE: Record<ParticipantStatus, string> = {
  ACTIVE:         'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  SCREENING:      'text-blue-600 bg-blue-50 border-blue-200 dark:text-blue-400 dark:bg-blue-400/10 dark:border-blue-400/20',
  SCREEN_FAILURE: 'text-rose-600 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-400/10 dark:border-rose-400/20',
  COMPLETED:      'text-purple-600 bg-purple-50 border-purple-200 dark:text-purple-400 dark:bg-purple-400/10 dark:border-purple-400/20',
  WITHDRAWN:      'text-fg-muted bg-transparent border-transparent',
};

function visitStatusIcon(status: VisitStatus, size = 12) {
  switch (status) {
    case 'completed':   return <CheckCircle2 size={size} className="text-emerald-500" />;
    case 'missed':      return <XCircle size={size} className="text-red-500" />;
    case 'deviation':   return <FileWarning size={size} className="text-amber-500" />;
    case 'overdue':     return <AlertCircle size={size} className="text-red-500" />;
    case 'closing_soon':return <Clock size={size} className="text-amber-500" />;
    default:            return <CalendarCheck size={size} className="text-fg-muted" />;
  }
}

function visitStatusLabel(status: VisitStatus): string {
  const map: Record<VisitStatus, string> = {
    completed:    'Completed',
    missed:       'Missed',
    deviation:    'Deviation',
    overdue:      'Overdue',
    closing_soon: 'Closing soon',
    scheduled:    'Scheduled',
  };
  return map[status];
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ParticipantProfileDrawer({ participantId, protocols, onClose }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const participant = MOCK_PARTICIPANTS.find((p) => p.id === participantId) ?? null;
  const participantVisits = MOCK_VISITS
    .filter((v) => v.participantId === participantId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const protocol = participant
    ? protocols.find((p) => p.id === participant.protocol_id) ?? null
    : null;

  const bg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const border = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const rowBorder = isLight ? 'border-[#f0f3f6]' : 'border-white/[0.04]';
  const panelBg = isLight ? 'bg-[#f9fafc] border-[#eef2f6]' : 'bg-white/[0.02] border-white/[0.04]';
  const deviationBg = isLight ? 'bg-amber-50 border-amber-200' : 'bg-amber-400/[0.08] border-amber-400/20';

  return (
    <div
      ref={overlayRef}
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
      className="fixed inset-0 z-[60] bg-black/20 flex justify-end animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-md h-full ${bg} border-l ${border} shadow-xl flex flex-col animate-slide-in-right`}
        {...swipe}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div className="flex items-center gap-2.5">
            <UserCircle2 size={18} className="text-fg-muted" />
            <div>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-fg-sub">
                Participant
              </div>
              <div className="font-semibold text-base text-fg-heading">{participantId}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1.5 rounded-md transition-colors ${isLight ? 'hover:bg-[#f0f3f6]' : 'hover:bg-white/[0.06]'}`}
            aria-label="Close"
          >
            <X size={16} className="text-fg-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!participant ? (
            <div className="px-5 py-10 text-center">
              <p className="text-fg-muted text-sm">Participant not found in mock data.</p>
            </div>
          ) : (
            <div className="px-5 py-5 space-y-5">

              {/* Status + protocol */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full border ${STATUS_TONE[participant.status]}`}>
                  {PARTICIPANT_STATUS_LABELS[participant.status]}
                </span>
                {protocol && (
                  <span className="text-fg-muted text-xs">{protocol.code} · {protocol.phase}</span>
                )}
              </div>

              {/* Open deviations callout */}
              {participant.open_deviations > 0 && (
                <div className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-3 ${deviationBg}`}>
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className={`text-xs leading-relaxed ${isLight ? 'text-amber-800' : 'text-amber-300'}`}>
                    {participant.open_deviations} open deviation{participant.open_deviations > 1 ? 's' : ''} logged for this participant.
                  </p>
                </div>
              )}

              {/* Enrollment metadata */}
              <div className={`${panelBg} rounded-xl border divide-y ${rowBorder} text-sm`}>
                <MetaRow label="Coordinator" value={participant.assigned_coordinator} isLight={isLight} />
                {participant.enrolled_at && (
                  <MetaRow label="Enrolled" value={formatDate(participant.enrolled_at)} isLight={isLight} />
                )}
                {participant.current_study_day !== null && (
                  <MetaRow label="Study day" value={`Day ${participant.current_study_day}`} isLight={isLight} />
                )}
                {participant.next_visit_date && participant.next_visit_name && (
                  <MetaRow
                    label="Next visit"
                    value={`${participant.next_visit_name} · ${formatDate(participant.next_visit_date)}`}
                    isLight={isLight}
                  />
                )}
              </div>

              {/* Notes */}
              {participant.notes && (
                <div className={`${panelBg} rounded-xl border px-4 py-3`}>
                  <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5">Notes</p>
                  <p className="text-fg-sub text-xs leading-relaxed">{participant.notes}</p>
                </div>
              )}

              {/* Visit history */}
              <div>
                <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-2">
                  Visit history ({participantVisits.length})
                </p>
                {participantVisits.length === 0 ? (
                  <p className="text-fg-muted text-xs">No visits recorded.</p>
                ) : (
                  <div className={`${panelBg} rounded-xl border divide-y ${rowBorder}`}>
                    {participantVisits.map((v) => (
                      <div key={v.id} className="px-4 py-3 flex items-start gap-3">
                        <span className="mt-0.5 flex-shrink-0">{visitStatusIcon(v.status)}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <span className="text-fg-heading text-xs font-medium">{v.visitName}</span>
                            <span className="text-fg-muted text-[11px]">{formatDate(v.date)}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className="text-fg-muted text-[11px]">{visitStatusLabel(v.status)}</span>
                            {v.deviationReason && (
                              <span className={`text-[11px] truncate ${isLight ? 'text-amber-700' : 'text-amber-400'}`}>
                                · {v.deviationReason}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface MetaRowProps {
  label: string;
  value: string;
  isLight: boolean;
}

function MetaRow({ label, value, isLight }: MetaRowProps) {
  return (
    <div className={`px-4 py-2.5 flex items-start justify-between gap-3 ${isLight ? '' : ''}`}>
      <span className="text-fg-label text-[11px] uppercase tracking-wider font-semibold flex-shrink-0">{label}</span>
      <span className="text-fg-sub text-xs text-right">{value}</span>
    </div>
  );
}
