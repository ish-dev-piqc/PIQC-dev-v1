import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { listOrgMessages, postOrgMessage } from '../lib/orgs/orgsApi';
import {
  adaptOrgMessage,
  type OrgMessageRow,
} from '../lib/orgs/orgMessagesAdapter';
import { useOrg } from './OrgContext';
import type { OrgMessage } from '../types/orgs';

// =============================================================================
// OrgChatContext — owns the realtime subscription for the active org's
// general chat channel. Per CLAUDE.md, postgres_changes lives in context,
// not in components.
//
// Lifecycle:
//   - On activeOrg change: refresh() loads the most-recent window from
//     listOrgMessages, then subscribes to INSERTs on `org_messages`
//     filtered by org_id.
//   - On unmount or activeOrg change: removeChannel tears down the
//     subscription.
//
// postMessage optimistically appends the freshly-returned row to state so
// the user sees their message immediately. The realtime echo dedups by id.
// =============================================================================

interface OrgChatContextValue {
  messages: OrgMessage[];
  loading: boolean;
  error: string | null;
  postMessage: (
    body: string,
  ) => Promise<{ ok: boolean; error?: string; data?: OrgMessage }>;
  refresh: () => Promise<void>;
}

const OrgChatContext = createContext<OrgChatContextValue>({
  messages: [],
  loading: false,
  error: null,
  postMessage: async () => ({
    ok: false,
    error: 'OrgChatProvider not mounted',
  } as { ok: boolean; error?: string; data?: OrgMessage }),
  refresh: async () => {},
});

export function OrgChatProvider({ children }: { children: React.ReactNode }) {
  const { activeOrg } = useOrg();
  const [messages, setMessages] = useState<OrgMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Hold the current orgId in a ref so the realtime callback closures always
  // see the latest value without re-subscribing on every render.
  const orgIdRef = useRef<string | null>(null);
  orgIdRef.current = activeOrg?.id ?? null;

  const refresh = useCallback(async () => {
    const orgId = orgIdRef.current;
    if (!orgId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await listOrgMessages(orgId);
    setLoading(false);
    // Stale-response guard: a multi-org user can switch active orgs (A → B)
    // while this fetch is in flight. Only the response for the still-active
    // org may touch shared messages/error state, or org A's data lands on
    // org B (cross-channel leak / stale overwrite). loading is cleared above
    // regardless so an early return can't wedge the spinner.
    if (orgIdRef.current !== orgId) return;
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessages(res.data);
  }, []);

  // Initial + reload-on-org-change.
  useEffect(() => {
    refresh();
  }, [activeOrg?.id, refresh]);

  // Realtime subscription scoped to the active org. Re-subscribes whenever
  // the org changes; tears down on unmount.
  useEffect(() => {
    const orgId = activeOrg?.id ?? null;
    if (!orgId) return;
    const channel = supabase
      .channel(`org_messages:${orgId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'org_messages',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const raw = payload.new as OrgMessageRow;
          const msg = adaptOrgMessage(raw);
          setMessages((prev) => {
            // Dedup by id — postMessage already appended this row
            // optimistically, so we'd double-render without this guard.
            if (prev.some((m) => m.id === msg.id)) return prev;
            return [...prev, msg];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'org_messages',
          // DELETE events on filtered channels can be lossy depending on
          // replica identity; we still subscribe optimistically so admin
          // moderation deletes propagate to other clients when REPLICA
          // IDENTITY is set up. Falls back gracefully if no events arrive.
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const oldId = (payload.old as { id?: string }).id;
          if (!oldId) return;
          setMessages((prev) => prev.filter((m) => m.id !== oldId));
        },
      )
      .on(
        'postgres_changes',
        {
          // UPDATE — picks up edits (body / edited_at) and soft-deletes
          // (deleted_at). Replaces the cached row in-place so the UI
          // reflects the new state without a full refetch.
          event: 'UPDATE',
          schema: 'public',
          table: 'org_messages',
          filter: `org_id=eq.${orgId}`,
        },
        (payload) => {
          const raw = payload.new as OrgMessageRow;
          const next = adaptOrgMessage(raw);
          setMessages((prev) =>
            prev.map((m) => (m.id === next.id ? next : m)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeOrg?.id]);

  const postMessage = useCallback(
    async (
      body: string,
    ): Promise<{ ok: boolean; error?: string; data?: OrgMessage }> => {
      const orgId = orgIdRef.current;
      if (!orgId) return { ok: false, error: 'No active organization.' };
      const res = await postOrgMessage(orgId, body);
      // Stale-response guard: if the user switched active orgs while this send
      // was in flight, orgId is no longer active. Skip the SHARED-state
      // mutation (setError / optimistic setMessages append) so org A's message
      // never lands on org B — the realtime INSERT will still add it to org A
      // when that channel is next active. We STILL return the true result so
      // ChatTab's own local UI feedback (its toast) works.
      const stillActive = orgIdRef.current === orgId;
      if (!res.ok) {
        if (stillActive) setError(res.error);
        return { ok: false, error: res.error };
      }
      if (stillActive) {
        setMessages((prev) => {
          if (prev.some((m) => m.id === res.data.id)) return prev;
          return [...prev, res.data];
        });
      }
      return { ok: true, data: res.data };
    },
    [],
  );

  return (
    <OrgChatContext.Provider
      value={{ messages, loading, error, postMessage, refresh }}
    >
      {children}
    </OrgChatContext.Provider>
  );
}

export function useOrgChat() {
  return useContext(OrgChatContext);
}
