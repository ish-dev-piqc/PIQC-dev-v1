// Unit tests for the F-3 audit-mode chat client wrapper.
//
// The wrapper is intentionally thin (one POST → one assistant string), but
// the contract it enforces matters for the UI:
//   1. Auth headers attached from the user's session, falling back to anon
//   2. Body shape exactly { audit_id, messages } (no leaked client fields)
//   3. Non-2xx → AuditChatError with the server's `error` string + status
//   4. 2xx with empty/missing reply → AuditChatError(502)
//   5. Successful 2xx returns the trimmed reply
//
// Mocks: vi.stubGlobal('fetch') + vi.mock('../../supabase') so auth.getSession
// resolves predictably. Mirrors the pattern in reportApi.test.ts and the
// audit-summary tests already in tree.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { requestAuditChat, AuditChatError } from '../chatApi';

vi.mock('../../supabase', () => {
  const getSession = vi.fn();
  return { supabase: { auth: { getSession } } };
});

import { supabase } from '../../supabase';
const mockGetSession = supabase.auth.getSession as unknown as ReturnType<typeof vi.fn>;

const ORIGINAL_FETCH = global.fetch;

// Stub import.meta.env values used by the wrapper. Vitest's importMeta config
// keeps these per-test, so set on the actual import.meta where possible; we
// use a process-side fallback for environments that don't expose it.
beforeEach(() => {
  mockGetSession.mockReset();
  (import.meta.env as Record<string, string>).VITE_SUPABASE_URL = 'https://example.supabase.co';
  (import.meta.env as Record<string, string>).VITE_SUPABASE_ANON_KEY = 'anon-key';
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

function stubFetch(impl: (req: { url: string; init: RequestInit }) => Response | Promise<Response>) {
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    return impl({ url, init: init ?? {} });
  }) as unknown as typeof fetch;
}

describe('requestAuditChat — happy path', () => {
  it('POSTs to /functions/v1/audit-mode-chat with audit_id + messages, returns trimmed reply', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 'user-jwt' } } });
    const captured: { url: string; init: RequestInit } = { url: '', init: {} };
    stubFetch(({ url, init }) => {
      captured.url = url;
      captured.init = init;
      return new Response(JSON.stringify({ reply: '  Here is the answer.  ' }), { status: 200 });
    });

    const reply = await requestAuditChat('audit-1', [
      { role: 'user', content: 'Did I miss anything in Stage 6?' },
    ]);

    expect(reply).toBe('Here is the answer.');
    expect(captured.url).toBe('https://example.supabase.co/functions/v1/audit-mode-chat');
    expect(captured.init.method).toBe('POST');
    const headers = captured.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer user-jwt');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((captured.init.body as string) ?? '{}');
    expect(body).toEqual({
      audit_id: 'audit-1',
      messages: [{ role: 'user', content: 'Did I miss anything in Stage 6?' }],
    });
  });

  it('falls back to anon key when no session is present', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const captured: { init: RequestInit } = { init: {} };
    stubFetch(({ init }) => {
      captured.init = init;
      return new Response(JSON.stringify({ reply: 'ok' }), { status: 200 });
    });

    await requestAuditChat('audit-1', [{ role: 'user', content: 'hi' }]);

    const headers = captured.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer anon-key');
  });
});

describe('requestAuditChat — error paths', () => {
  it('throws AuditChatError with server error message + status on non-2xx', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } });
    stubFetch(() =>
      new Response(JSON.stringify({ error: 'Rate limit exceeded' }), { status: 429 }),
    );

    await expect(
      requestAuditChat('audit-1', [{ role: 'user', content: 'q' }]),
    ).rejects.toMatchObject({
      name: 'AuditChatError',
      message: 'Rate limit exceeded',
      status: 429,
    });
  });

  it('throws AuditChatError(502) when 2xx body lacks a reply', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } });
    stubFetch(() => new Response(JSON.stringify({}), { status: 200 }));

    await expect(
      requestAuditChat('audit-1', [{ role: 'user', content: 'q' }]),
    ).rejects.toMatchObject({
      name: 'AuditChatError',
      status: 502,
    });
  });

  it('throws a generic AuditChatError when the response body is not JSON', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: { access_token: 't' } } });
    stubFetch(() => new Response('not json', { status: 500 }));

    const err = await requestAuditChat('audit-1', [{ role: 'user', content: 'q' }])
      .catch((e) => e);

    expect(err).toBeInstanceOf(AuditChatError);
    expect((err as AuditChatError).status).toBe(500);
  });
});
