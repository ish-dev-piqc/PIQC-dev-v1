// documentRequestApi — the client side of document_request_objects, the 9th
// kind on the generic deliverable pair. Pins the read's three outcomes
// (loaded / not applied / failed), the content tolerance, and the two RPC
// payloads: upsert with p_kind 'document_request', approve with the
// updated_at pin ONLY — this kind has no basis, and passing a digest is a
// server error (22023). Mock idiom: siteScopeApi.test.ts.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockRpc, mockMaybeSingle } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })),
      })),
    })),
  },
}));

// The name resolver is preAuditApi's (reused, not cloned) — its own tests
// cover it; here it just returns a stable name.
vi.mock('../preAuditApi', () => ({
  resolveApprovedByName: vi.fn(async (id: string | null) => (id ? 'Ada Auditor' : null)),
}));

import { supabase } from '../../supabase';
import {
  approveDocumentRequest,
  fetchDocumentRequest,
  upsertDocumentRequest,
} from '../documentRequestApi';
import type { DocumentRequestContent } from '../../../types/audit';

const CONTENT: DocumentRequestContent = {
  built_from: {
    scope_id: 'scope-1',
    scope_modules: [{ isa_domain: 'INFORMED_CONSENT', criticality: 'CRITICAL' }],
    built_at: '2026-09-06T10:00:00.000Z',
  },
  items: [
    {
      key: 'baseline:isf_index',
      title: 'Investigator site file (regulatory binder) with its current index',
      detail: 'The complete essential-document file as maintained at the site.',
      basis: { kind: 'baseline' },
      included: true,
      note: '',
    },
    {
      key: 'INFORMED_CONSENT:icf_versions',
      title: 'All informed consent form versions',
      basis: { kind: 'module', isa_domain: 'INFORMED_CONSENT', criticality: 'CRITICAL' },
      included: false,
      note: 'Since 2024',
    },
  ],
  sampling_approach: 'All subjects with a deviation.',
  instructions: 'Room 4.',
};

const ROW = {
  id: 'request-1',
  audit_id: 'audit-isa-1',
  content: CONTENT,
  approval_status: 'DRAFT',
  approved_by: null,
  approved_at: null,
  updated_at: '2026-09-06T10:00:00+00:00',
};

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchDocumentRequest', () => {
  it('reads the audit’s row and flattens it (name resolved, content passed through)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', approved_at: '2026-09-06T11:00:00+00:00' },
      error: null,
    });

    const res = await fetchDocumentRequest('audit-isa-1');

    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('document_request_objects');
    expect(res).toEqual({
      kind: 'loaded',
      request: {
        id: 'request-1',
        audit_id: 'audit-isa-1',
        content: CONTENT,
        approval_status: 'APPROVED',
        approved_at: '2026-09-06T11:00:00+00:00',
        approved_by_name: 'Ada Auditor',
        updated_at: '2026-09-06T10:00:00+00:00',
      },
    });
  });

  it('absence is not failure: no row → loaded with a null request', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchDocumentRequest('audit-isa-1')).toEqual({ kind: 'loaded', request: null });
  });

  it('a missing table (schema not applied yet) is unavailable, not failure', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.document_request_objects' in the schema cache",
      },
    });
    expect(await fetchDocumentRequest('audit-isa-1')).toEqual({ kind: 'unavailable' });

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect(await fetchDocumentRequest('audit-isa-1')).toEqual({ kind: 'unavailable' });
  });

  it('any other read error is failed — the row state is unknown', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    expect(await fetchDocumentRequest('audit-isa-1')).toEqual({ kind: 'failed' });
  });

  it('tolerates a malformed top-level content object (the upsert RPC does not validate shape)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        ...ROW,
        content: {
          built_from: { scope_modules: [{ isa_domain: 'IRB_EC', criticality: 'LOW' }, 'junk', { isa_domain: 7 }] },
          items: [{ key: 'baseline:isf_index', title: 'ISF' }, { title: 'no key' }, 42],
          sampling_approach: null,
        },
      },
      error: null,
    });
    const res = await fetchDocumentRequest('audit-isa-1');
    expect(res.kind === 'loaded' && res.request?.content).toEqual({
      built_from: {
        scope_id: '',
        scope_modules: [{ isa_domain: 'IRB_EC', criticality: 'LOW' }],
        built_at: '',
      },
      items: [{ key: 'baseline:isf_index', title: 'ISF' }],
      sampling_approach: '',
      instructions: '',
    });
  });
});

describe('upsertDocumentRequest', () => {
  it('routes through the generic upsert with p_kind document_request and returns the flattened row', async () => {
    mockRpc.mockResolvedValueOnce({ data: ROW, error: null });

    const res = await upsertDocumentRequest('audit-isa-1', CONTENT, 'Document request built from 1 scope module');

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_deliverable', {
      p_kind: 'document_request',
      p_audit_id: 'audit-isa-1',
      p_content: CONTENT,
      p_reason: 'Document request built from 1 scope module',
    });
    expect(res).toMatchObject({ id: 'request-1', approval_status: 'DRAFT', approved_by_name: null, content: CONTENT });
  });

  it('a failed upsert is null (the persistence hook reverts the optimistic row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authenticated' } });
    expect(await upsertDocumentRequest('audit-isa-1', CONTENT)).toBeNull();
  });
});

describe('approveDocumentRequest', () => {
  it('carries the updated_at pin and NO basis digest (this kind declares none)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', approved_at: '2026-09-06T11:00:00+00:00' },
      error: null,
    });

    const res = await approveDocumentRequest('request-1', '2026-09-06T10:00:00+00:00');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('audit_mode_approve_deliverable');
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_kind: 'document_request',
      p_id: 'request-1',
      p_reason: null,
      p_expected_updated_at: '2026-09-06T10:00:00+00:00',
    });
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ approval_status: 'APPROVED', approved_by_name: 'Ada Auditor' }),
    });
  });

  it('surfaces the server hint on a CAS miss', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Document request changed since it was last reviewed', hint: 'STALE_CONTENT' },
    });

    expect(await approveDocumentRequest('request-1', '2026-09-06T10:00:00+00:00', 'Request reviewed')).toEqual({
      ok: false,
      error: 'Document request changed since it was last reviewed',
      errorHint: 'STALE_CONTENT',
    });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_reason: 'Request reviewed' });
  });
});
