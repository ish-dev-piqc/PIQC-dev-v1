import { useEffect, useRef, useState } from 'react';
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
  Pencil,
  Trash2,
  Copy,
  Check,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useSiteData } from '../../../context/SiteDataContext';
import type { ParticipantStatus, VisitStatus } from '../../../lib/site/types';
import { PARTICIPANT_STATUS_LABELS } from '../../../lib/site/labels';
import { deleteParticipant, updateParticipant } from '../../../lib/site/siteApi';
import { listDecisionsReferencingParticipant } from '../../../lib/orgs/orgsApi';
import {
  mergeParticipantTimeline,
  type TimelineEvent,
} from '../../../lib/site/participantTimelineAdapter';
import { useOrg } from '../../../context/OrgContext';
import { useChatNavigation } from '../../../context/ChatNavigationContext';
import InlineEditableText from './InlineEditableText';
import type { ChatDecision } from '../../../types/orgs';
import type { Protocol } from '../../../context/ProtocolContext';
import ParticipantFormDrawer from './ParticipantFormDrawer';

// =============================================================================
// ParticipantProfileDrawer — participant detail panel, Supabase-backed.
//
// Stacks above VisitDetailDrawer (z-[60]). Shows enrollment info, visit
// history (from site_visits), open deviations, coordinator, and the row's
// internal UUID. Header has Edit + Delete affordances.
// Delete uses a soft 2-click confirm (cascades to site_visits per FK).
// =============================================================================

interface Props {
  participantId: string;
  protocols: Protocol[];
  onClose: () => void;
}

