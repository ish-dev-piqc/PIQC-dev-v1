import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AtSign, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuth } from '../../../context/AuthContext';
import { useOrg } from '../../../context/OrgContext';
import { useChatNavigation } from '../../../context/ChatNavigationContext';
import {
  listMyChatProtocols,
  listMyMentionsWithContext,
  listOrgMembersWithProfile,
  listOrgMessages,
  listProtocolMessages,
  postOrgMessage,
  postProtocolMessage,
  type MentionInboxRow,
} from '../../../lib/orgs/orgsApi';
import type {
  ChatProtocolSummary,
  OrgMemberWithProfile,
  OrgMessage,
  ProtocolMessage,
} from '../../../types/orgs';

// =============================================================================
// ChatOverlayPanel — slide-in chat surface from the LeftRail. Lets users
// send messages without leaving their current mode/page.
//
// Scope is intentionally narrower than the hub's full Chat tab:
//   - No threads (use hub).
//   - No reactions (use hub).
//   - No decisions / acks (use hub).
//   - No attachments (use hub).
//   - Composer is text-only.
//
// Channel pills: Mentions (filter), #general, and protocol channels.
// Last-active channel persists in `piq-chat-overlay-channel-v1`.
//
// Opens via:
//   - Rail Chat icon click (no initial filter — restores last channel)
//   - Navbar bell click (forces `filter='mentions'`)
// =============================================================================

const CHANNEL_STORAGE_KEY = 'piq-chat-overlay-channel-v1';

type ChannelKey = 'mentions' | 'org' | `protocol:${string}`;

interface ChatOverlayPanelProps {
  onClose: () => void;
  initialFilter?: 'mentions';
}

interface UnifiedMessage {
  id: string;
  author_user_id: string | null;
  body: string;
  created_at: string;
  deleted_at: string | null;
}

