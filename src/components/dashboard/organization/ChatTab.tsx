import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageCircle, Send, Loader2, AlertTriangle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useOrgChat } from '../../../context/OrgChatContext';
import { listOrgMembersWithProfile } from '../../../lib/orgs/orgsApi';
import type { OrgMemberWithProfile } from '../../../types/orgs';

// =============================================================================
// ChatTab — org-wide #general channel.
//
// Reads `messages`, `loading`, `error`, `postMessage` from OrgChatContext.
// Realtime subscription lives in that context; this component only renders.
//
// Composer:
//   - Enter sends; Shift+Enter inserts a newline.
//   - Disabled while sending or when the trimmed body is empty.
//
// Author display:
//   - Self → right-aligned bubble with brand color.
//   - Others → left-aligned with the author's name above the bubble.
//   - Deleted user (author_user_id null) → "Deleted user" label.
//
// Auto-scroll:
//   - If the user is at the bottom (within 80px), new messages scroll into
//     view. If they've scrolled up to read history, the viewport stays put.
// =============================================================================

const MAX_MESSAGE_LENGTH = 10000;
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const isToday = date.toDateString() === new Date().toDateString();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (isToday) return `Today at ${time}`;
  if (isYesterday) return `Yesterday at ${time}`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ChatTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? null;
  const { activeOrg } = useOrg();
  const { messages, loading, error, postMessage } = useOrgChat();

  const [profiles, setProfiles] = useState<Map<string, OrgMemberWithProfile>>(
    new Map(),
  );
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load org members for author-name lookups.
  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    listOrgMembersWithProfile(activeOrg.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) return;
      setProfiles(new Map(res.data.map((m) => [m.user_id, m])));
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  // Track whether the list was scrolled to the bottom before the most recent
  // message arrived — drives the "auto-scroll only if already at bottom" rule.
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
  };

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length]);

  // Snap to bottom on first load so the empty-state-to-populated transition
  // doesn't strand the user.
  useEffect(() => {
    const el = listRef.current;
    if (!el || loading) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
  }, [loading]);

  const composerTooLong = composer.length > MAX_MESSAGE_LENGTH;
  const composerTrimmed = composer.trim();
  const canSend = composerTrimmed.length > 0 && !composerTooLong && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    const res = await postMessage(composerTrimmed);
    setSending(false);
    if (!res.ok) {
      setSendError(res.error ?? 'Failed to send message.');
      return;
    }
    setComposer('');
    // Refocus the composer for fast-typing flow.
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // Format authorship for each message
  const authorOf = useMemo(() => {
    return (userId: string | null) => {
      if (!userId) return { name: 'Deleted user', isAdmin: false };
      const m = profiles.get(userId);
      if (!m) return { name: 'Unknown', isAdmin: false };
      return { name: m.name, isAdmin: m.role === 'admin' };
    };
  }, [profiles]);

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const labelColor = 'text-fg-label';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-brand-600/50'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-brand-300/50';
  const selfBubble = isLight
    ? 'bg-brand-600 text-white'
    : 'bg-brand-300 text-[#0F172A]';
  const otherBubble = isLight
    ? 'bg-[#F1F5F9] text-[#0F172A]'
    : 'bg-white/[0.06] text-[#CBD5E1]';

  if (!activeOrg) {
    return (
      <div className={`px-4 py-8 rounded-md border ${border} text-center`}>
        <p className={`${subColor} text-sm`}>No organization linked to your profile.</p>
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline gap-2">
        <MessageCircle size={14} className={mutedColor} />
        <h3 className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
          #general
        </h3>
        <p className={`${subColor} text-[11px]`}>
          Visible to everyone in {activeOrg.name}.
        </p>
      </div>

      {error && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
            isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
          }`}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div
        ref={listRef}
        onScroll={handleScroll}
        className={`border ${border} rounded-md overflow-y-auto px-4 py-3 space-y-3`}
        style={{ height: 'min(60vh, 540px)' }}
      >
        {loading ? (
          <p className={`${subColor} text-sm`}>Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className={`${subColor} text-sm text-center py-8`}>
            No messages yet. Be the first to say something.
          </p>
        ) : (
          messages.map((m) => {
            const isSelf = m.author_user_id === currentUserId;
            const author = authorOf(m.author_user_id);
            return (
              <div
                key={m.id}
                className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
              >
                {!isSelf && (
                  <p className={`${mutedColor} text-[10px] mb-0.5 ml-1`}>
                    {author.name}
                    {author.isAdmin && ' · admin'}
                  </p>
                )}
                <div
                  className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words ${
                    isSelf ? selfBubble : otherBubble
                  }`}
                >
                  {m.body}
                </div>
                <p
                  className={`${mutedColor} text-[10px] mt-0.5 ${isSelf ? 'mr-1' : 'ml-1'}`}
                  title={new Date(m.created_at).toLocaleString()}
                >
                  {formatRelative(m.created_at)}
                </p>
              </div>
            );
          })
        )}
      </div>

      {sendError && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
            isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
          }`}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{sendError}</span>
        </div>
      )}

      <div className={`border ${border} rounded-md p-2 flex items-end gap-2`}>
        <textarea
          ref={textareaRef}
          value={composer}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message #general… (Enter to send, Shift+Enter for newline)"
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH + 50}
          className={`flex-1 min-w-0 px-2 py-1.5 text-sm rounded-md border ${inputBg} ${headingColor} placeholder:${subColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30 resize-none`}
          disabled={sending}
          aria-label="Message composer"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md transition-colors ${buttonPrimary}`}
          aria-label="Send message"
        >
          {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
          {sending ? 'Sending' : 'Send'}
        </button>
      </div>
      {composerTooLong && (
        <p className={`text-[11px] ${isLight ? 'text-rose-700' : 'text-rose-300'}`}>
          Message exceeds the {MAX_MESSAGE_LENGTH.toLocaleString()} character limit.
        </p>
      )}
    </section>
  );
}
