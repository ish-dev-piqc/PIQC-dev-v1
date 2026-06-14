import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, X } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { createChatDecision } from '../../../../lib/orgs/orgsApi';
import type {
  ChatDecision,
  NewChatDecisionInput,
  OrgMemberWithProfile,
} from '../../../../types/orgs';

// =============================================================================
// DecisionPromoteModal — opened from a chat message's ⋯ menu. Fields:
//   - title (required, ≤200; prefilled from message body)
//   - rationale (optional, ≤4000)
//   - decided_by (member dropdown, defaults to message author)
//   - decided_at (defaults to message created_at)
//
// On submit, calls createChatDecision and bubbles the new row up via onCreated.
// =============================================================================

const MAX_TITLE_LEN = 200;
const MAX_RATIONALE_LEN = 4000;

interface SourceMessage {
  id: string;
  body: string;
  authorUserId: string | null;
  createdAt: string;
}

interface DecisionPromoteModalProps {
  kind: 'org' | 'protocol';
  channelId: string;
  sourceMessage: SourceMessage;
  members: OrgMemberWithProfile[];
  onClose: () => void;
  onCreated: (decision: ChatDecision) => void;
}

function defaultTitleFromBody(body: string): string {
  // Strip mention tokens; collapse whitespace; cap at ~60 chars for a
  // sensible default the user can edit.
  const cleaned = body
    .replace(
      /<@[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}>/g,
      '',
    )
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length <= 60) return cleaned;
  return cleaned.slice(0, 57).trimEnd() + '…';
}

export default function DecisionPromoteModal({
  kind,
  channelId,
  sourceMessage,
  members,
  onClose,
  onCreated,
}: DecisionPromoteModalProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [title, setTitle] = useState(() => defaultTitleFromBody(sourceMessage.body));
  const [rationale, setRationale] = useState('');
  const [decidedBy, setDecidedBy] = useState<string>(
    sourceMessage.authorUserId ?? '',
  );
  const [decidedAtLocal, setDecidedAtLocal] = useState<string>(() => {
    // datetime-local needs YYYY-MM-DDTHH:mm with no seconds/timezone
    const d = new Date(sourceMessage.createdAt);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [requiredUserIds, setRequiredUserIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleRequiredUser(userId: string) {
    setRequiredUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);

  // Close on Escape.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required.');
      return;
    }
    setSubmitting(true);
    setError(null);

    const input: NewChatDecisionInput = {
      title: trimmedTitle,
      rationale: rationale.trim() || null,
      decided_by_user_id: decidedBy || null,
      decided_at: new Date(decidedAtLocal).toISOString(),
      required_user_ids: Array.from(requiredUserIds),
    };
    if (kind === 'org') {
      input.org_id = channelId;
      input.source_org_message_id = sourceMessage.id;
    } else {
      input.protocol_id = channelId;
      input.source_protocol_message_id = sourceMessage.id;
    }

    const res = await createChatDecision(input);
    setSubmitting(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onCreated(res.data);
    onClose();
  }

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const labelColor = 'text-fg-label';
  const subColor = 'text-fg-sub';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const buttonSecondary = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.05]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`relative max-w-lg w-full max-h-[90vh] flex flex-col rounded-lg border shadow-xl ${
          isLight ? 'bg-white' : 'bg-[#0F172A]'
        } ${border}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-modal-title"
      >
        <div className={`px-5 py-3 border-b ${border} flex items-center justify-between gap-3`}>
          <h3
            id="decision-modal-title"
            className={`${headingColor} text-sm font-semibold inline-flex items-center gap-2`}
          >
            <ClipboardCheck size={15} className={isLight ? 'text-amber-600' : 'text-amber-400'} />
            Promote to draft decision
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${buttonSecondary}`}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-y-auto px-5 py-4 gap-4">
          <div>
            <p className={`${subColor} text-xs leading-relaxed`}>
              Captures this message as a durable, audit-trail draft decision.
              The original chat message stays in place; the draft can survive
              the message being deleted later. "Draft" because PIQClinical
              records what your team decided — it doesn't certify the call.
            </p>
          </div>

          <div>
            <label className={`block text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>
              Title *
            </label>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={MAX_TITLE_LEN}
              className={`w-full text-sm rounded-md border px-2 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
              required
            />
            <p className={`${subColor} text-[10px] mt-1`}>
              {title.length}/{MAX_TITLE_LEN}
            </p>
          </div>

          <div>
            <label className={`block text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>
              Rationale (optional)
            </label>
            <textarea
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              maxLength={MAX_RATIONALE_LEN + 50}
              rows={4}
              placeholder="Why was this decided? Context that's useful months from now."
              className={`w-full text-sm rounded-md border px-2 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30 resize-none`}
            />
            <p className={`${subColor} text-[10px] mt-1`}>
              {rationale.length}/{MAX_RATIONALE_LEN}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={`block text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>
                Decided by
              </label>
              <select
                value={decidedBy}
                onChange={(e) => setDecidedBy(e.target.value)}
                className={`w-full text-sm rounded-md border px-2 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
              >
                <option value="">— Unspecified —</option>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={`block text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>
                Decided at
              </label>
              <input
                type="datetime-local"
                value={decidedAtLocal}
                onChange={(e) => setDecidedAtLocal(e.target.value)}
                className={`w-full text-sm rounded-md border px-2 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
              />
            </div>
          </div>

          <div>
            <label className={`block text-[10px] uppercase tracking-wider font-semibold mb-1 ${labelColor}`}>
              Require acknowledgment from (optional)
            </label>
            <p className={`${subColor} text-[11px] leading-relaxed mb-2`}>
              Selected users must explicitly acknowledge the draft decision
              before it shows as complete. Leave empty for informational
              drafts.
            </p>
            <div
              className={`max-h-40 overflow-y-auto rounded-md border ${border} divide-y ${
                isLight ? 'divide-[#E2E8F0]' : 'divide-white/10'
              }`}
            >
              {members.length === 0 ? (
                <p className={`${subColor} text-xs px-3 py-2`}>No org members.</p>
              ) : (
                members.map((m) => {
                  const checked = requiredUserIds.has(m.user_id);
                  return (
                    <label
                      key={m.user_id}
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer ${
                        checked
                          ? isLight
                            ? 'bg-amber-50'
                            : 'bg-amber-500/[0.08]'
                          : isLight
                            ? 'hover:bg-[#0F172A]/[0.04]'
                            : 'hover:bg-white/[0.04]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRequiredUser(m.user_id)}
                      />
                      <span className={`text-sm truncate flex-1 ${headingColor}`}>
                        {m.name}
                      </span>
                      {m.role === 'admin' && (
                        <span className={`${subColor} text-[10px] uppercase`}>admin</span>
                      )}
                    </label>
                  );
                })
              )}
            </div>
            {requiredUserIds.size > 0 && (
              <p className={`${subColor} text-[11px] mt-1`}>
                {requiredUserIds.size} required acknowledgment{requiredUserIds.size === 1 ? '' : 's'}
              </p>
            )}
          </div>

          {error && (
            <p
              className={`text-xs ${
                isLight ? 'text-rose-700' : 'text-rose-300'
              }`}
            >
              {error}
            </p>
          )}
        </form>

        <div className={`flex items-center justify-end gap-2 px-5 py-3 border-t ${border}`}>
          <button
            type="button"
            onClick={onClose}
            className={`text-xs px-3 py-1.5 rounded-md ${buttonSecondary}`}
          >
            Cancel
          </button>
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
          >
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitting ? 'Saving' : 'Promote'}
          </button>
        </div>
      </div>
    </div>
  );
}
