import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  listMyMentionsWithContext,
  type MentionInboxRow,
} from '../lib/orgs/orgsApi';

// =============================================================================
// useMentionsInbox — full per-user mention list for the inbox panel.
//
// Different from UnreadMentionsContext (which only tracks a count): this
// hook fetches the hydrated rows including message body previews + channel
// info, so the inbox panel can render each row without per-row follow-up
// fetches.
//
// Realtime: subscribes to `chat_mentions` filtered by mentioned_user_id =
// current user. On INSERT or UPDATE, refetches the list (debounced). This
// is wasteful but simple — the inbox is small (≤200 rows) and only rendered
// when the panel is open in v1.
// =============================================================================

interface UseMentionsInboxParams {
  userId: string | null;
  /** Pass `true` only when the panel is open so we don't keep an extra
   *  subscription alive when the user can't see the data. */
  enabled: boolean;
}

interface UseMentionsInboxResult {
  rows: MentionInboxRow[];
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useMentionsInbox({
  userId,
  enabled,
}: UseMentionsInboxParams): UseMentionsInboxResult {
  const [rows, setRows] = useState<MentionInboxRow[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setRows([]);
      return;
    }
    setLoading(true);
    const res = await listMyMentionsWithContext(200);
    setLoading(false);
    if (res.ok) setRows(res.data);
  }, [userId]);

  useEffect(() => {
    if (!enabled || !userId) return;
    refresh();
    const channel = supabase
      .channel(`mentions_inbox:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_mentions',
          filter: `mentioned_user_id=eq.${userId}`,
        },
        () => {
          // Lightweight: just refetch. Inbox is bounded at 200 rows.
          refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, userId, refresh]);

  return { rows, loading, refresh };
}