const STATUS_TONE: Record<ParticipantStatus, string> = {
  ACTIVE:         'text-emerald-600 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-400/10 dark:border-emerald-400/20',
  SCREENING:      'text-brand-600 bg-brand-50 border-brand-200 dark:text-brand-400 dark:bg-brand-400/10 dark:border-brand-400/20',
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

  const { participants, visits } = useSiteData();
  const { activeOrg } = useOrg();
  const { navigateToOrgChat } = useChatNavigation();
  const participant = participants.find((p) => p.id === participantId) ?? null;
  const participantVisits = visits
    .filter((v) => v.participantId === participantId)
    .sort((a, b) => b.date.localeCompare(a.date));
  const protocol = participant
    ? protocols.find((p) => p.id === participant.protocol_id) ?? null
    : null;

  // --- Decisions referencing this participant ----------------------------
  // Fetch on mount + when the participant changes. Empty result is fine —
  // the timeline still renders with visits alone.
  const [participantDecisions, setParticipantDecisions] = useState<ChatDecision[]>([]);
  useEffect(() => {
    if (!participant) {
      setParticipantDecisions([]);
      return;
    }
    let cancelled = false;
    listDecisionsReferencingParticipant({
      participantCode: participant.id,
      protocolId: participant.protocol_id,
      orgId: activeOrg?.id ?? null,
    }).then((res) => {
      if (cancelled) return;
      if (res.ok) setParticipantDecisions(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [participant, activeOrg?.id]);

  // Merged timeline (visits + decisions). Re-derives whenever either side
  // changes; cheap enough to skip useMemo at typical participant size.
  const timeline: TimelineEvent[] = participant
    ? mergeParticipantTimeline(participantVisits, participantDecisions)
    : [];

  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyUuid = async () => {
    if (!participant) return;
    try {
      await navigator.clipboard.writeText(participant.uuid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleDelete = async () => {
    if (!participant) return;
    setDeleting(true);
    setDeleteError(null);
    const r = await deleteParticipant(participant.uuid);
    setDeleting(false);
    if (!r.ok) {
      setDeleteError(r.error);
      setConfirmingDelete(false);
      return;
    }
    onClose();
  };

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const rowBorder = isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]';
  const panelBg = isLight ? 'bg-[#F8FAFC] border-[#F2F2F2]' : 'bg-white/[0.02] border-white/[0.04]';
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
          <div className="flex items-center gap-2.5 min-w-0">
            <UserCircle2 size={18} className="text-fg-muted flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-fg-sub">
                Participant
              </div>
              <div className="font-semibold text-base text-fg-heading">{participantId}</div>
              {participant && (
                <button
                  type="button"
                  onClick={handleCopyUuid}
                  title="Copy UUID"
                  className="inline-flex items-center gap-1 mt-0.5 text-[10px] font-mono text-fg-muted hover:text-fg-sub transition-colors"
                >
                  <span className="truncate max-w-[180px]">{participant.uuid}</span>
                  {copied ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 flex-shrink-0">
            {participant && (
              <>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className={`p-1.5 rounded-md transition-colors ${isLight ? 'hover:bg-[#F2F2F2]' : 'hover:bg-white/[0.06]'}`}
                  aria-label="Edit participant"
                  title="Edit"
                >
                  <Pencil size={14} className="text-fg-sub" />
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete((c) => !c)}
                  className={`p-1.5 rounded-md transition-colors ${
                    confirmingDelete
                      ? isLight ? 'bg-rose-100 text-rose-700' : 'bg-rose-500/15 text-rose-300'
                      : isLight ? 'hover:bg-[#F2F2F2] text-fg-sub' : 'hover:bg-white/[0.06] text-fg-sub'
                  }`}
                  aria-label={confirmingDelete ? 'Cancel delete' : 'Delete participant'}
                  title={confirmingDelete ? 'Cancel' : 'Delete'}
                >
                  <Trash2 size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className={`p-1.5 rounded-md transition-colors ${isLight ? 'hover:bg-[#F2F2F2]' : 'hover:bg-white/[0.06]'}`}
              aria-label="Close"
            >
              <X size={16} className="text-fg-muted" />
            </button>
          </div>
        </div>

        {/* Delete confirmation banner — soft 2-click */}
        {confirmingDelete && participant && (
          <div
            className={`px-5 py-3 border-b ${border} ${
              isLight ? 'bg-rose-50' : 'bg-rose-500/[0.06]'
            }`}
          >
            <p className={`text-xs font-semibold ${isLight ? 'text-rose-800' : 'text-rose-200'}`}>
              Delete {participant.id}?
            </p>
            <p className={`text-[11px] mt-0.5 leading-snug ${isLight ? 'text-rose-700' : 'text-rose-300/85'}`}>
              This will also delete {participantVisits.length} associated visit{participantVisits.length === 1 ? '' : 's'}. This cannot be undone.
            </p>
            {deleteError && (
              <p className={`text-[11px] mt-1 ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>{deleteError}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-md text-white transition-colors disabled:opacity-50 ${
                  isLight ? 'bg-rose-600 hover:bg-rose-700' : 'bg-rose-500 hover:bg-rose-400'
                }`}
              >
                {deleting ? 'Deleting…' : 'Confirm delete'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deleting}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-md ${isLight ? 'text-rose-700 hover:bg-rose-100' : 'text-rose-300 hover:bg-rose-500/10'} disabled:opacity-50`}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!participant ? (
            <div className="px-5 py-10 text-center">
              <p className="text-fg-muted text-sm">Participant not found.</p>
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

              {/* Enrollment metadata — '—' placeholders for nulls so the user
                  knows which fields can still be filled in via Edit. */}
              <div className={`${panelBg} rounded-xl border divide-y ${rowBorder} text-sm`}>
                <MetaRow
                  label="Coordinator"
                  value={participant.assigned_coordinator || '—'}
                  isLight={isLight}
                />
                <MetaRow
                  label="Enrolled"
                  value={participant.enrolled_at ? formatDate(participant.enrolled_at) : '—'}
                  isLight={isLight}
                />
                <MetaRow
                  label="Study day"
                  value={participant.current_study_day != null ? `Day ${participant.current_study_day}` : '—'}
                  isLight={isLight}
                />
                <MetaRow
                  label="Next visit"
                  value={
                    participant.next_visit_date && participant.next_visit_name
                      ? `${participant.next_visit_name} · ${formatDate(participant.next_visit_date)}`
                      : '—'
                  }
                  isLight={isLight}
                />
              </div>

              {/* Notes — always rendered so coordinators can add inline. */}
              <div className={`${panelBg} rounded-xl border px-4 py-3`}>
                <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5">Notes</p>
                <InlineEditableText
                  value={participant.notes ?? null}
                  placeholder="Anything to remember about this participant?"
                  emptyLabel="Add a note…"
                  onSave={async (next) => {
                    const r = await updateParticipant(participant.uuid, {
                      notes: next,
                    });
                    if (!r.ok) throw new Error(r.error);
                  }}
                />
              </div>

              {/* Timeline — merged visits + chat decisions referencing this
                  participant, reverse-chronological. Replaces the old
                  Visit history section. */}
              <div>
                <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-2">
                  Timeline ({timeline.length})
                </p>
                {timeline.length === 0 ? (
                  <p className="text-fg-muted text-xs">
                    No activity recorded for this participant yet.
                  </p>
                ) : (
                  <div className={`${panelBg} rounded-xl border divide-y ${rowBorder}`}>
                    {timeline.map((ev) => {
                      if (ev.kind === 'visit') {
                        const v = ev.visit;
                        return (
                          <div key={`v-${v.id}`} className="px-4 py-3 flex items-start gap-3">
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
                        );
                      }
                      // Decision row — click navigates to chat with deep-link
                      // to the source message via ChatNavigationContext.
                      const d = ev.decision;
                      const channelKey: 'org' | `protocol:${string}` = d.org_id
                        ? 'org'
                        : `protocol:${d.protocol_id ?? ''}`;
                      const sourceMessageId =
                        d.source_org_message_id ?? d.source_protocol_message_id ?? undefined;
                      return (
                        <button
                          key={`d-${d.id}`}
                          type="button"
                          onClick={() => navigateToOrgChat(channelKey, sourceMessageId)}
                          className={`w-full text-left px-4 py-3 flex items-start gap-3 ${
                            isLight ? 'hover:bg-amber-50/40' : 'hover:bg-white/[0.03]'
                          }`}
                        >
                          <CheckCircle2
                            size={13}
                            className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-amber-700' : 'text-amber-300'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-fg-heading text-xs font-medium truncate">
                                Decision: {d.title}
                              </span>
                              <span className="text-fg-muted text-[11px]">
                                {formatDate(d.decided_at.slice(0, 10))}
                              </span>
                            </div>
                            {d.rationale && (
                              <p className="text-fg-muted text-[11px] mt-0.5 line-clamp-2">
                                {d.rationale}
                              </p>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>

      {editing && participant && protocol && (
        <ParticipantFormDrawer
          mode="edit"
          protocolId={participant.protocol_id}
          protocolCode={protocol.code}
          initial={participant}
          onSaved={() => {
            // Realtime update brings the change back into context.
          }}
          onClose={() => setEditing(false)}
        />
      )}
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
