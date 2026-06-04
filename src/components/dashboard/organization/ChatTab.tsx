import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MessageCircle,
  Send,
  Loader2,
  AlertTriangle,
  Hash,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useOrgChat } from '../../../context/OrgChatContext';
import { useProtocolChat } from '../../../context/ProtocolChatContext';
import {
  listMyChatProtocols,
  listOrgMembersWithProfile,
} from '../../../lib/orgs/orgsApi';
import type {
  ChatProtocolSummary,
  OrgMemberWithProfile,
} from '../../../types/orgs';

// =============================================================================
// ChatTab — Slack-style chat surface with #general at the top of the sidebar
// and one channel per protocol the user can chat in below it.
//
// Channels:
//   - #general (org-wide) — OrgChatContext (already in use; unchanged in PR 4a)
//   - #{protocolCode} — ProtocolChatContext, one active protocol channel at
//     a time. Switching channels swaps the realtime subscription via
//     ProtocolChatContext.setActiveProtocolId.
//
// Sidebar:
//   - Wide (default ~220px) or collapsed (icon-only ~48px). Toggle persists.
//   - Active channel highlighted. Tooltips on collapsed rows show the label.
//
// Author display + composer + auto-scroll behavior are shared across both
// channel types — the message shape is structurally compatible.
//
// Persisted state:
//   - `piq-chat-channel-v1` → 'general' | <protocol_id>
//   - `piq-chat-sidebar-wide-v1` → 'true' | 'false'
// =============================================================================

const MAX_MESSAGE_LENGTH = 10000;
const SCROLL_BOTTOM_THRESHOLD_PX = 80;

const CHANNEL_STORAGE_KEY = 'piq-chat-channel-v1';
const SIDEBAR_WIDE_STORAGE_KEY = 'piq-chat-sidebar-wide-v1';

type ActiveChannel =
  | { kind: 'org' }
  | { kind: 'protocol'; id: string };

interface ChatMessageLike {
  id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
}

function readStoredChannel(): ActiveChannel | null {
  try {
    const v = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (!v) return null;
    if (v === 'general') return { kind: 'org' };
    // Treat anything else as a protocol id; we'll validate against the
    // chat-protocols list once it loads and fall back to org if it's gone.
    return { kind: 'protocol', id: v };
  } catch {
    return null;
  }
}

