import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import {
  listProtocolMessages,
  postProtocolMessage,
} from '../lib/orgs/orgsApi';
import {
  adaptProtocolMessage,
  type ProtocolMessageRow,
} from '../lib/orgs/protocolMessagesAdapter';
import type { ProtocolMessage } from '../types/orgs';

// =============================================================================
// ProtocolChatContext — single-active-channel state for per-protocol chat.
//
// One activeProtocolId at a time. Switching channels tears down the previous
// realtime subscription and sets up a new one. Idle (null) → no subscription.
//
// Mirrors OrgChatContext's shape so ChatTab can use either via a small
// adapter. Intentionally a separate context (not unified with OrgChatContext)
// to keep #general's working code unchanged.
// =============================================================================

interface ProtocolChatContextValue {
  activeProtocolId: string | null;
  setActiveProtocolId: (id: string | null) => void;
  messages: ProtocolMessage[];
  loading: boolean;
  error: string | null;
  postMessage: (
    body: string,
  ) => Promise<{ ok: boolean; error?: string; data?: ProtocolMessage }>;
  refresh: () => Promise<void>;
}

const ProtocolChatContext = createContext<ProtocolChatContextValue>({
  activeProtocolId: null,
  setActiveProtocolId: () => {},
  messages: [],
  loading: false,
  error: null,
  postMessage: async () => ({
    ok: false,
    error: 'ProtocolChatProvider not mounted',
  } as { ok: boolean; error?: string; data?: ProtocolMessage }),
  refresh: async () => {},
});

export function ProtocolChatProvider({ children }: { children: React.ReactNode }) {
  const [activeProtocolId, setActiveProtocolId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ProtocolMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable ref for the active protocol so the postMessage callback can read
  // the current value without re-creating itself on every change.
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeProtocolId;

  const refresh = useCallback(async () => {
    const protocolId = activeIdRef.current;
    if (!protocolId) {
      setMessages([]);
      return;
    }
    setLoading(true);
    setError(null);
    const res = await listProtocolMessages(protocolId);
    setLoading(false);
    // Stale-response guard: a fast channel switch (A → B) can resolve this
    // fetch after the active channel already moved on. Only the response for
    // the still-active channel may touch shared messages/error state, or
    // channel A's data lands on channel B (cross-channel leak / stale
    // overwrite). loading is cleared above regardless so an early return can't
    // wedge the spinner.
    if (activeIdRef.current !== protocolId) return;
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMessages(res.data);
  }, []);

  // Initial fetch on channel change.
  useEffect(() => {
    refresh();
  }, [activeProtocolId, refresh]);

  // Realtime — subscribe to INSERTs + DELETEs scoped to the active protocol.
  useEffect(() => {
    if (!activeProtocolId) return;
    const channel = supabase
      .channel(`protocol_messages:${activeProtocolId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'protocol_messages',
          filter: `protocol_id=eq.${activeProtocolId}`,
        },
        (payload) => {
          const raw = payload.new as ProtocolMessageRow;
          const msg = adaptProtocolMessage(raw);
          setMessages((prev) => {
            // Dedup against the optimistic append in postMessage.
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
          table: 'protocol_messages',
          filter: `protocol_id=eq.${activeProtocolId}`,
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
          // UPDATE — edits + soft-deletes flow through.
          event: 'UPDATE',
          schema: 'public',
          table: 'protocol_messages',
          filter: `protocol_id=eq.${activeProtocolId}`,
        },
        (payload) => {
          const raw = payload.new as ProtocolMessageRow;
          const next = adaptProtocolMessage(raw);
          setMessages((prev) =>
            prev.map((m) => (m.id === next.id ? next : m)),
          );
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeProtocolId]);

  const postMessage = useCallback(
    async (
      body: string,
    ): Promise<{ ok: boolean; error?: string; data?: ProtocolMessage }> => {
      const protocolId = activeIdRef.current;
      if (!protocolId) return { ok: false, error: 'No active protocol channel.' };
      const res = await postProtocolMessage(protocolId, body);
      // Stale-response guard: if the user switched channels while this send
      // was in flight, protocolId is no longer active. Skip the SHARED-state
      // mutation (setError / optimistic setMessages append) so channel A's
      // message never lands on channel B — the realtime INSERT will still add
      // it to channel A when that channel is next active. We STILL return the
      // true result so ChatTab's own local UI feedback (its toast) works.
      const stillActive = activeIdRef.current === protocolId;
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
    <ProtocolChatContext.Provider
      value={{
        activeProtocolId,
        setActiveProtocolId,
        messages,
        loading,
        error,
        postMessage,
        refresh,
      }}
    >
      {children}
    </ProtocolChatContext.Provider>
  );
}

export function useProtocolChat() {
  return useContext(ProtocolChatContext);
}
