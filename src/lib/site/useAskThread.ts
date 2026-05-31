import { useCallback, useEffect, useState } from 'react';
import type { ChatMessage, RagStatus } from '../supabase';

// =============================================================================
// useAskThread — in-session, per-protocol memory for the Site Mode Ask rail.
//
// The Ask rail is mounted once at the Site shell and stays alive across tab
// switches, so its conversation already survives navigation in-memory. This
// hook adds the two things that pure component state doesn't give us:
//   1. Persistence across page reloads (sessionStorage — cleared when the tab
//      closes, which matches "in session").
//   2. Per-protocol scoping — switching the active protocol swaps to that
//      protocol's thread instead of bleeding one conversation into another.
//
// Transient streaming fields are stripped before serializing so a reload never
// restores a half-streamed message or a stale RAG spinner.
// =============================================================================

export type ExtendedMessage = ChatMessage & {
  streaming?: boolean;
  ragStatus?: RagStatus;
  ragError?: string;
};

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

function saveThread(protocolId: string | null, messages: ExtendedMessage[]): void {
  if (!protocolId) return;
  try {
    // Drop transient fields — a reload should restore settled messages only,
    // never a mid-stream placeholder or a stale spinner/error.
    const persisted = messages
      .filter((m) => !m.streaming)
      .map(({ streaming: _s, ragStatus: _r, ragError: _e, ...rest }) => rest);
    sessionStorage.setItem(storageKey(protocolId), JSON.stringify(persisted));
  } catch {
    // sessionStorage unavailable (private mode / quota) — degrade to in-memory.
  }
}

/**
 * Returns a [messages, setMessages] pair bound to the active protocol's thread.
 * Loads from sessionStorage on protocol change and persists on every update.
 */
export function useAskThread(
  protocolId: string | null,
): [ExtendedMessage[], React.Dispatch<React.SetStateAction<ExtendedMessage[]>>] {
  const [messages, setMessages] = useState<ExtendedMessage[]>(() => loadThread(protocolId));

  // Swap threads when the active protocol changes.
  useEffect(() => {
    setMessages(loadThread(protocolId));
  }, [protocolId]);

  // Persist after every settled change.
  useEffect(() => {
    saveThread(protocolId, messages);
  }, [protocolId, messages]);

  const set = useCallback<React.Dispatch<React.SetStateAction<ExtendedMessage[]>>>((value) => {
    setMessages(value);
  }, []);

  return [messages, set];
}
