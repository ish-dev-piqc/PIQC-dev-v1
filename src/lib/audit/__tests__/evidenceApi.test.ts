// Unit tests for the evidenceApi Result<T> contract (PR-B evidence register).
//
// Locks four behaviors at the API boundary: (1) checkbox glyphs normalize
// BEFORE ingest so stored text / hash / embeddings agree, (2) no session is a
// hard fail — evidence must never ride the anon key, (3) a DB error is
// distinguishable from a legitimately empty register, (4) RPC failures surface
// the server's hint when present (remediation-naming) over the raw message.
//
// Mock surface mirrors auditCreationApi.test.ts (vi.hoisted chainable supabase
// mock), extended with auth.getSession and a stubbed global fetch for the
// /ingest edge-function call.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockOrder, mockRpc, mockGetSession } = vi.hoisted(() => ({
  mockOrder: vi.fn(),
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ order: mockOrder })),
      })),
    })),
    rpc: mockRpc,
    auth: { getSession: mockGetSession },
  },
}));

import {
  ingestAuditEvidence,
  listAuditEvidence,
  normalizeCheckboxes,
  removeAuditEvidence,
} from '../evidenceApi';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const JOIN_ROW = {
  audit_id: 'a1',
  document_id: 'd1',
  added_by: 'u1',
  added_at: '2026-08-30T12:00:00Z',
  source_type: 'SOP',
  source_system: null,
  source_locator: null,
  include_in_generation: true,
};

const SESSION = { data: { session: { access_token: 'jwt-token' } } };

describe('normalizeCheckboxes', () => {
  it('maps ballot glyphs to bracket form', () => {
    expect(normalizeCheckboxes('☐ SOP reviewed\n☑ CV on file\n☒ N/A item')).toBe(
      '[ ] SOP reviewed\n[x] CV on file\n[x] N/A item',
    );
  });

  it('leaves plain text untouched', () => {
    const text = 'Q1: [x] yes [ ] no — 100% complete';
    expect(normalizeCheckboxes(text)).toBe(text);
  });
});

describe('listAuditEvidence', () => {
  beforeEach(() => {
    mockOrder.mockReset();
  });

  it('flattens the joined document (object form) into list rows', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ ...JOIN_ROW, documents: { title: 'QA SOP v3', status: 'ready' } }],
      error: null,
    });
    const res = await listAuditEvidence('a1');
    expect(res).toEqual({
      ok: true,
      data: [{ ...JOIN_ROW, title: 'QA SOP v3', status: 'ready' }],
    });
  });

  it('normalizes the array form PostgREST may return for the join', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [{ ...JOIN_ROW, documents: [{ title: 'QA SOP v3', status: 'ready' }] }],
      error: null,
    });
    const res = await listAuditEvidence('a1');
    expect(res.ok && res.data[0].title).toBe('QA SOP v3');
  });

  it('returns { ok: false, error } on a query error (never a silent empty list)', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const res = await listAuditEvidence('a1');
    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('ingestAuditEvidence', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockGetSession.mockReset();
    mockFetch.mockReset();
  });

  const PARAMS = {
    auditId: 'a1',
    title: 'Completed questionnaire',
    sourceType: 'Completed questionnaire',
    content: '☑ Section A complete',
  };

  it('hard-fails without a session and never calls fetch', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await ingestAuditEvidence(PARAMS);
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('posts normalized content with kind AUDIT_EVIDENCE, then attaches via RPC', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ document_id: 'd1', status: 'ready' }),
    });
    mockRpc.mockResolvedValueOnce({ data: JOIN_ROW, error: null });

    const res = await ingestAuditEvidence(PARAMS);

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/ingest');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    const body = JSON.parse(init.body);
    expect(body.kind).toBe('AUDIT_EVIDENCE');
    expect(body.content).toBe('[x] Section A complete');
    expect(body.protocol_id).toBeUndefined();

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_attach_evidence', {
      p_audit_id: 'a1',
      p_document_id: 'd1',
      p_source_type: 'Completed questionnaire',
      p_source_locator: null,
    });
    expect(res).toEqual({
      ok: true,
      data: { ...JOIN_ROW, title: 'Completed questionnaire', status: 'ready' },
    });
  });

  it('maps a thrown fetch (network drop) to a Result error — busy state must never stick', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await ingestAuditEvidence(PARAMS);
    expect(res.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('surfaces the ingest error and never calls the attach RPC', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Request body too large (max 50 MB)' }),
    });
    const res = await ingestAuditEvidence(PARAMS);
    expect(res).toEqual({ ok: false, error: 'Request body too large (max 50 MB)' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('prefers the RPC hint over the raw message on attach failure', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ document_id: 'd1' }),
    });
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'P0002', hint: 'Audit a1 not found' },
    });
    const res = await ingestAuditEvidence(PARAMS);
    expect(res).toEqual({ ok: false, error: 'Audit a1 not found' });
  });
});

describe('removeAuditEvidence', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns { ok: true, data: null } on success', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    const res = await removeAuditEvidence('a1', 'd1');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_remove_evidence', {
      p_audit_id: 'a1',
      p_document_id: 'd1',
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it('surfaces error.message when no hint is present', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Evidence d1 is not attached to audit a1' },
    });
    const res = await removeAuditEvidence('a1', 'd1');
    expect(res).toEqual({ ok: false, error: 'Evidence d1 is not attached to audit a1' });
  });
});
