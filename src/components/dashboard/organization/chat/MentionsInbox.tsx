import { useMemo } from 'react';
import { AtSign, MessageCircle, Hash, X, ArrowRight } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAuth } from '../../../../context/AuthContext';
import { useOrg } from '../../../../context/OrgContext';
import { useMentionsInbox } from '../../../../hooks/useMentionsInbox';
import {
  listOrgMembersWithProfile,
  listMyChatProtocols,
} from '../../../../lib/orgs/orgsApi';
import { useEffect, useState } from 'react';
import type {
  OrgMemberWithProfile,
  ChatProtocolSummary,
} from '../../../../types/orgs';

// =============================================================================
// MentionsInbox — side panel listing every @-mention for the current user
// across all channels. Triggered from a bell icon in the navbar.
//
// Each row: sender, channel, message preview, relative timestamp,
// unread dot. Click → calls onNavigate(channelKey, messageId) which
// the App-level navigation handler picks up to switch to Org → Chat →
// the right channel + scroll to the message.
//
// `read_at` flips happen via the existing markChatMentionsRead path
// when the user opens the channel; this panel doesn't mutate state.
// =============================================================================

const MENTION_TOKEN_REGEX =
  /<@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})>/g;

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const isToday = d.toDateString() === new Date().toDateString();
  if (isToday) {
    return `Today at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface MentionsInboxProps {
  onClose: () => void;
  onNavigate: (
    channelKey: 'org' | `protocol:${string}`,
    messageId: string,
  ) => void;
}

export default function MentionsInbox({ onClose, onNavigate }: MentionsInboxProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const { activeOrg } = useOrg();

  const { rows, loading } = useMentionsInbox({ userId, enabled: true });

  // Resolve sender names + channel labels client-side via the org's member
  // list and the user's accessible protocols. Both are small and cached.
  const [profiles, setProfiles] = useState<Map<string, OrgMemberWithProfile>>(
    new Map(),
  );
  const [protocolsByKey, setProtocolsByKey] = useState<
    Map<string, ChatProtocolSummary>
  >(new Map());

  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    Promise.all([
      listOrgMembersWithProfile(activeOrg.id),
      listMyChatProtocols(activeOrg.id),
    ]).then(([memRes, protoRes]) => {
      if (cancelled) return;
      if (memRes.ok) setProfiles(new Map(memRes.data.map((m) => [m.user_id, m])));
      if (protoRes.ok) {
        setProtocolsByKey(new Map(protoRes.data.map((p) => [p.id, p])));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  const senderName = (uid: string | null) => {
    if (!uid) return 'Deleted user';
    return profiles.get(uid)?.name ?? 'Unknown';
  };

  /** Plain-text preview: strip <@uuid> tokens, replacing with @FirstName
   *  if the user is in the local profile cache. Long previews truncated by
   *  the API; this just resolves tokens. */
  const renderPreview = (body: string): string => {
    return body.replace(MENTION_TOKEN_REGEX, (_, uid: string) => {
      const m = profiles.get(uid);
      if (!m) return '@unknown';
      const first = m.name.split(/\s+/)[0];
      return `@${first}`;
    });
  };

  const unreadCount = useMemo(
    () => rows.filter((r) => !r.read_at).length,
    [rows],
  );

  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const accent = isLight ? 'text-amber-600' : 'text-amber-400';

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
            <AtSign size={15} className={accent} />
            Mentions
            {unreadCount > 0 && (
              <span
                className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  isLight ? 'bg-amber-500 text-white' : 'bg-amber-400 text-[#0F172A]'
                }`}
              >
                {unreadCount} unread
              </span>
            )}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${
              isLight
                ? 'text-[#334155]/70 hover:bg-[#0F172A]/[0.05]'
                : 'text-[#CBD5E1]/70 hover:bg-white/[0.05]'
            }`}
            aria-label="Close inbox"
          >
            <X size={14} />
          </button>
        </div>

        {loading && rows.length === 0 ? (
          <p className={`${subColor} text-sm text-center py-8`}>Loading…</p>
        ) : rows.length === 0 ? (
          <p className={`${subColor} text-sm text-center py-8`}>
            No mentions yet. When someone @-mentions you, the message will
            show up here.
          </p>
        ) : (
          <ul>
            {rows.map((r) => {
              const channelLabel =
                r.channel_kind === 'org'
                  ? '#general'
                  : `#${protocolsByKey.get(r.channel_id)?.code ?? 'protocol'}`;
              const isUnread = !r.read_at;
              const channelKey: 'org' | `protocol:${string}` =
                r.channel_kind === 'org' ? 'org' : `protocol:${r.channel_id}`;
              return (
                <li
                  key={r.id}
                  className={`border-b ${border} ${isLight ? 'hover:bg-[#0F172A]/[0.02]' : 'hover:bg-white/[0.02]'}`}
                >
                  <button
                    type="button"
                    onClick={() => onNavigate(channelKey, r.message_id)}
                    className="w-full text-left px-5 py-3 flex items-start gap-3"
                  >
                    <span
                      className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${
                        isUnread
                          ? isLight
                            ? 'bg-amber-500'
                            : 'bg-amber-400'
                          : isLight
                            ? 'bg-transparent border border-[#E2E8F0]'
                            : 'bg-transparent border border-white/10'
                      }`}
                      aria-label={isUnread ? 'Unread mention' : 'Read mention'}
                    />
                    <div className="min-w-0 flex-1">
                      <div className={`flex items-center gap-1.5 text-[11px] ${subColor}`}>
                        <span className={`${headingColor} font-medium`}>
                          {senderName(r.mentioned_by_user_id)}
                        </span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-0.5">
                          {r.channel_kind === 'org' ? (
                            <MessageCircle size={10} className={mutedColor} />
                          ) : (
                            <Hash size={10} className={mutedColor} />
                          )}
                          {channelLabel}
                        </span>
                        <span>·</span>
                        <span title={new Date(r.created_at).toLocaleString()}>
                          {formatRelative(r.created_at)}
                        </span>
                      </div>
                      <p
                        className={`${headingColor} text-sm mt-1 line-clamp-2`}
                      >
                        {renderPreview(r.body_preview)}
                      </p>
                    </div>
                    <ArrowRight size={13} className={`${mutedColor} flex-shrink-0 mt-1`} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>
    </div>
  );
}