function readStoredSidebarWide(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_WIDE_STORAGE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    /* ignore */
  }
  return true;
}

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
  const orgChat = useOrgChat();
  const protocolChat = useProtocolChat();

  // --- Channel discovery -----------------------------------------------------
  const [chatProtocols, setChatProtocols] = useState<ChatProtocolSummary[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    if (!activeOrg) {
      setChatProtocols([]);
      setChannelsLoading(false);
      return;
    }
    let cancelled = false;
    setChannelsLoading(true);
    listMyChatProtocols(activeOrg.id).then((res) => {
      if (cancelled) return;
      setChannelsLoading(false);
      if (res.ok) setChatProtocols(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  // --- Active channel + sidebar state ---------------------------------------
  const [activeChannel, setActiveChannel] = useState<ActiveChannel>(
    () => readStoredChannel() ?? { kind: 'org' },
  );
  const [sidebarWide, setSidebarWide] = useState<boolean>(() => readStoredSidebarWide());

  // Sync ProtocolChatContext when active channel is a protocol; idle it for org.
  useEffect(() => {
    if (activeChannel.kind === 'protocol') {
      protocolChat.setActiveProtocolId(activeChannel.id);
    } else {
      protocolChat.setActiveProtocolId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel]);

  // Persist channel + sidebar state.
  useEffect(() => {
    try {
      const v = activeChannel.kind === 'org' ? 'general' : activeChannel.id;
      localStorage.setItem(CHANNEL_STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  }, [activeChannel]);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_WIDE_STORAGE_KEY, sidebarWide ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [sidebarWide]);

  // If the persisted protocol channel no longer exists (user lost access),
  // fall back to #general so we don't render an empty broken view.
  useEffect(() => {
    if (channelsLoading) return;
    if (activeChannel.kind !== 'protocol') return;
    if (!chatProtocols.some((p) => p.id === activeChannel.id)) {
      setActiveChannel({ kind: 'org' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelsLoading, chatProtocols]);

  // --- Author lookup ---------------------------------------------------------
  const [profiles, setProfiles] = useState<Map<string, OrgMemberWithProfile>>(new Map());

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

  const authorOf = useMemo(() => {
    return (userId: string | null) => {
      if (!userId) return { name: 'Deleted user', isAdmin: false };
      const m = profiles.get(userId);
      if (!m) return { name: 'Unknown', isAdmin: false };
      return { name: m.name, isAdmin: m.role === 'admin' };
    };
  }, [profiles]);

  // --- Composer + scroll -----------------------------------------------------
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Active channel data — selected from whichever context is in use.
  const active =
    activeChannel.kind === 'org'
      ? {
          messages: orgChat.messages as ChatMessageLike[],
          loading: orgChat.loading,
          error: orgChat.error,
          post: orgChat.postMessage,
        }
      : {
          messages: protocolChat.messages as ChatMessageLike[],
          loading: protocolChat.loading,
          error: protocolChat.error,
          post: protocolChat.postMessage,
        };

  const channelLabel = useMemo(() => {
    if (activeChannel.kind === 'org') return 'general';
    return chatProtocols.find((p) => p.id === activeChannel.id)?.code ?? 'protocol';
  }, [activeChannel, chatProtocols]);

  const channelSubLabel = useMemo(() => {
    if (activeChannel.kind === 'org') {
      return activeOrg ? `Visible to everyone in ${activeOrg.name}.` : '';
    }
    const p = chatProtocols.find((x) => x.id === activeChannel.id);
    return p?.name
      ? `Coordinators and team members on ${p.code}. Viewers and guests don't see this channel.`
      : '';
  }, [activeChannel, chatProtocols, activeOrg]);

  // Reset composer state when switching channels so half-typed messages
  // from another channel don't leak into the new one.
  useEffect(() => {
    setComposer('');
    setSendError(null);
  }, [activeChannel]);

  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasAtBottomRef.current = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
  };

  // Auto-scroll on new messages if user was near the bottom.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [active.messages.length]);

  // Snap to bottom on channel switch + first load.
  useEffect(() => {
    const el = listRef.current;
    if (!el || active.loading) return;
    el.scrollTop = el.scrollHeight;
    wasAtBottomRef.current = true;
  }, [active.loading, activeChannel]);

  const composerTooLong = composer.length > MAX_MESSAGE_LENGTH;
  const composerTrimmed = composer.trim();
  const canSend = composerTrimmed.length > 0 && !composerTooLong && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setSendError(null);
    const res = await active.post(composerTrimmed);
    setSending(false);
    if (!res.ok) {
      setSendError(res.error ?? 'Failed to send message.');
      return;
    }
    setComposer('');
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // --- Styling tokens --------------------------------------------------------
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
  const sidebarBg = isLight ? 'bg-[#F8FAFC]' : 'bg-white/[0.02]';
  const channelRowBase =
    'w-full flex items-center gap-2 rounded-md text-sm transition-colors';
  const channelRowInactive = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.04]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.04]';
  const channelRowActive = isLight
    ? 'text-[#0F172A] bg-[#0F172A]/[0.06]'
    : 'text-white bg-white/[0.08]';

  if (!activeOrg) {
    return (
      <div className={`px-4 py-8 rounded-md border ${border} text-center`}>
        <p className={`${subColor} text-sm`}>No organization linked to your profile.</p>
      </div>
    );
  }

  // --- Render ----------------------------------------------------------------
  function ChannelRow({
    active,
    onClick,
    icon,
    label,
    title,
  }: {
    active: boolean;
    onClick: () => void;
    icon: React.ReactNode;
    label: string;
    title?: string;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={!sidebarWide ? title ?? label : title}
        className={`${channelRowBase} ${active ? channelRowActive : channelRowInactive} ${
          sidebarWide ? 'px-2.5 py-1.5 justify-start' : 'px-1.5 py-1.5 justify-center'
        }`}
      >
        <span className="flex-shrink-0">{icon}</span>
        {sidebarWide && <span className="truncate">{label}</span>}
      </button>
    );
  }

  return (
    <section
      className={`flex border ${border} rounded-md overflow-hidden`}
      style={{ height: 'min(70vh, 600px)' }}
    >
      {/* Sidebar */}
      <aside
        className={`${sidebarBg} border-r ${border} flex flex-col flex-shrink-0 transition-[width] duration-150 ${
          sidebarWide ? 'w-56' : 'w-12'
        }`}
      >
        <div
          className={`flex items-center ${
            sidebarWide ? 'justify-between px-3' : 'justify-center px-1.5'
          } py-2 border-b ${border}`}
        >
          {sidebarWide && (
            <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
              Channels
            </p>
          )}
          <button
            type="button"
            onClick={() => setSidebarWide((w) => !w)}
            className={`p-1 rounded ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
            aria-label={sidebarWide ? 'Collapse channel list' : 'Expand channel list'}
            title={sidebarWide ? 'Collapse' : 'Expand'}
          >
            {sidebarWide ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-2 px-1.5 space-y-0.5">
          <ChannelRow
            active={activeChannel.kind === 'org'}
            onClick={() => setActiveChannel({ kind: 'org' })}
            icon={<MessageCircle size={13} />}
            label="general"
            title="Org-wide channel"
          />

          {chatProtocols.length > 0 && (
            <div className={`my-2 border-t ${border}`} />
          )}

          {channelsLoading && sidebarWide && (
            <p className={`${mutedColor} text-[10px] px-2`}>Loading…</p>
          )}

          {chatProtocols.map((p) => (
            <ChannelRow
              key={p.id}
              active={
                activeChannel.kind === 'protocol' && activeChannel.id === p.id
              }
              onClick={() => setActiveChannel({ kind: 'protocol', id: p.id })}
              icon={<Hash size={13} />}
              label={p.code}
              title={p.name || p.code}
            />
          ))}
        </nav>
      </aside>

      {/* Main pane */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Channel header */}
        <header className={`flex items-baseline gap-2 px-4 py-2.5 border-b ${border}`}>
          {activeChannel.kind === 'org' ? (
            <MessageCircle size={13} className={mutedColor} />
          ) : (
            <Hash size={13} className={mutedColor} />
          )}
          <h3 className={`${headingColor} text-sm font-semibold`}>
            {activeChannel.kind === 'org' ? '#general' : `#${channelLabel}`}
          </h3>
          {channelSubLabel && (
            <p className={`${subColor} text-[11px] truncate`}>{channelSubLabel}</p>
          )}
        </header>

        {active.error && (
          <div
            className={`m-3 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
              isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
            }`}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{active.error}</span>
          </div>
        )}

        <div
          ref={listRef}
          onScroll={handleScroll}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3"
        >
          {active.loading ? (
            <p className={`${subColor} text-sm`}>Loading messages…</p>
          ) : active.messages.length === 0 ? (
            <p className={`${subColor} text-sm text-center py-8`}>
              No messages yet. Be the first to say something.
            </p>
          ) : (
            active.messages.map((m) => {
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
                    className={`${mutedColor} text-[10px] mt-0.5 ${
                      isSelf ? 'mr-1' : 'ml-1'
                    }`}
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
            className={`mx-3 mb-2 flex items-start gap-2 px-3 py-2 rounded-md text-xs ${
              isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
            }`}
          >
            <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
            <span>{sendError}</span>
          </div>
        )}

        <div className={`border-t ${border} p-2 flex items-end gap-2`}>
          <textarea
            ref={textareaRef}
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message #${channelLabel}… (Enter to send, Shift+Enter for newline)`}
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
          <p
            className={`px-3 pb-2 text-[11px] ${
              isLight ? 'text-rose-700' : 'text-rose-300'
            }`}
          >
            Message exceeds the {MAX_MESSAGE_LENGTH.toLocaleString()} character limit.
          </p>
        )}
      </div>
    </section>
  );
}
