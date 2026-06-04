import { useState } from 'react';
import {
  Check,
  ClipboardCheck,
  Clock,
  ExternalLink,
  Loader2,
  Trash2,
  X,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import {
  acknowledgeDecision,
  deleteChatDecision,
} from '../../../../lib/orgs/orgsApi';
import type {
  ChatDecision,
  ChatDecisionAck,
  OrgMemberWithProfile,
} from '../../../../types/orgs';

// =============================================================================
// DecisionList — side panel listing decisions for the active chat channel.
// Newest-first. Per-row ack progress + an Acknowledge button for required
// users who haven't acked yet.
// =============================================================================

interface DecisionListProps {
  decisions: ChatDecision[];
  acksByDecisionId: Map<string, ChatDecisionAck[]>;
  isAdmin: boolean;
  currentUserId: string | null;
  members: Map<string, OrgMemberWithProfile>;
  onClose: () => void;
  onJumpToSource: (sourceMessageId: string) => void;
  onDeleted: (decisionId: string) => void;
  onAcknowledged: (ack: ChatDecisionAck) => void;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function RationaleBlock({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const truncated = text.length > 240 && !expanded;
  return (
    <div className="text-fg-body text-xs leading-relaxed whitespace-pre-wrap">
      {truncated ? text.slice(0, 240) + '…' : text}
      {text.length > 240 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="ml-1 text-brand-300 hover:underline text-[11px]"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

export default function DecisionList({
  decisions,
  acksByDecisionId,
  isAdmin,
  currentUserId,
  members,
  onClose,
  onJumpToSource,
  onDeleted,
  onAcknowledged,
}: DecisionListProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleDelete(d: ChatDecision) {
    if (!window.confirm(`Delete the decision "${d.title}"? This can't be undone.`)) return;
    setBusyId(d.id);
    const res = await deleteChatDecision(d.id);
    setBusyId(null);
    if (res.ok) onDeleted(d.id);
  }

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]';
  const accent = isLight ? 'text-amber-600' : 'text-amber-400';

  function nameOf(userId: string | null): string {
    if (!userId) return 'Unknown';
    return members.get(userId)?.name ?? 'Unknown';
  }

  return (
    <div className="fixed inset-0 z-40 flex items-stretch justify-end">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`relative w-full max-w-md h-full overflow-y-auto border-l ${border} ${
          isLight ? 'bg-white' : 'bg-[#0F172A]'
        }`}
      >
        <div
          className={`sticky top-0 px-5 py-3 border-b ${border} flex items-center justify-between ${
            isLight ? 'bg-white' : 'bg-[#0F172A]'
          }`}
        >
          <h3 className={`${headingColor} text-sm font-semibold inline-flex items-center gap-2`}>
            <ClipboardCheck size={15} className={accent} />
            Decisions ({decisions.length})
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
            aria-label="Close decisions panel"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {decisions.length === 0 ? (
            <p className={`${subColor} text-sm text-center py-8`}>
              No decisions yet. Hover a chat message and pick "Promote to decision"
              to capture one.
            </p>
          ) : (
            decisions.map((d) => {
              const sourceId =
                d.source_org_message_id ?? d.source_protocol_message_id;
              const acks = acksByDecisionId.get(d.id) ?? [];
              return (
                <article
                  key={d.id}
                  className={`rounded-md border ${border} ${cardBg} px-4 py-3 space-y-2`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h4 className={`${headingColor} text-sm font-semibold flex-1`}>
                      {d.title}
                    </h4>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleDelete(d)}
                        disabled={busyId === d.id}
                        className={`p-1 rounded text-[11px] ${
                          isLight
                            ? 'text-red-600 hover:bg-red-500/[0.06]'
                            : 'text-red-400 hover:bg-red-500/[0.08]'
                        } disabled:opacity-50 flex-shrink-0`}
                        aria-label="Delete decision"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                  </div>
                  {d.rationale && <RationaleBlock text={d.rationale} />}
                  <div className={`${subColor} text-[11px] space-y-0.5`}>
                    <p>
                      <span className={`${labelColor} uppercase tracking-wider font-semibold`}>
                        Decided by
                      </span>{' '}
                      {nameOf(d.decided_by_user_id)} ·{' '}
                      <span className={mutedColor}>{formatTimestamp(d.decided_at)}</span>
                    </p>
                    {d.created_by_user_id && d.created_by_user_id !== d.decided_by_user_id && (
                      <p className={mutedColor}>
                        Captured by {nameOf(d.created_by_user_id)} on{' '}
                        {formatTimestamp(d.created_at)}
                      </p>
                    )}
                  </div>

                  {acks.length > 0 && (
                    <AckStatusSection
                      acks={acks}
                      currentUserId={currentUserId}
                      nameOf={nameOf}
                      isLight={isLight}
                      onAcknowledged={onAcknowledged}
                    />
                  )}

                  {sourceId && (
                    <button
                      type="button"
                      onClick={() => onJumpToSource(sourceId)}
                      className={`inline-flex items-center gap-1 text-[11px] ${
                        isLight ? 'text-brand-600' : 'text-brand-300'
                      } hover:underline`}
                    >
                      <ExternalLink size={10} />
                      Jump to source message
                    </button>
                  )}
                  {!sourceId && (
                    <p className={`${mutedColor} text-[11px] italic`}>
                      Source message no longer exists.
                    </p>
                  )}
                </article>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}

function AckStatusSection({
  acks,
  currentUserId,
  nameOf,
  isLight,
  onAcknowledged,
}: {
  acks: ChatDecisionAck[];
  currentUserId: string | null;
  nameOf: (uid: string | null) => string;
  isLight: boolean;
  onAcknowledged: (ack: ChatDecisionAck) => void;
}) {
  const acknowledged = acks.filter((a) => a.acknowledged_at !== null);
  const pending = acks.filter((a) => a.acknowledged_at === null);

  const myAck = currentUserId ? acks.find((a) => a.required_user_id === currentUserId) : null;
  const myAckPending = myAck && myAck.acknowledged_at === null;

  const subColor = 'text-fg-sub';
  const labelColor = 'text-fg-label';

  return (
    <div
      className={`mt-2 pt-2 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/10'} space-y-2`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
          Acknowledged{' '}
          <span
            className={
              acknowledged.length === acks.length
                ? isLight
                  ? 'text-emerald-700'
                  : 'text-emerald-300'
                : isLight
                  ? 'text-amber-700'
                  : 'text-amber-300'
            }
          >
            {acknowledged.length} of {acks.length}
          </span>
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {acknowledged.map((a) => (
          <span
            key={a.id}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
              isLight
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-emerald-500/[0.15] text-emerald-300'
            }`}
            title={
              a.acknowledged_note
                ? `${nameOf(a.required_user_id)} — ${a.acknowledged_note}`
                : nameOf(a.required_user_id)
            }
          >
            <Check size={9} />
            {nameOf(a.required_user_id)}
          </span>
        ))}
        {pending.map((a) => (
          <span
            key={a.id}
            className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
              isLight
                ? 'bg-[#F2F2F2] text-[#334155]/70'
                : 'bg-white/[0.06] text-[#CBD5E1]/65'
            }`}
            title={`${nameOf(a.required_user_id)} hasn't acknowledged yet`}
          >
            <Clock size={9} />
            {nameOf(a.required_user_id)}
          </span>
        ))}
      </div>

      {myAckPending && myAck && (
        <AcknowledgeBlock
          ack={myAck}
          isLight={isLight}
          onAcknowledged={onAcknowledged}
        />
      )}
      {myAck && myAck.acknowledged_at && (
        <p className={`${subColor} text-[11px]`}>
          You acknowledged on {new Date(myAck.acknowledged_at).toLocaleString()}.
        </p>
      )}
    </div>
  );
}

function AcknowledgeBlock({
  ack,
  isLight,
  onAcknowledged,
}: {
  ack: ChatDecisionAck;
  isLight: boolean;
  onAcknowledged: (ack: ChatDecisionAck) => void;
}) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    const res = await acknowledgeDecision(ack.id, note);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onAcknowledged(res.data);
    setOpen(false);
    setNote('');
  }

  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
          isLight
            ? 'bg-amber-500 text-white hover:bg-amber-600'
            : 'bg-amber-400 text-[#0F172A] hover:bg-amber-300'
        }`}
      >
        <Check size={12} />
        Acknowledge
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Optional note (e.g., 'agree with the timing change')"
        rows={2}
        maxLength={2000}
        className={`w-full px-2 py-1.5 text-xs rounded-md border ${inputBg} resize-none focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-md ${
            isLight
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'bg-amber-400 text-[#0F172A] hover:bg-amber-300'
          } disabled:opacity-60`}
        >
          {submitting ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          Confirm acknowledgment
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setNote('');
          }}
          className={`text-xs px-2 py-1.5 rounded ${
            isLight ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]' : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
          }`}
        >
          Cancel
        </button>
      </div>
      {error && (
        <p className={`text-[11px] ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
          {error}
        </p>
      )}
    </div>
  );
}
