import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { listMyUnreadMentions } from '../lib/orgs/orgsApi';
import { type ChatMentionRow } from '../lib/orgs/chatMentionsAdapter';

// =============================================================================
// UnreadMentionsContext — total unread @mention count for the current user
// across every chat channel. Subscribes once at the App-tree level so the
// count is available from any page (Navbar badge, etc.), not just inside
// the Chat tab.
//
// This is intentionally duplicated work with the per-channel mention
// tracking in `useChatUnread` — both subscribe to `chat_mentions` filtered
// by the current user. The provider keeps a single aggregate; the chat
// hook breaks down per channel. One extra subscription is cheap and
// avoids the bigger refactor of routing per-channel counts back through a
// shared provider.
// =============================================================================

interface UnreadMentionsContextValue {
  totalUnread: number;
}

const UnreadMentionsContext = createContext<UnreadMentionsContextValue>({
  totalUnread: 0,
});

export function UnreadMentionsProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [totalUnread, setTotalUnread] = useState(0);

  // Initial fetch + realtime subscription. Re-runs whenever the userId
  // changes (login / logout / account switch).
  useEffect(() => {
    if (!userId) {
      setTotalUnread(0);
      return;
    }
    let cancelled = false;

    (async () => {
      const res = await listMyUnreadMentions();
      if (cancelled) return;
      if (res.ok) setTotalUnread(res.data.length);
    })();

    const channel = supabase
      .channel(`unread_mentions:user:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_mentions',
          filter: `mentioned_user_id=eq.${userId}`,
        },
        () => {
          setTotalUnread((n) => n + 1);
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_mentions',
          filter: `mentioned_user_id=eq.${userId}`,
        },
        (payload) => {
          // Only act on null → non-null read_at transitions.
          const oldRow = payload.old as Partial<ChatMentionRow> | null;
          const newRow = payload.new as ChatMentionRow;
          if (oldRow?.read_at !== null && oldRow?.read_at !== undefined) return;
          if (newRow.read_at === null) return;
          setTotalUnread((n) => Math.max(0, n - 1));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <UnreadMentionsContext.Provider value={{ totalUnread }}>
      {children}
    </UnreadMentionsContext.Provider>
  );
}

export function useUnreadMentions(): UnreadMentionsContextValue {
  return useContext(UnreadMentionsContext);
}

/** Convenience: total count + a stringified `99+`-capped display. */
export function useUnreadMentionsDisplay(): { count: number; display: string } {
  const { totalUnread } = useUnreadMentions();
  const display = totalUnread > 99 ? '99+' : String(totalUnread);
  return { count: totalUnread, display };
}
