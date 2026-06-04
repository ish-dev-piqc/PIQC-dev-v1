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
      if (!res.ok) {
        setError(res.error);
        return { ok: false, error: res.error };
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === res.data.id)) return prev;
        return [...prev, res.data];
      });
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
