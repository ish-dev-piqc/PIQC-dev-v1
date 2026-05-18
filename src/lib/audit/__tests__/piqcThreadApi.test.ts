// Unit tests for the PIQC thread persistence API.
//
// Three contracts to lock:
//
//   1. Result<T> contract — both helpers return { ok: true, data } |
//      { ok: false, error } per CLAUDE.md §"Result<T> in API layers"
//      (canonical: src/lib/site/siteApi.ts). Neither throws.
//   2. Round-trip fidelity — fetchPiqcThread returns ordered messages
//      with only the fields the panel needs (role + content; ordinal
//      is server-internal).
//   3. Defensive row-filtering on fetch — a row with an invalid role
//      or empty content from a future migration should be dropped,
//      not crash the panel.
//
// Empty-array clear path is also tested — savePiqcThread([]) is the
// canonical delete; the RPC handles whole-replace-as-empty.

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
// fetchPiqcThread — Result<T> + round-trip
// ============================================================================

describe('fetchPiqcThread — round-trip', () => {
  it('returns { ok: true, data } with role/content pairs in row order', async () => {
    setPending({
      data: [
        { role: 'user',      content: 'Hi PIQC.',         ordinal: 0 },
        { role: 'assistant', content: 'Hi — reading along.', ordinal: 1 },
        { role: 'user',      content: 'Anything missing?',   ordinal: 2 },
      ],
      error: null,
    });
    const res = await fetchPiqcThread('audit-1');
    expect(res).toEqual({
      ok:   true,
      data: [
        { role: 'user',      content: 'Hi PIQC.' },
        { role: 'assistant', content: 'Hi — reading along.' },
        { role: 'user',      content: 'Anything missing?' },
      ],
    });
  });

  it('strips the ordinal field (server-internal, panel doesn\'t want it)', async () => {
    setPending({
      data: [{ role: 'user', content: 'q', ordinal: 0 }],
      error: null,
    });
    const res = await fetchPiqcThread('audit-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data[0]).not.toHaveProperty('ordinal');
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
    const res = await fetchPiqcThread('audit-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.map((m) => m.content)).toEqual(['ok', 'fine']);
  });

  it('drops rows with empty content (CHECK should prevent, but belt+suspenders)', async () => {
    setPending({
      data: [
        { role: 'user',      content: 'ok', ordinal: 0 },
        { role: 'assistant', content: '',   ordinal: 1 },
      ],
      error: null,
    });
    const res = await fetchPiqcThread('audit-1');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toEqual([{ role: 'user', content: 'ok' }]);
  });
});

describe('fetchPiqcThread — Result<T> error variant (never throws)', () => {
  it('returns { ok: false, error } on PostgREST error', async () => {
    setPending({ data: null, error: { message: 'permission denied' } });
    const res = await fetchPiqcThread('audit-1');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('permission denied');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns { ok: true, data: [] } when data is null (no rows yet)', async () => {
    setPending({ data: null, error: null });
    const res = await fetchPiqcThread('audit-1');
    expect(res).toEqual({ ok: true, data: [] });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns { ok: true, data: [] } when data is [] (RLS scope, no thread)', async () => {
    setPending({ data: [], error: null });
    const res = await fetchPiqcThread('audit-1');
    expect(res).toEqual({ ok: true, data: [] });
  });
});

// ============================================================================
// savePiqcThread — Result<T> + RPC invocation
// ============================================================================

describe('savePiqcThread — RPC invocation', () => {
  it('forwards audit_id + messages to save_piqc_thread RPC and returns ok', async () => {
    setPending({ data: null, error: null });
    const res = await savePiqcThread('audit-1', [
      { role: 'user',      content: 'q1' },
      { role: 'assistant', content: 'a1' },
    ]);
    expect(res).toEqual({ ok: true, data: undefined });
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
    const res = await savePiqcThread('audit-1', []);
    expect(res.ok).toBe(true);
    expect(lastRpcCall()).toEqual({
      name: 'save_piqc_thread',
      args: { p_audit_id: 'audit-1', p_messages: [] },
    });
  });
});

describe('savePiqcThread — Result<T> error variant (never throws)', () => {
  it('returns { ok: false, error } on RPC error and logs', async () => {
    setPending({ data: null, error: { message: 'rls denial' } });
    // Should not throw — if it did, vitest would catch as a rejected promise.
    const res = await savePiqcThread('audit-1', [
      { role: 'user', content: 'q' },
    ]);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toBe('rls denial');
    expect(errorSpy).toHaveBeenCalled();
  });
});
