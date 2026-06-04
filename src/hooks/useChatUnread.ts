import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

// =============================================================================
// useChatUnread — per-channel unread counts for the chat sidebar.
//
// localStorage holds `piq-chat-lastview-{key}` as an ISO timestamp of when
// the user last had that channel active. Unread count = messages with
// `created_at > last_viewed`. Subscribes to INSERTs on every accessible
// channel so counts update live while the user is on the Chat tab.
//
// Signature:
//   useChatUnread({
//     orgId,                 // active org's id; null = no subscriptions
//     protocolIds,           // accessible protocol channels
//     activeChannelKey,      // 'org' | `protocol:{id}` — never badges this one
//     currentUserId,         // skip badges for the user's own posts
//   })
//
// Returns:
//   {
//     counts: Map<channelKey, number>,
//     markAsRead: (key) => void,    // resets count + writes now() to localStorage
//   }
//
// Channel-key convention:
//   - 'org' for the org-wide #general channel
//   - `protocol:{protocolId}` for per-protocol channels
//
// New-user behaviour: if no `piq-chat-lastview-{key}` entry exists when the
// hook first sees a channel, it initializes it to `now()` rather than the
// epoch. Otherwise a fresh login would show every historical message as
// unread (four-digit badge on the first chat open is jarring and useless).
// =============================================================================

const STORAGE_PREFIX = 'piq-chat-lastview-';
const UNREAD_CAP = 99; // display caps at "99+"

export type ChatChannelKey = 'org' | `protocol:${string}`;

function storageKey(key: ChatChannelKey): string {
  return `${STORAGE_PREFIX}${key}`;
}

function readLastViewed(key: ChatChannelKey): string {
  try {
    const v = localStorage.getItem(storageKey(key));
    if (v) return v;
  } catch {
    /* ignore */
  }
  // First time we see this channel — pretend the user has "just" caught up
  // so historic messages don't all count as unread.
  const now = new Date().toISOString();
  try {
    localStorage.setItem(storageKey(key), now);
  } catch {
    /* ignore */
  }
  return now;
}

function writeLastViewed(key: ChatChannelKey, iso: string): void {
  try {
    localStorage.setItem(storageKey(key), iso);
  } catch {
    /* ignore */
  }
}

interface UseChatUnreadParams {
  orgId: string | null;
  protocolIds: string[];
  activeChannelKey: ChatChannelKey;
  currentUserId: string | null;
}

export interface UseChatUnreadResult {
  counts: Map<ChatChannelKey, number>;
  /** Reset count to 0 and stamp `last_viewed_at = now()` for this channel. */
  markAsRead: (key: ChatChannelKey) => void;
  /** Numeric cap used for display ("99+" beyond this). */
  unreadCap: number;
}

export function useChatUnread({
  orgId,
  protocolIds,
  activeChannelKey,
  currentUserId,
}: UseChatUnreadParams): UseChatUnreadResult {
  const [counts, setCounts] = useState<Map<ChatChannelKey, number>>(new Map());

  // Stable refs so the realtime callbacks always see the latest values
  // without re-subscribing on every render.
  const activeKeyRef = useRef<ChatChannelKey>(activeChannelKey);
  activeKeyRef.current = activeChannelKey;
  const currentUserIdRef = useRef<string | null>(currentUserId);
  currentUserIdRef.current = currentUserId;

  const markAsRead = useCallback((key: ChatChannelKey) => {
    setCounts((prev) => {
      if ((prev.get(key) ?? 0) === 0) return prev;
      const next = new Map(prev);
      next.set(key, 0);
      return next;
    });
    writeLastViewed(key, new Date().toISOString());
  }, []);

  // Whenever the active channel changes, treat the new active as read.
  useEffect(() => {
    markAsRead(activeChannelKey);
  }, [activeChannelKey, markAsRead]);

  // Stable list of channels — sorted so the dependency stays stable across
  // renders even if the parent re-orders the array.
  const channelKeys: ChatChannelKey[] = useMemo(() => {
    const keys: ChatChannelKey[] = [];
    if (orgId) keys.push('org');
    const sorted = [...protocolIds].sort();
    for (const id of sorted) keys.push(`protocol:${id}`);
    return keys;
  }, [orgId, protocolIds]);

  // Initial fetch of unread counts per channel, then subscribe to INSERTs.
  useEffect(() => {
    if (!orgId) {
      setCounts(new Map());
      return;
    }
    let cancelled = false;

    // Snapshot last-viewed for each channel so the realtime handlers can
    // compare incoming created_at against it without re-reading localStorage
    // on every event.
    const lastViewedSnapshot = new Map<ChatChannelKey, string>();
    for (const key of channelKeys) {
      lastViewedSnapshot.set(key, readLastViewed(key));
    }

    // Initial count fetch — parallel per channel.
    async function fetchInitial() {
      const results = await Promise.all(
        channelKeys.map(async (key) => {
          const lastViewed = lastViewedSnapshot.get(key)!;
          if (key === 'org') {
            const { count } = await supabase
              .from('org_messages')
              .select('*', { count: 'exact', head: true })
              .eq('org_id', orgId)
              .gt('created_at', lastViewed);
            return [key, count ?? 0] as const;
          }
          const protocolId = key.slice('protocol:'.length);
          const { count } = await supabase
            .from('protocol_messages')
            .select('*', { count: 'exact', head: true })
            .eq('protocol_id', protocolId)
            .gt('created_at', lastViewed);
          return [key, count ?? 0] as const;
        }),
      );
      if (cancelled) return;
      const next = new Map<ChatChannelKey, number>();
      for (const [key, n] of results) {
        // The active channel is always read; never badge it on the
        // initial snapshot even if there were messages between last
        // session's mark-as-read write and this render.
        next.set(key, key === activeKeyRef.current ? 0 : n);
      }
      setCounts(next);
      // If the active channel had a non-zero initial count, persist the
      // "we just looked at it" timestamp so a refresh starts clean.
      if ((next.get(activeKeyRef.current) ?? 0) === 0) {
        writeLastViewed(activeKeyRef.current, new Date().toISOString());
      }
    }
    fetchInitial();

    // Realtime: one subscription per accessible channel.
    const channels = channelKeys.map((key) => {
      const isOrg = key === 'org';
      const subjectId = isOrg ? orgId : key.slice('protocol:'.length);
      const filterField = isOrg ? 'org_id' : 'protocol_id';
      const table = isOrg ? 'org_messages' : 'protocol_messages';
      return supabase
        .channel(`unread:${key}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table,
            filter: `${filterField}=eq.${subjectId}`,
          },
          (payload) => {
            const row = payload.new as {
              author_user_id?: string | null;
            };
            // Don't badge the user's own posts.
            if (
              currentUserIdRef.current &&
              row.author_user_id === currentUserIdRef.current
            ) {
              return;
            }
            // Active channel: don't badge; the user is reading it. The
            // active channel's own context already renders the message.
            if (key === activeKeyRef.current) {
              writeLastViewed(key, new Date().toISOString());
              return;
            }
            setCounts((prev) => {
              const next = new Map(prev);
              next.set(key, (next.get(key) ?? 0) + 1);
              return next;
            });
          },
        )
        .subscribe();
    });

    return () => {
      cancelled = true;
      for (const ch of channels) supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, channelKeys.join('|')]);

  return { counts, markAsRead, unreadCap: UNREAD_CAP };
}
