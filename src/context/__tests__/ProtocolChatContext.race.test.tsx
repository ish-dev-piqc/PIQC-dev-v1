import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import {
  ProtocolChatProvider,
  useProtocolChat,
} from '../ProtocolChatContext';
import type { ProtocolMessage } from '../../types/orgs';

const ok = <T,>(data: T) => ({ ok: true as const, data });

// =============================================================================
// Regression: ProtocolChatContext must not let a slow fetch/send for a
// previously-active channel land its data onto the now-active channel (the
// rapid-channel-switch race, mirror of the AUD-301-class stale-guard).
//
// refresh() and postMessage() both capture the active protocolId BEFORE an
// await. Without a post-await `activeIdRef.current === captured id` re-check,
// channel A's messages (refresh) or optimistic append (postMessage) overwrite
// or leak into channel B after a fast switch A → B.
// =============================================================================

// Realtime subscription is out of scope for this race — stub supabase so the
// context's .channel(...).subscribe() effect is a harmless no-op.
vi.mock('../../lib/supabase', () => {
  const channel = {
    on() {
      return channel;
    },
    subscribe() {
      return channel;
    },
  };
  return {
    supabase: {
      channel: () => channel,
      removeChannel: () => {},
    },
  };
});

// Manually-gated deferred so the test controls exactly when each async call
// resolves — no timers, fully deterministic.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const listCalls: Array<{ protocolId: string; d: ReturnType<typeof deferred<{ ok: true; data: ProtocolMessage[] }>> }> = [];
const postCalls: Array<{ protocolId: string; d: ReturnType<typeof deferred<{ ok: true; data: ProtocolMessage }>> }> = [];

vi.mock('../../lib/orgs/orgsApi', () => ({
  listProtocolMessages: (protocolId: string) => {
    const d = deferred<{ ok: true; data: ProtocolMessage[] }>();
    listCalls.push({ protocolId, d });
    return d.promise;
  },
  postProtocolMessage: (protocolId: string) => {
    const d = deferred<{ ok: true; data: ProtocolMessage }>();
    postCalls.push({ protocolId, d });
    return d.promise;
  },
}));

function msg(id: string, protocolId: string, body: string): ProtocolMessage {
  return {
    id,
    protocol_id: protocolId,
    author_user_id: 'author-1',
    body,
    created_at: '2026-07-06T00:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    parent_message_id: null,
  };
}

// Test harness: exposes the context and lets the test drive channel switches
// and sends imperatively via a captured handle.
let handle: ReturnType<typeof useProtocolChat> | null = null;

function Probe() {
  const chat = useProtocolChat();
  useEffect(() => {
    handle = chat;
  });
  return <div data-testid="ids">{chat.messages.map((m) => m.id).join(',')}</div>;
}

function findCall<T extends { protocolId: string }>(calls: T[], protocolId: string): T {
  const c = calls.find((x) => x.protocolId === protocolId);
  if (!c) throw new Error(`no pending call for ${protocolId}`);
  return c;
}

describe('ProtocolChatContext — rapid channel-switch stale-response race', () => {
  afterEach(() => {
    listCalls.length = 0;
    postCalls.length = 0;
    handle = null;
  });

  it('refresh: a slow fetch for channel A does NOT overwrite channel B after a fast switch', async () => {
    render(
      <ProtocolChatProvider>
        <Probe />
      </ProtocolChatProvider>,
    );

    // Activate channel A → refresh(A) starts and awaits (its deferred is unresolved).
    await act(async () => {
      handle!.setActiveProtocolId('proto-A');
    });
    await waitFor(() => expect(findCall(listCalls, 'proto-A')).toBeTruthy());

    // Switch to channel B BEFORE A's fetch resolves → refresh(B) starts.
    await act(async () => {
      handle!.setActiveProtocolId('proto-B');
    });
    await waitFor(() => expect(findCall(listCalls, 'proto-B')).toBeTruthy());

    // B resolves first with B's data — this is the current, active channel.
    await act(async () => {
      findCall(listCalls, 'proto-B').d.resolve(ok([msg('b-1', 'proto-B', 'hello B')]));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="ids"]')!.textContent).toBe('b-1'),
    );

    // A's stale fetch resolves LAST. Its data must be discarded — B is active.
    await act(async () => {
      findCall(listCalls, 'proto-A').d.resolve(ok([msg('a-1', 'proto-A', 'hello A')]));
    });

    // Channel A's message must NOT clobber channel B's messages.
    expect(document.querySelector('[data-testid="ids"]')!.textContent).toBe('b-1');
  });

  it('postMessage: a slow send for channel A does NOT append onto channel B, but still returns its true result', async () => {
    render(
      <ProtocolChatProvider>
        <Probe />
      </ProtocolChatProvider>,
    );

    // Activate + settle channel A (empty list) so messages start clean.
    await act(async () => {
      handle!.setActiveProtocolId('proto-A');
    });
    await waitFor(() => expect(findCall(listCalls, 'proto-A')).toBeTruthy());
    await act(async () => {
      findCall(listCalls, 'proto-A').d.resolve(ok([]));
    });

    // Send a message on A — postMessage(A) is now in flight.
    let sendResult: Promise<{ ok: boolean; data?: ProtocolMessage; error?: string }>;
    await act(async () => {
      sendResult = handle!.postMessage('sent from A');
    });
    await waitFor(() => expect(findCall(postCalls, 'proto-A')).toBeTruthy());

    // Switch to channel B before A's send resolves; settle B empty.
    await act(async () => {
      handle!.setActiveProtocolId('proto-B');
    });
    await waitFor(() => expect(findCall(listCalls, 'proto-B')).toBeTruthy());
    await act(async () => {
      findCall(listCalls, 'proto-B').d.resolve(ok([]));
    });
    await waitFor(() =>
      expect(document.querySelector('[data-testid="ids"]')!.textContent).toBe(''),
    );

    // A's send finally resolves — its optimistic append must be skipped on B,
    // but the caller (ChatTab) must still receive the true success result.
    const aMsg = msg('a-1', 'proto-A', 'sent from A');
    await act(async () => {
      findCall(postCalls, 'proto-A').d.resolve(ok(aMsg));
    });

    const result = await sendResult!;
    // Caller still gets the truthful result for its own local toast.
    expect(result.ok).toBe(true);
    expect(result.data?.id).toBe('a-1');
    // But channel B's shared messages must NOT have received A's message.
    expect(document.querySelector('[data-testid="ids"]')!.textContent).toBe('');
  });
});
