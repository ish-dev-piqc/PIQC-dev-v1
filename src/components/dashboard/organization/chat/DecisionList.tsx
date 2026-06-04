import { useState } from 'react';
import { ClipboardCheck, Trash2, X, ExternalLink } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { deleteChatDecision } from '../../../../lib/orgs/orgsApi';
import type {
  ChatDecision,
  OrgMemberWithProfile,
} from '../../../../types/orgs';

// =============================================================================
// DecisionList — side panel listing decisions for the active chat channel.
// Newest-first. Admins see a Delete button per row; everyone sees Jump-to-
// source when the source message still exists.
// =============================================================================

interface DecisionListProps {
  decisions: ChatDecision[];
  isAdmin: boolean;
  members: Map<string, OrgMemberWithProfile>;
  onClose: () => void;
  onJumpToSource: (sourceMessageId: string) => void;
  onDeleted: (decisionId: string) => void;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
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
  isAdmin,
  members,
  onClose,
  onJumpToSource,
  onDeleted,
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
