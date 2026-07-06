import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExtendedMessage } from '../supabase';

// =============================================================================
// useAskThread — in-session, per-protocol memory for the Site Mode Ask bubble.
//
// The Ask bubble is mounted once at the Site shell and stays alive across tab
// switches, so its conversation already survives navigation in-memory. This
// hook adds the two things that pure component state doesn't give us:
//   1. Persistence across page reloads (sessionStorage — cleared when the tab
//      closes, which matches "in session").
//   2. Per-protocol scoping — switching the active protocol swaps to that
//      protocol's thread instead of bleeding one conversation into another.
//
// Cross-thread safety: the setter is bound to the protocol it was created for.
// A stream that is still writing after the user switches protocols (its closure
// holds the previous protocol's setter) is silently dropped instead of leaking
// its tokens into the new protocol's thread.
//
// Persistence rule: settled messages persist WITH their ragStatus/ragError/
// sources (so citations and provenance survive a reload). Still-streaming and
// failed-send (error) messages are never persisted.
// =============================================================================

// Re-export so existing consumers/tests can import the type from here.
export type { ExtendedMessage } from '../supabase';

const KEY_PREFIX = 'piq-site-ask-thread-v1:';

function storageKey(protocolId: string): string {
  return `${KEY_PREFIX}${protocolId}`;
}

function loadThread(protocolId: string | null): ExtendedMessage[] {
  if (!protocolId) return [];
  try {
    const raw = sessionStorage.getItem(storageKey(protocolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ExtendedMessage[]) : [];
  } catch {
    return [];
  }
}

// The settled thread, minus transient fields. Streaming placeholders and failed
// sends are dropped entirely; `streaming`/`error` flags are stripped from the rest.
function persistable(messages: ExtendedMessage[]): ExtendedMessage[] {
  return messages
    .filter((m) => !m.streaming && !m.error)
    .map(({ streaming: _s, error: _e, ...rest }) => rest);
}

type ThreadState = { pid: string | null; messages: ExtendedMessage[] };

/**
 * Returns [messages, setMessages, clear] bound to the active protocol's thread.
 * Loads from sessionStorage on protocol change and persists settled changes.
 * `setMessages` from a previous protocol no-ops after a switch.
 */
export function useAskThread(
  protocolId: string | null,
): [ExtendedMessage[], React.Dispatch<React.SetStateAction<ExtendedMessage[]>>, () => void] {
  const [state, setState] = useState<ThreadState>(() => ({
    pid: protocolId,
    messages: loadThread(protocolId),
  }));

  // Swap threads synchronously during render when the protocol changes (React's
  // store-previous-value pattern) so state.messages always belongs to state.pid
  // and the persist effect can never write one protocol's thread under another's key.
  if (state.pid !== protocolId) {
    setState({ pid: protocolId, messages: loadThread(protocolId) });
  }

  // Always-current protocol id, read by the guarded setter from outside render.
  const pidRef = useRef(protocolId);
  useEffect(() => {
    pidRef.current = protocolId;
  }, [protocolId]);

  // Persist settled changes, deduped so streaming (which never changes the
  // persisted prefix) doesn't re-serialize the whole thread on every token.
  const lastWrittenRef = useRef<string | null>(null);
  useEffect(() => {
    if (!protocolId || state.pid !== protocolId) return;
    const persisted = persistable(state.messages);
    if (persisted.length === 0) {
      try {
        sessionStorage.removeItem(storageKey(protocolId));
      } catch {
        /* sessionStorage unavailable — degrade to in-memory */
      }
      lastWrittenRef.current = `${protocolId}::[]`;
      return;
    }
    const json = JSON.stringify(persisted);
    const sig = `${protocolId}::${json}`;
    if (lastWrittenRef.current === sig) return;
    lastWrittenRef.current = sig;
    try {
      sessionStorage.setItem(storageKey(protocolId), json);
    } catch {
      /* sessionStorage unavailable — degrade to in-memory */
    }
  }, [protocolId, state]);

  // Setter bound to the protocol active when it was created. If the protocol has
  // since changed, the write is a stale straggler from a previous thread — drop it.
  const set = useCallback<React.Dispatch<React.SetStateAction<ExtendedMessage[]>>>(
    (value) => {
      if (pidRef.current !== protocolId) return;
      setState((prev) => {
        if (prev.pid !== protocolId) return prev;
        const next =
          typeof value === 'function'
            ? (value as (m: ExtendedMessage[]) => ExtendedMessage[])(prev.messages)
            : value;
        return { pid: prev.pid, messages: next };
      });
    },
    [protocolId],
  );

  const clear = useCallback(() => {
    if (pidRef.current !== protocolId) return;
    setState({ pid: protocolId, messages: [] });
  }, [protocolId]);

  const messages = state.pid === protocolId ? state.messages : loadThread(protocolId);
  return [messages, set, clear];
}