function readStoredChannel(): ChannelKey | null {
  try {
    const v = localStorage.getItem(CHANNEL_STORAGE_KEY);
    if (!v) return null;
    if (v === 'mentions' || v === 'org' || v.startsWith('protocol:')) {
      return v as ChannelKey;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistChannel(key: ChannelKey) {
  try {
    localStorage.setItem(CHANNEL_STORAGE_KEY, key);
  } catch {
    /* ignore */
  }
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}

export default function ChatOverlayPanel({
  onClose,
  initialFilter,
}: ChatOverlayPanelProps) {
  const { theme } = useTheme();
  const { user } = useAuth();
  const { activeOrg } = useOrg();
  const { navigateToOrgChat } = useChatNavigation();
  const isLight = theme === 'light';

  const currentUserId = user?.id ?? null;

  const [protocols, setProtocols] = useState<ChatProtocolSummary[]>([]);
  const [members, setMembers] = useState<OrgMemberWithProfile[]>([]);
  const [activeChannel, setActiveChannel] = useState<ChannelKey>(() => {
    if (initialFilter === 'mentions') return 'mentions';
    return readStoredChannel() ?? 'org';
  });

  const [messages, setMessages] = useState<UnifiedMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [mentions, setMentions] = useState<MentionInboxRow[]>([]);
  const [composer, setComposer] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Persist channel changes (except mentions — that one's always a
  // jump-to filter, not a parking spot).
  useEffect(() => {
    if (activeChannel !== 'mentions') persistChannel(activeChannel);
  }, [activeChannel]);

  // Load protocol list + member names once on open. Drives the channel
  // pills and the per-message author labels.
  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    (async () => {
      const [pRes, mRes] = await Promise.all([
        listMyChatProtocols(activeOrg.id),
        listOrgMembersWithProfile(activeOrg.id),
      ]);
      if (cancelled) return;
      if (pRes.ok) setProtocols(pRes.data);
      if (mRes.ok) setMembers(mRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const member of members) m.set(member.user_id, firstName(member.name));
    return m;
  }, [members]);

  // Channel data load — refetches whenever activeChannel changes.
  const loadChannel = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setMessages([]);
    if (activeChannel === 'mentions') {
      const res = await listMyMentionsWithContext(50);
      setLoading(false);
      // Mark-read semantics across channels need a different API shape
      // than markChatMentionsRead (which is per-channel). Polish PR will
      // add a sweep call once the API supports a list-of-ids form.
      if (res.ok) setMentions(res.data);
      return;
    }
    if (activeChannel === 'org') {
      const res = await listOrgMessages(activeOrg.id);
      setLoading(false);
      if (res.ok) {
        setMessages(
          res.data
            .filter((m: OrgMessage) => !m.parent_message_id)
            .map((m: OrgMessage) => ({
              id: m.id,
              author_user_id: m.author_user_id,
              body: m.body,
              created_at: m.created_at,
              deleted_at: m.deleted_at,
            })),
        );
      }
      return;
    }
    // protocol:<id>
    const protocolId = activeChannel.slice('protocol:'.length);
    const res = await listProtocolMessages(protocolId);
    setLoading(false);
    if (res.ok) {
      setMessages(
        res.data
          .filter((m: ProtocolMessage) => !m.parent_message_id)
          .map((m: ProtocolMessage) => ({
            id: m.id,
            author_user_id: m.author_user_id,
            body: m.body,
            created_at: m.created_at,
            deleted_at: m.deleted_at,
          })),
      );
    }
  }, [activeChannel, activeOrg]);

  useEffect(() => {
    loadChannel();
  }, [loadChannel]);

  // Send message — only meaningful in channel views (mentions is read-only).
  const handleSend = async () => {
    const text = composer.trim();
    if (!text || !activeOrg || sending) return;
    if (activeChannel === 'mentions') return;
    setSending(true);
    setSendError(null);
    const res =
      activeChannel === 'org'
        ? await postOrgMessage(activeOrg.id, text)
        : await postProtocolMessage(
            activeChannel.slice('protocol:'.length),
            text,
          );
    setSending(false);
    if (res.ok) {
      setComposer('');
      // Refetch to surface the new message + any racing inserts.
      loadChannel();
    } else {
      setSendError(res.error);
    }
  };

  // ESC closes overlay.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Auto-scroll to bottom on channel switch + after every refetch.
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeChannel]);

  // Click handler for a mention row — jumps the overlay to that channel.
  const handleMentionClick = (row: MentionInboxRow) => {
    const key: ChannelKey =
      row.channel_kind === 'org' ? 'org' : `protocol:${row.channel_id}`;
    setActiveChannel(key);
  };

  // -- Theming ---------------------------------------------------------------
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bg = isLight ? 'bg-white' : 'bg-[#0B1220]';
  const inputBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const chipIdleClass = isLight
    ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.04]'
    : 'text-[#CBD5E1]/70 hover:bg-white/[0.04]';
  const chipChannelActive = isLight
    ? 'bg-[#FAECE7] text-[#993C1D] font-medium'
    : 'bg-[rgba(216,90,48,0.18)] text-[#F0997B] font-medium';
  const chipMentionsActive = isLight
    ? 'bg-[#FAEEDA] text-[#854F0B] font-medium'
    : 'bg-[rgba(239,159,39,0.18)] text-[#EF9F27] font-medium';
  const sendButton = isLight
    ? 'bg-[#D85A30] hover:bg-[#993C1D] text-white'
    : 'bg-[#D85A30] hover:bg-[#993C1D] text-white';
  const footerLink = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A]'
    : 'text-[#CBD5E1]/55 hover:text-white';

  const channelLabel = (() => {
    if (activeChannel === 'mentions') return 'Mentions';
    if (activeChannel === 'org') return '#general';
    const id = activeChannel.slice('protocol:'.length);
    const code = protocols.find((p) => p.id === id)?.code ?? 'protocol';
    return `#${code}`;
  })();

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        // Mobile (<md): bottom sheet — slides up from bottom, full width,
        // ~85vh, top-rounded with a small drag-handle visual.
        // Desktop (>=md): right-side slide-in, full height, max-w-sm.
        className={`fixed z-50 flex flex-col ${bg} shadow-xl
          left-0 right-0 bottom-0 top-auto h-[85vh] max-h-[85vh] rounded-t-2xl border-t ${border}
          md:left-auto md:right-0 md:top-0 md:bottom-0 md:h-auto md:max-h-none md:w-full md:max-w-sm md:rounded-none md:border-t-0 md:border-l`}
        role="dialog"
        aria-label="Chat"
      >
        {/* Drag handle — only visible on mobile bottom-sheet. Purely visual
            for now; touch-drag-to-dismiss can land in a polish follow-up. */}
        <div
          className="md:hidden flex justify-center pt-1.5 pb-1"
          aria-hidden="true"
        >
          <span
            className={`block h-1 w-10 rounded-full ${
              isLight ? 'bg-[#E2E8F0]' : 'bg-white/15'
            }`}
          />
        </div>
        {/* Header */}
        <div className={`flex-shrink-0 flex items-center justify-between px-3 py-2.5 border-b ${border}`}>
          <div className="flex items-center gap-2 min-w-0">
            <MessageCircle size={14} className={isLight ? 'text-[#993C1D]' : 'text-[#F0997B]'} />
            <p className={`${headingColor} text-sm font-semibold truncate`}>{channelLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.05]'}`}
            aria-label="Close chat"
          >
            <X size={14} />
          </button>
        </div>

        {/* Channel pills */}
        <div className={`flex-shrink-0 flex gap-1 px-3 py-2 overflow-x-auto border-b ${border}`}>
          <button
            type="button"
            onClick={() => setActiveChannel('mentions')}
            className={`inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap ${
              activeChannel === 'mentions' ? chipMentionsActive : chipIdleClass
            }`}
          >
            <AtSign size={11} />
            Mentions
          </button>
          <button
            type="button"
            onClick={() => setActiveChannel('org')}
            className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap ${
              activeChannel === 'org' ? chipChannelActive : chipIdleClass
            }`}
          >
            # general
          </button>
          {protocols.map((p) => {
            const key: ChannelKey = `protocol:${p.id}`;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveChannel(key)}
                className={`text-[11px] px-2.5 py-1 rounded-full whitespace-nowrap ${
                  activeChannel === key ? chipChannelActive : chipIdleClass
                }`}
              >
                # {p.code}
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div
          ref={listRef}
          className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2.5"
        >
          {loading ? (
            <p className={`${subColor} text-xs italic`}>Loading…</p>
          ) : activeChannel === 'mentions' ? (
            mentions.length === 0 ? (
              <p className={`${subColor} text-xs italic`}>
                No mentions yet. When someone @-mentions you, they'll show up here.
              </p>
            ) : (
              mentions.map((row) => {
                const author = row.mentioned_by_user_id
                  ? nameByUserId.get(row.mentioned_by_user_id) ?? 'Someone'
                  : 'Someone';
                const channelText =
                  row.channel_kind === 'org'
                    ? '#general'
                    : `#${protocols.find((p) => p.id === row.channel_id)?.code ?? 'protocol'}`;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => handleMentionClick(row)}
                    className={`w-full text-left rounded-md p-2.5 border ${border} ${
                      isLight ? 'hover:bg-[#0F172A]/[0.03]' : 'hover:bg-white/[0.03]'
                    }`}
                    style={
                      !row.read_at
                        ? { borderLeftColor: '#BA7517', borderLeftWidth: '2px' }
                        : undefined
                    }
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`${headingColor} text-[11px] font-semibold`}>
                        {channelText}
                      </span>
                      <span className={`${mutedColor} text-[10px]`}>
                        {relativeShort(row.created_at)}
                      </span>
                    </div>
                    <p className={`${mutedColor} text-[11px] mb-0.5`}>{author}</p>
                    <p className={`${subColor} text-xs leading-relaxed line-clamp-2`}>
                      {row.body_preview}
                    </p>
                  </button>
                );
              })
            )
          ) : messages.length === 0 ? (
            <p className={`${subColor} text-xs italic text-center py-4`}>
              No messages yet. Be the first to say something.
            </p>
          ) : (
            messages.map((m) => {
              const isSelf = m.author_user_id === currentUserId;
              const author = m.author_user_id
                ? nameByUserId.get(m.author_user_id) ?? 'Someone'
                : 'Deleted user';
              return (
                <div
                  key={m.id}
                  className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
                >
                  {!isSelf && (
                    <p className={`${mutedColor} text-[10px] mb-0.5 ml-1`}>{author}</p>
                  )}
                  <div
                    className={`rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words max-w-[85%] ${
                      isSelf
                        ? isLight
                          ? 'bg-brand-600/[0.10] text-[#0F172A]'
                          : 'bg-brand-300/[0.15] text-white'
                        : isLight
                          ? 'bg-[#F1F5F9] text-[#0F172A]'
                          : 'bg-white/[0.04] text-[#E2E8F0]'
                    }`}
                  >
                    {m.deleted_at ? (
                      <span className={`italic ${subColor}`}>
                        (this message was deleted)
                      </span>
                    ) : (
                      m.body
                    )}
                  </div>
                  <p className={`${mutedColor} text-[10px] mt-0.5 ${isSelf ? 'mr-1' : 'ml-1'}`}>
                    {relativeShort(m.created_at)}
                  </p>
                </div>
              );
            })
          )}
        </div>

        {/* Composer — disabled in mentions view (read-only filter). */}
        {activeChannel !== 'mentions' && (
          <div className={`flex-shrink-0 border-t ${border} px-3 py-2.5`}>
            {sendError && (
              <div
                className={`mb-2 px-2.5 py-1.5 rounded-md text-xs ${
                  isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
                }`}
              >
                {sendError}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                placeholder={`Message ${channelLabel}…`}
                rows={1}
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
                disabled={sending || !composer.trim()}
                className={`inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-md ${sendButton} disabled:opacity-50`}
              >
                {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                Send
              </button>
            </div>
          </div>
        )}

        {/* Footer link to the hub's full Chat tab for heavy work. */}
        <button
          type="button"
          onClick={() => {
            // Route to the hub Chat tab. Channel context isn't preserved
            // across the jump; full Chat tab loads its own state.
            const channelKey: 'org' | `protocol:${string}` =
              activeChannel === 'mentions' ? 'org' : (activeChannel as 'org' | `protocol:${string}`);
            navigateToOrgChat(channelKey);
            onClose();
          }}
          className={`flex-shrink-0 px-3 py-2 text-[11px] border-t ${border} ${footerLink} text-center`}
        >
          Open full chat in workspace →
        </button>
      </div>
    </>
  );
}
