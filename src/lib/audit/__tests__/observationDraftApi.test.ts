import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../supabase', () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));

import { supabase } from '../../supabase';
import {
  CANDIDATE_STASH_PREFIX,
  DRAFTING_ENGINE_NOT_DEPLOYED,
  DRAFTING_ENGINE_UNREACHABLE,
  candidateStashKey,
  isCandidateEdited,
  readCandidateStash,
  requestObservationCandidates,
  stashCandidate,
  writeCandidateStash,
  type CandidateStash,
  type ObservationCandidate,
} from '../observationDraftApi';

const getSessionMock = vi.mocked(supabase.auth.getSession);

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ENGINE = { function: 'audit-observation-draft', model: 'gpt-4o-mini' };
const DRAFTED_AT = '2026-09-08T10:00:00Z';

function candidate(): ObservationCandidate {
  return {
    vendor_domain: 'Data integrity',
    observation_text: 'Excursions were not documented within the required window.',
    checkpoint_ref: null,
    evidence: [
      {
        text: 'Two excursions logged late.',
        source_note_ids: [NOTE_A],
        source_passages: [
          {
            chunk_id: 'chunk-e1',
            document_id: 'doc-e',
            content_hash: 'sha-e',
            section_heading: '4.2 Excursions',
            page_start: 3,
            page_end: 3,
          },
        ],
      },
    ],
    protocol_ref: null,
  };
}

function okPayload(extra: Record<string, unknown> = {}) {
  return {
    candidates: [candidate()],
    withheld_count: 2,
    stripped_protocol_ref_count: 0,
    engine: ENGINE,
    drafted_at: DRAFTED_AT,
    // Log-only fields the client does not consume.
    protocol_source: 'ready',
    note_count: 4,
    evidence_doc_count: 1,
    ...extra,
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

  it('POSTs the audit id under the session JWT and maps exactly what the panel consumes', async () => {
    const fetchMock = fetchResponding({ ok: true, json: () => Promise.resolve(okPayload()) });

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
        engine: ENGINE,
        drafted_at: DRAFTED_AT,
      },
    });
  });

  it('drops a malformed candidate element instead of handing it to the panel', async () => {
    fetchResponding({
      ok: true,
      json: () =>
        Promise.resolve(okPayload({ candidates: [candidate(), { vendor_domain: 'no text' }, null] })),
    });
    const res = await requestObservationCandidates('audit-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.candidates).toEqual([candidate()]);
  });

  it('a response without the engine provenance is unreadable — never an untraceable success', async () => {
    fetchResponding({ ok: true, json: () => Promise.resolve(okPayload({ engine: undefined })) });
    const res = await requestObservationCandidates('audit-1');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('unreadable');
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

  it('an OK response without a candidates array or with a non-JSON body is unreadable', async () => {
    fetchResponding({ ok: true, json: () => Promise.resolve({ drafts: [] }) });
    expect((await requestObservationCandidates('audit-1')).ok).toBe(false);

    fetchResponding({ ok: true, json: () => Promise.reject(new SyntaxError('bad json')) });
    expect((await requestObservationCandidates('audit-1')).ok).toBe(false);
  });
});

describe('candidate stash', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const stash = (): CandidateStash => ({
    candidates: [stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1')],
    withheld_count: 1,
    stripped_protocol_ref_count: 2,
  });

  it('is scoped to the user AND the audit — a shared laptop never hands one auditor the next one\'s cards', () => {
    expect(candidateStashKey('user-1', 'audit-1')).toBe(`${CANDIDATE_STASH_PREFIX}user-1:audit-1`);
    writeCandidateStash('user-1', 'audit-1', stash());
    expect(readCandidateStash('user-1', 'audit-1')).toEqual(stash());
    expect(readCandidateStash('user-2', 'audit-1')).toBeNull();
    expect(readCandidateStash('user-1', 'audit-2')).toBeNull();
  });

  it('an empty or null stash removes the key', () => {
    writeCandidateStash('user-1', 'audit-1', stash());
    writeCandidateStash('user-1', 'audit-1', { ...stash(), candidates: [] });
    expect(readCandidateStash('user-1', 'audit-1')).toBeNull();
    writeCandidateStash('user-1', 'audit-1', stash());
    writeCandidateStash('user-1', 'audit-1', null);
    expect(readCandidateStash('user-1', 'audit-1')).toBeNull();
  });

  it('corrupt storage reads as null; a malformed element is dropped; missing counts default to 0', () => {
    const key = candidateStashKey('user-1', 'audit-1');
    localStorage.setItem(key, '{not json');
    expect(readCandidateStash('user-1', 'audit-1')).toBeNull();
    localStorage.setItem(key, JSON.stringify({ candidates: 'x' }));
    expect(readCandidateStash('user-1', 'audit-1')).toBeNull();
    // One good card, one written by a shape that never carried provenance.
    const good = stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1');
    localStorage.setItem(key, JSON.stringify({ candidates: [good, { ...good, engine: undefined }, {}] }));
    expect(readCandidateStash('user-1', 'audit-1')).toEqual({
      candidates: [good],
      withheld_count: 0,
      stripped_protocol_ref_count: 0,
    });
  });

  it('stashCandidate snapshots the proposal and starts unclassified', () => {
    const s = stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1');
    expect(s.key).toBe('k1');
    expect(s.drafted).toEqual({
      vendor_domain: 'Data integrity',
      observation_text: 'Excursions were not documented within the required window.',
      checkpoint_ref: null,
    });
    expect(s.classification).toBe('NOT_YET_CLASSIFIED');
    expect(s.engine).toEqual(ENGINE);
    expect(s.drafted_at).toBe(DRAFTED_AT);
  });

  it('isCandidateEdited is the same comparison the promote RPC makes: trim-insensitive, blank checkpoint = none, reversible', () => {
    const s = stashCandidate(candidate(), ENGINE, DRAFTED_AT, 'k1');
    expect(isCandidateEdited(s)).toBe(false);
    expect(isCandidateEdited({ ...s, observation_text: `  ${s.observation_text}  ` })).toBe(false);
    expect(isCandidateEdited({ ...s, checkpoint_ref: '   ' })).toBe(false);
    expect(isCandidateEdited({ ...s, observation_text: 'Rewritten.' })).toBe(true);
    expect(isCandidateEdited({ ...s, vendor_domain: 'Training' })).toBe(true);
    expect(isCandidateEdited({ ...s, checkpoint_ref: 'SOP-1 §2' })).toBe(true);
    // Typing then deleting a character is not an edit.
    expect(isCandidateEdited({ ...s, observation_text: s.drafted.observation_text })).toBe(false);
  });
});
