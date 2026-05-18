// Unit tests for the PIQC thread persistence API.
//
// Three contracts to lock:
//
//   1. Round-trip fidelity — fetchPiqcThread returns ordered messages
//      with only the fields the panel needs (role + content; ordinal
//      is server-internal).
//   2. Silent-degrade — neither helper throws. The shell wires these
//      into useEffect side effects; a thrown rejection from a
//      permission-denied response would surface as an unhandled
//      rejection or a crashed effect. Quiet failure on the persistence
//      surface is doctrine (matches signalsApi.ts).
//   3. Empty-array clear path — savePiqcThread([]) is the canonical
//      delete; the RPC handles whole-replace-as-empty.
//
// Defensive row-filtering on fetch is also tested — a row with an
// invalid role or empty content from a future migration should be
// dropped, not crash the panel.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchPiqcThread, savePiqcThread } from '../piqcThreadApi';

// PostgREST query-builder mock. fetch chain: from().select().eq().order().
// rpc mock: rpc(name, args). Both share a single `pending` state setter so
// each test can configure the next response.
vi.mock('../../supabase', () => {
  type Resp = { data?: unknown; error: { message: string } | null };
  let pending: Resp = { data: [], error: null };
  let lastRpcCall: { name: string; args: unknown } | null = null;

  const chain = {
    select: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    order:  vi.fn(() => chain),
    then:   (resolve: (v: Resp) => unknown) => resolve(pending),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
      rpc:  vi.fn((name: string, args: unknown) => {
        lastRpcCall = { name, args };
        return Promise.resolve(pending);
      }),
    },
    __setPending:    (next: Resp) => { pending = next; },
    __lastRpcCall:   () => lastRpcCall,
    __resetRpcCall:  () => { lastRpcCall = null; },
  };
});

import * as supabaseModule from '../../supabase';
const setPending = (supabaseModule as unknown as {
  __setPending: (next: { data?: unknown; error: { message: string } | null }) => void;
}).__setPending;
const lastRpcCall = (supabaseModule as unknown as {
  __lastRpcCall: () => { name: string; args: unknown } | null;
}).__lastRpcCall;
const resetRpcCall = (supabaseModule as unknown as {
  __resetRpcCall: () => void;
}).__resetRpcCall;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  resetRpcCall();
});

// ============================================================================
// fetchPiqcThread
// ============================================================================

describe('fetchPiqcThread — round-trip', () => {
  it('returns role/content pairs in row order (RPC orders by ordinal asc)', async () => {
    setPending({
      data: [
        { role: 'user',      content: 'Hi PIQC.',         ordinal: 0 },
        { role: 'assistant', content: 'Hi — reading along.', ordinal: 1 },
        { role: 'user',      content: 'Anything missing?',   ordinal: 2 },
      ],
      error: null,
    });
    const result = await fetchPiqcThread('audit-1');
    expect(result).toEqual([
      { role: 'user',      content: 'Hi PIQC.' },
      { role: 'assistant', content: 'Hi — reading along.' },
      { role: 'user',      content: 'Anything missing?' },
    ]);
  });

  it('strips the ordinal field (server-internal, panel doesn\'t want it)', async () => {
    setPending({
      data: [{ role: 'user', content: 'q', ordinal: 0 }],
      error: null,
    });
    const result = await fetchPiqcThread('audit-1');
    expect(result[0]).not.toHaveProperty('ordinal');
  });
});

describe('fetchPiqcThread — defensive filtering', () => {
  it('drops rows with an invalid role (defense against future schema drift)', async () => {
    setPending({
      data: [
        { role: 'user',      content: 'ok',      ordinal: 0 },
        { role: 'system',    content: 'oops',    ordinal: 1 }, // not allowed by CHECK, but defensive
        { role: 'assistant', content: 'fine',    ordinal: 2 },
      ],
      error: null,
    });
    const result = await fetchPiqcThread('audit-1');
    expect(result.map((m) => m.content)).toEqual(['ok', 'fine']);
  });

  it('drops rows with empty content (CHECK constraint should prevent, but belt+suspenders)', async () => {
    setPending({
      data: [
        { role: 'user',      content: 'ok', ordinal: 0 },
        { role: 'assistant', content: '',   ordinal: 1 },
      ],
      error: null,
    });
    const result = await fetchPiqcThread('audit-1');
    expect(result).toEqual([{ role: 'user', content: 'ok' }]);
  });
});

describe('fetchPiqcThread — silent-degrade contract', () => {
  it('returns [] on PostgREST error (never throws — shell-effect-safe)', async () => {
    setPending({ data: null, error: { message: 'permission denied' } });
    const result = await fetchPiqcThread('audit-1');
    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns [] when data is null (no rows yet for this audit)', async () => {
    setPending({ data: null, error: null });
    const result = await fetchPiqcThread('audit-1');
    expect(result).toEqual([]);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns [] when data is [] (RLS scope but no thread persisted)', async () => {
    setPending({ data: [], error: null });
    const result = await fetchPiqcThread('audit-1');
    expect(result).toEqual([]);
  });
});

// ============================================================================
// savePiqcThread
// ============================================================================

describe('savePiqcThread — RPC invocation', () => {
  it('forwards audit_id + messages to save_piqc_thread RPC', async () => {
    setPending({ data: null, error: null });
    await savePiqcThread('audit-1', [
      { role: 'user',      content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    expect(lastRpcCall()).toEqual({
      name: 'save_piqc_thread',
      args: {
        p_audit_id: 'audit-1',
        p_messages: [
          { role: 'user',      content: 'q1' },
          { role: 'assistant', content: 'a1' },
        ],
      },
    });
  });

  it('whole-replace-with-empty is the canonical clear path', async () => {
    setPending({ data: null, error: null });
    await savePiqcThread('audit-1', []);
    expect(lastRpcCall()).toEqual({
      name: 'save_piqc_thread',
      args: { p_audit_id: 'audit-1', p_messages: [] },
    });
  });
});

describe('savePiqcThread — silent-degrade contract', () => {
  it('swallows RPC errors and logs (the shell debounce-effect must never throw)', async () => {
    setPending({ data: null, error: { message: 'rls denial' } });
    // Should not throw — if it did, vitest would catch as a rejected promise.
    await expect(savePiqcThread('audit-1', [
      { role: 'user', content: 'q' },
    ])).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});
