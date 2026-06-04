import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { listChannelDecisions } from '../lib/orgs/orgsApi';
import {
  adaptChatDecision,
  type ChatDecisionRow,
} from '../lib/orgs/chatDecisionsAdapter';
import type { ChatDecision } from '../types/orgs';

// =============================================================================
// useChatDecisions — per-channel decisions list + realtime subscription.
//
// Lives here (src/hooks) rather than in ChatTab so the realtime sub respects
// the "realtime in context/hook layer, not in src/components" architecture
// rule + the "no supabase import in components" rule.
//
// Signature:
//   useChatDecisions({ kind, channelId })
//
// Returns:
//   { decisions, loading, add(d), remove(id) }
//
//   `add` and `remove` are optimistic helpers ChatTab calls right after a
//   successful create/delete mutation. The realtime sub dedups on id so
//   the local mutation isn't double-applied when the echo comes back.
// =============================================================================

interface UseChatDecisionsParams {
  kind: 'org' | 'protocol';
  channelId: string | null;
}

export interface UseChatDecisionsResult {
  decisions: ChatDecision[];
  loading: boolean;
  add: (decision: ChatDecision) => void;
  remove: (id: string) => void;
}

export function useChatDecisions({
  kind,
  channelId,
}: UseChatDecisionsParams): UseChatDecisionsResult {
  const [decisions, setDecisions] = useState<ChatDecision[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId) {
      setDecisions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listChannelDecisions(kind, channelId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setDecisions(res.data);
    });

    const filterField = kind === 'org' ? 'org_id' : 'protocol_id';
    const ch = supabase
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
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [kind, channelId]);

  return {
    decisions,
    loading,
    add: (d) =>
      setDecisions((prev) => (prev.some((x) => x.id === d.id) ? prev : [d, ...prev])),
    remove: (id) => setDecisions((prev) => prev.filter((x) => x.id !== id)),
  };
}
