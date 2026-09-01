import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from '../../supabase';
import {
  CANDIDATE_STASH_PREFIX,
  DRAFTING_ENGINE_NOT_DEPLOYED,
  DRAFTING_ENGINE_UNREACHABLE,
  readCandidateStash,
  requestObservationCandidates,
  writeCandidateStash,
  type CandidateStash,
} from '../observationDraftApi';

const getSessionMock = vi.mocked(supabase.auth.getSession);

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';

function candidate() {
  return {
    vendor_domain: 'Data integrity',
    observation_text: 'Excursions were not documented within the required window.',
    checkpoint_ref: null,
    evidence: [{ text: 'Two excursions logged late.', source_note_ids: [NOTE_A], source_passages: [] }],
    protocol_ref: null,
  };
}

function fetchResponding(init: { ok: boolean; status?: number; json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status ?? (init.ok ? 200 : 500),
    json: init.json ?? (() => Promise.reject(new Error('no body'))),
  });
  globalThis.fetch = fetchMock as never;
  return fetchMock;
}

describe('requestObservationCandidates', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'jwt-token' } } } as never);
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('POSTs the audit id under the session JWT and maps the payload with count defaults', async () => {
    const fetchMock = fetchResponding({
      ok: true,
      json: () => Promise.resolve({ candidates: [candidate()], withheld_count: 2, protocol_source: 'ready' }),
    });

    const res = await requestObservationCandidates('audit-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/audit-observation-draft');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body as string)).toEqual({ audit_id: 'audit-1' });
    expect(res).toEqual({
      ok: true,
      data: {
        candidates: [candidate()],
        withheld_count: 2,
        stripped_protocol_ref_count: 0,
        protocol_source: 'ready',
        note_count: 0,
        evidence_doc_count: 0,
      },
    });
  });

  it("passes the function's own error message through (409 nothing-to-draft, 404 access denied)", async () => {
    fetchResponding({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ error: 'Nothing to draft from — add fieldwork notes or file evidence documents first' }),
    });
    expect(await requestObservationCandidates('audit-1')).toEqual({
      ok: false,
      error: 'Nothing to draft from — add fieldwork notes or file evidence documents first',
    });

    fetchResponding({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: 'Audit not found or access denied' }),
    });
    expect(await requestObservationCandidates('audit-1')).toEqual({
      ok: false,
      error: 'Audit not found or access denied',
    });
  });

  it('a 404 WITHOUT the function error shape is the platform saying "not deployed"', async () => {
    fetchResponding({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ code: 'NOT_FOUND', message: 'Requested function was not found' }),
    });
    expect(await requestObservationCandidates('audit-1')).toEqual({
      ok: false,
      error: DRAFTING_ENGINE_NOT_DEPLOYED,
    });
  });

  it('other statuses without a message report the status; a network failure reports unreachable', async () => {
    fetchResponding({ ok: false, status: 502 });
    expect(await requestObservationCandidates('audit-1')).toEqual({
      ok: false,
      error: 'Drafting failed (HTTP 502).',
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as never;
    expect(await requestObservationCandidates('audit-1')).toEqual({
      ok: false,
      error: DRAFTING_ENGINE_UNREACHABLE,
    });
  });

  it('an OK response without a candidates array is unreadable, never an empty success', async () => {
    fetchResponding({ ok: true, json: () => Promise.resolve({ drafts: [] }) });
    const res = await requestObservationCandidates('audit-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unreadable');

    fetchResponding({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) });
    expect((await requestObservationCandidates('audit-1')).ok).toBe(false);
  });
});

describe('candidate stash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const stash = (): CandidateStash => ({
    candidates: [{ ...candidate(), key: 'k1', dirty: false }],
    withheld_count: 1,
    stripped_protocol_ref_count: 2,
  });

  it('round-trips under the audit-scoped key', () => {
    writeCandidateStash('audit-1', stash());
    expect(localStorage.getItem(`${CANDIDATE_STASH_PREFIX}audit-1`)).not.toBeNull();
    expect(readCandidateStash('audit-1')).toEqual(stash());
    expect(readCandidateStash('audit-2')).toBeNull();
  });

  it('an empty or null stash removes the key', () => {
    writeCandidateStash('audit-1', stash());
    writeCandidateStash('audit-1', { ...stash(), candidates: [] });
    expect(readCandidateStash('audit-1')).toBeNull();
    writeCandidateStash('audit-1', stash());
    writeCandidateStash('audit-1', null);
    expect(readCandidateStash('audit-1')).toBeNull();
  });

  it('corrupt or mis-shaped storage reads as null; missing counts default to 0', () => {
    localStorage.setItem(`${CANDIDATE_STASH_PREFIX}audit-1`, '{not json');
    expect(readCandidateStash('audit-1')).toBeNull();
    localStorage.setItem(`${CANDIDATE_STASH_PREFIX}audit-1`, JSON.stringify({ candidates: 'x' }));
    expect(readCandidateStash('audit-1')).toBeNull();
    localStorage.setItem(`${CANDIDATE_STASH_PREFIX}audit-1`, JSON.stringify({ candidates: [] }));
    expect(readCandidateStash('audit-1')).toEqual({
      candidates: [],
      withheld_count: 0,
      stripped_protocol_ref_count: 0,
    });
  });
});
