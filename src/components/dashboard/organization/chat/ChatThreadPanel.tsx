import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';

// =============================================================================
// ChatThreadPanel — right-side slide-in panel showing a single thread.
//
// Stateless re-render: takes the parent message + the full message list of
// the active channel, filters to replies inline. Composer posts via the
// provided onReply callback. Realtime arrivals are picked up automatically
// because the parent context's INSERT sub already routes new rows in.
// =============================================================================

interface ThreadMessage {
  id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  parent_message_id: string | null;
}

interface ChatThreadPanelProps {
  parent: ThreadMessage;
  /** Full message list of the active channel — the panel filters to
   *  parent_message_id === parent.id inline. */
  allMessages: ThreadMessage[];
  /** Resolver for "Karl · admin" labels in the reply list. */
  authorOf: (userId: string | null) => { name: string; isAdmin: boolean };
  /** Send the reply. Returns the new message on success. */
  onReply: (body: string) => Promise<{ ok: boolean; error?: string }>;
  onClose: () => void;
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function ChatThreadPanel({
  parent,
  allMessages,
  authorOf,
  onReply,
  onClose,
}: ChatThreadPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const replies = useMemo(
    () =>
      allMessages
        .filter((m) => m.parent_message_id === parent.id)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [allMessages, parent.id],
  );

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Esc to close. Click-outside isn't wired here — the chat surface beneath
  // is interactive, so we don't want stray clicks dismissing the thread.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-scroll to bottom when replies arrive.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [replies.length]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    const res = await onReply(trimmed);
    setSending(false);
    if (res.ok) {
      setDraft('');
    } else {
      setError(res.error ?? 'Failed to send reply.');
    }
  }

  // Theme primitives.
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bg = isLight ? 'bg-white' : 'bg-[#0B1220]';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const inputBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#1E293B] border-white/10';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-700'
    : 'bg-brand-500 text-white hover:bg-brand-400';
  const bubbleOther = isLight
    ? 'bg-[#F1F5F9] text-[#0F172A]'
    : 'bg-white/[0.06] text-[#E2E8F0]';

  return (
    <>
      {/* Backdrop — semi-transparent so the user keeps spatial context. */}
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col border-l ${border} ${bg} shadow-xl`}
        role="dialog"
        aria-label="Thread"
      >
        {/* Header */}
        <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b ${border}`}>
          <div>
            <p className={`${headingColor} text-sm font-semibold`}>Thread</p>
            <p className={`${subColor} text-xs`}>
              {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.05]'}`}
            aria-label="Close thread"
          >
            <X size={14} />
          </button>
        </div>

        {/* Parent + replies list */}
        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
          {/* Parent bubble — distinguished by a left border accent. */}
          <div
            className={`pl-3 border-l-2 ${
              isLight ? 'border-brand-600/40' : 'border-brand-300/40'
            }`}
          >
            <p className={`${mutedColor} text-[11px] mb-1`}>
              {authorOf(parent.author_user_id).name}
              {' · '}
              {relativeShort(parent.created_at)}
            </p>
            {parent.deleted_at ? (
              <p className={`${subColor} text-sm italic`}>
                (this message was deleted)
              </p>
            ) : (
              <p className={`${headingColor} text-sm whitespace-pre-wrap break-words`}>
                {parent.body}
              </p>
            )}
          </div>

          {replies.length === 0 ? (
            <p className={`${subColor} text-xs italic`}>
              No replies yet. Start the thread below.
            </p>
          ) : (
            replies.map((r) => {
              const author = authorOf(r.author_user_id);
              return (
                <div key={r.id} className="flex flex-col items-start">
                  <p className={`${mutedColor} text-[10px] mb-0.5 ml-1`}>
                    {author.name}
                    {author.isAdmin && ' · admin'}
                    {' · '}
                    {relativeShort(r.created_at)}
                    {r.edited_at && !r.deleted_at && (
                      <span className="italic ml-1">(edited)</span>
                    )}
                  </p>
                  <div className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[90%] ${bubbleOther}`}>
                    {r.deleted_at ? (
                      <span className={`italic ${subColor}`}>
                        (this message was deleted)
                      </span>
                    ) : (
                      r.body
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className={`flex-shrink-0 border-t ${border} px-3 py-2.5`}>
          {error && (
            <div
              className={`mb-2 px-2.5 py-1.5 rounded-md text-xs ${
                isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
              }`}
            >
              {error}
            </div>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Reply in thread…"
              rows={2}
              disabled={sending}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              className={`flex-1 text-sm rounded-md border px-2.5 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30 resize-none`}
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || !draft.trim()}
              className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-md ${buttonPrimary} disabled:opacity-50`}
            >
              <Send size={12} />
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
