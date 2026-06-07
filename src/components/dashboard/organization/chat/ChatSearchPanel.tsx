import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useOrg } from '../../../../context/OrgContext';
import { useChatNavigation } from '../../../../context/ChatNavigationContext';
import {
  searchChatMessages,
  listOrgMembersWithProfile,
  listMyChatProtocols,
  type ChatSearchHit,
} from '../../../../lib/orgs/orgsApi';
import {
  buildSnippet,
  splitForHighlight,
} from '../../../../lib/orgs/chatSearchAdapter';
import type { ChatProtocolSummary, OrgMemberWithProfile } from '../../../../types/orgs';

// =============================================================================
// ChatSearchPanel — slide-in panel with a query input + results list.
//
// Stateless query: every keystroke debounces to a fresh searchChatMessages
// call. RLS scopes results to channels the caller can read. Result row
// click deep-links to the message via navigateToOrgChat.
// =============================================================================

const DEBOUNCE_MS = 250;

interface ChatSearchPanelProps {
  onClose: () => void;
}

function relativeShort(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

export default function ChatSearchPanel({ onClose }: ChatSearchPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { navigateToOrgChat } = useChatNavigation();

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ChatSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMemberWithProfile[]>([]);
  const [protocols, setProtocols] = useState<ChatProtocolSummary[]>([]);

  // Load names + protocol codes for label resolution. One-shot at mount.
  useEffect(() => {
    if (!activeOrg) return;
    let cancelled = false;
    (async () => {
      const [mRes, pRes] = await Promise.all([
        listOrgMembersWithProfile(activeOrg.id),
        listMyChatProtocols(activeOrg.id),
      ]);
      if (cancelled) return;
      if (mRes.ok) setMembers(mRes.data);
      if (pRes.ok) setProtocols(pRes.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrg]);

  // Debounced search.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const res = await searchChatMessages({ query: trimmed });
      setLoading(false);
      if (res.ok) {
        setHits(res.data);
        setError(null);
      } else {
        setHits([]);
        setError(res.error);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  // ESC to close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Name + protocol-code lookups.
  const nameByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const member of members) m.set(member.user_id, member.name);
    return m;
  }, [members]);
  const protocolByid = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of protocols) m.set(p.id, p.code);
    return m;
  }, [protocols]);

  const handleResultClick = useCallback(
    (hit: ChatSearchHit) => {
      const channelKey: 'org' | `protocol:${string}` = hit.org_id
        ? 'org'
        : `protocol:${hit.protocol_id ?? ''}`;
      navigateToOrgChat(channelKey, hit.id);
      onClose();
    },
    [navigateToOrgChat, onClose],
  );

  // Theme.
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bg = isLight ? 'bg-white' : 'bg-[#0B1220]';
  const inputBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#1E293B] border-white/10';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const rowHover = isLight ? 'hover:bg-[#0F172A]/[0.03]' : 'hover:bg-white/[0.03]';

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        className={`fixed top-0 right-0 bottom-0 z-50 w-full max-w-md flex flex-col border-l ${border} ${bg} shadow-xl`}
        role="dialog"
        aria-label="Search chat"
      >
        {/* Header */}
        <div className={`flex-shrink-0 flex items-center justify-between px-4 py-3 border-b ${border}`}>
          <p className={`${headingColor} text-sm font-semibold`}>Search chat</p>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${isLight ? 'hover:bg-[#0F172A]/[0.05]' : 'hover:bg-white/[0.05]'}`}
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>

        {/* Query input */}
        <div className={`flex-shrink-0 px-3 py-2.5 border-b ${border}`}>
          <div className="relative">
            <Search
              size={13}
              className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${mutedColor}`}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search messages across all channels…"
              autoFocus
              className={`w-full text-sm rounded-md border pl-8 pr-2.5 py-1.5 ${inputBg} ${headingColor} focus:outline-none focus:ring-2 focus:ring-brand-600/30`}
            />
          </div>
        </div>

        {/* Results */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {error && (
            <div className={`mx-3 mt-3 px-2.5 py-1.5 rounded-md text-xs ${
              isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
            }`}>
              {error}
            </div>
          )}

          {query.trim().length < 2 ? (
            <p className={`${subColor} text-xs italic p-4`}>
              Type at least 2 characters to search.
            </p>
          ) : loading ? (
            <p className={`${subColor} text-xs italic p-4`}>Searching…</p>
          ) : hits.length === 0 ? (
            <p className={`${subColor} text-xs italic p-4`}>
              No messages match "{query.trim()}".
            </p>
          ) : (
            <ul className={`divide-y ${border}`}>
              {hits.map((hit) => {
                const channelLabel = hit.org_id
                  ? '#general'
                  : `#${protocolByid.get(hit.protocol_id ?? '') ?? 'protocol'}`;
                const authorName = hit.author_user_id
                  ? nameByUserId.get(hit.author_user_id) ?? 'Unknown'
                  : 'Deleted user';
                const snippet = buildSnippet(hit.body, query.trim());
                const segments = splitForHighlight(snippet, query.trim());
                return (
                  <li key={`${hit.org_id ? 'o' : 'p'}-${hit.id}`}>
                    <button
                      type="button"
                      onClick={() => handleResultClick(hit)}
                      className={`w-full text-left px-3 py-2.5 ${rowHover}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <span className={`${headingColor} text-[11px] font-semibold`}>
                          {channelLabel}
                        </span>
                        <span className={`${mutedColor} text-[11px] flex-shrink-0`}>
                          {relativeShort(hit.created_at)}
                        </span>
                      </div>
                      <p className={`${mutedColor} text-[11px] mb-0.5`}>{authorName}</p>
                      <p className={`${subColor} text-xs leading-relaxed break-words`}>
                        {segments.map((seg, idx) =>
                          idx % 2 === 1 ? (
                            <mark
                              key={idx}
                              className={
                                isLight
                                  ? 'bg-amber-100 text-amber-900 rounded px-0.5'
                                  : 'bg-amber-500/30 text-amber-100 rounded px-0.5'
                              }
                            >
                              {seg}
                            </mark>
                          ) : (
                            <span key={idx}>{seg}</span>
                          ),
                        )}
                      </p>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
