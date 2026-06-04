import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  listChannelDecisions,
  listDecisionAcks,
} from '../lib/orgs/orgsApi';
import {
  adaptChatDecision,
  type ChatDecisionRow,
} from '../lib/orgs/chatDecisionsAdapter';
import {
  adaptChatDecisionAck,
  type ChatDecisionAckRow,
} from '../lib/orgs/chatDecisionAcksAdapter';
import type { ChatDecision, ChatDecisionAck } from '../types/orgs';

// =============================================================================
// useChatDecisions — per-channel decisions list + ack rows + realtime
// subscriptions for both.
//
// Lives here (src/hooks) rather than in ChatTab so the realtime sub respects
// the "realtime in context/hook layer" rule.
//
// Returns:
//   { decisions, acksByDecisionId, loading, add(d), remove(id), upsertAck(ack), removeAck(id) }
//
// `add` and `remove` are optimistic helpers ChatTab calls after a
// successful create/delete mutation. The realtime sub dedups by id.
// =============================================================================

interface UseChatDecisionsParams {
  kind: 'org' | 'protocol';
  channelId: string | null;
}

export interface UseChatDecisionsResult {
  decisions: ChatDecision[];
  /** Decision id → its ack rows. Empty array if the decision has no
   *  required acks (informational decision). */
  acksByDecisionId: Map<string, ChatDecisionAck[]>;
  loading: boolean;
  add: (decision: ChatDecision) => void;
  remove: (id: string) => void;
  upsertAck: (ack: ChatDecisionAck) => void;
  removeAck: (id: string) => void;
}

export function useChatDecisions({
  kind,
  channelId,
}: UseChatDecisionsParams): UseChatDecisionsResult {
  const [decisions, setDecisions] = useState<ChatDecision[]>([]);
  const [acks, setAcks] = useState<ChatDecisionAck[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId) {
      setDecisions([]);
      setAcks([]);
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const decisionsRes = await listChannelDecisions(kind, channelId);
      if (cancelled) return;
      if (!decisionsRes.ok) {
        setLoading(false);
        return;
      }
      setDecisions(decisionsRes.data);

      // Fetch acks for these decisions.
      const ids = decisionsRes.data.map((d) => d.id);
      const acksRes = await listDecisionAcks(ids);
      if (cancelled) return;
      setLoading(false);
      if (acksRes.ok) setAcks(acksRes.data);
    })();

    const filterField = kind === 'org' ? 'org_id' : 'protocol_id';
    const decisionsChannel = supabase
      .channel(`chat_decisions:${kind}:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_decisions',
          filter: `${filterField}=eq.${channelId}`,
        },
        (payload) => {
          const d = adaptChatDecision(payload.new as ChatDecisionRow);
          setDecisions((prev) => {
            if (prev.some((x) => x.id === d.id)) return prev;
            return [d, ...prev];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'chat_decisions',
          filter: `${filterField}=eq.${channelId}`,
        },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (!id) return;
          setDecisions((prev) => prev.filter((x) => x.id !== id));
          setAcks((prev) => prev.filter((a) => a.decision_id !== id));
        },
      )
      .subscribe();

    // Ack subscription — unfiltered (Supabase realtime can't filter on
    // `decision_id IN (...)`); client-side filter against current
    // decision ids inside the handler.
    const acksChannel = supabase
      .channel(`chat_decision_acks:${kind}:${channelId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'chat_decision_acks',
        },
        (payload) => {
          if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id?: string }).id;
            if (id) setAcks((prev) => prev.filter((a) => a.id !== id));
            return;
          }
          const row = (payload.new as ChatDecisionAckRow) ?? null;
          if (!row) return;
          // Only keep acks tied to decisions we know about in this channel.
          // Cleared on re-mount / channel switch anyway.
          setDecisions((d) => d); // dependency anchor — see comment below
          setAcks((prev) => {
            const adapted = adaptChatDecisionAck(row);
            const existing = prev.find((a) => a.id === adapted.id);
            if (!existing) return [...prev, adapted];
            return prev.map((a) => (a.id === adapted.id ? adapted : a));
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(decisionsChannel);
      supabase.removeChannel(acksChannel);
    };
  }, [kind, channelId]);

  const acksByDecisionId = useMemo(() => {
    const m = new Map<string, ChatDecisionAck[]>();
    const knownIds = new Set(decisions.map((d) => d.id));
    for (const a of acks) {
      if (!knownIds.has(a.decision_id)) continue;
      const arr = m.get(a.decision_id);
      if (arr) arr.push(a);
      else m.set(a.decision_id, [a]);
    }
    return m;
  }, [acks, decisions]);

  return {
    decisions,
    acksByDecisionId,
    loading,
    add: (d) =>
      setDecisions((prev) => (prev.some((x) => x.id === d.id) ? prev : [d, ...prev])),
    remove: (id) => {
      setDecisions((prev) => prev.filter((x) => x.id !== id));
      setAcks((prev) => prev.filter((a) => a.decision_id !== id));
    },
    upsertAck: (ack) =>
      setAcks((prev) => {
        const existing = prev.find((a) => a.id === ack.id);
        if (!existing) return [...prev, ack];
        return prev.map((a) => (a.id === ack.id ? ack : a));
      }),
    removeAck: (id) => setAcks((prev) => prev.filter((a) => a.id !== id)),
  };
}
