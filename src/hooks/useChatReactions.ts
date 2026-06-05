import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  listReactionsForOrgMessages,
  listReactionsForProtocolMessages,
} from '../lib/orgs/orgsApi';
import {
  adaptChatReaction,
  groupReactionsByMessage,
  type ChatReactionRow,
  type ReactionChip,
} from '../lib/orgs/chatReactionsAdapter';
import type { ChatReaction } from '../types/orgs';

// =============================================================================
// useChatReactions — fetch + realtime sub for the active channel's reactions.
//
// One subscription per channel (org or protocol). On mount we pull the
// reactions for the message page, then keep a realtime channel open on
// chat_reactions filtered by channel ref. INSERTs append; DELETEs remove.
//
// Returns a Map<messageId, ReactionChip[]> derived from the flat list so
// the consumer doesn't recompute on every render.
// =============================================================================

interface Args {
  /** Active channel — exactly one of org_id / protocol_id is set when active. */
  org_id?: string | null;
  protocol_id?: string | null;
  /** Loaded message ids (used to scope the initial fetch). Realtime sub
   *  covers the channel as a whole, so new messages' reactions arrive too. */
  messageIds: string[];
  /** Current user — feeds the selfReacted flag in the grouped output. */
  currentUserId: string | null;
}

interface Result {
  reactions: ChatReaction[];
  chipsByMessageId: Map<string, ReactionChip[]>;
  refresh: () => Promise<void>;
}

export function useChatReactions({
  org_id,
  protocol_id,
  messageIds,
  currentUserId,
}: Args): Result {
  const [reactions, setReactions] = useState<ChatReaction[]>([]);

  // Use refs so the realtime callback can fold INSERTs into the latest
  // list without stale closures.
  const orgIdRef = useRef<string | null>(null);
  const protocolIdRef = useRef<string | null>(null);
  orgIdRef.current = org_id ?? null;
  protocolIdRef.current = protocol_id ?? null;

  const refresh = useCallback(async () => {
    if (messageIds.length === 0) {
      setReactions([]);
      return;
    }
    if (orgIdRef.current) {
      const res = await listReactionsForOrgMessages(messageIds);
      if (res.ok) setReactions(res.data);
    } else if (protocolIdRef.current) {
      const res = await listReactionsForProtocolMessages(messageIds);
      if (res.ok) setReactions(res.data);
    }
  }, [messageIds]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime sub scoped to the active channel. One channel per
  // org_id/protocol_id; switches tear it down + re-subscribe.
  useEffect(() => {
    const active = org_id ?? protocol_id ?? null;
    if (!active) return;
    const filterCol = org_id ? 'org_id' : 'protocol_id';
    const channelName = `chat_reactions:${filterCol}:${active}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_reactions',
          filter: `${filterCol}=eq.${active}`,
        },
        (payload) => {
          const raw = payload.new as ChatReactionRow;
          const next = adaptChatReaction(raw);
          setReactions((prev) =>
            prev.some((r) => r.id === next.id) ? prev : [...prev, next],
          );
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_reactions',
          filter: `${filterCol}=eq.${active}`,
        },
        (payload) => {
          const oldId = (payload.old as { id?: string }).id;
          if (!oldId) return;
          setReactions((prev) => prev.filter((r) => r.id !== oldId));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [org_id, protocol_id]);

  const chipsByMessageId = useMemo(
    () => groupReactionsByMessage(reactions, currentUserId),
    [reactions, currentUserId],
  );

  return { reactions, chipsByMessageId, refresh };
}
