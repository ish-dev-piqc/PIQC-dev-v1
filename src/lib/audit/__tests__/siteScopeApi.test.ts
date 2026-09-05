// siteScopeApi — the client side of site_scope_objects, the 8th kind on the
// generic deliverable pair. Pins the read's three outcomes (loaded / not
// applied / failed), the content tolerance, and the two RPC payloads: upsert
// with p_kind 'site_scope', approve with the updated_at pin ONLY — this kind
// has no basis, and passing a digest is a server error (22023). Mock idiom:
// auditCertificate.test.ts.

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
import { approveSiteScope, fetchSiteScope, upsertSiteScope } from '../siteScopeApi';
import type { SiteScopeContent } from '../../../types/audit';

const CONTENT: SiteScopeContent = {
  built_from: { mapping_ids: ['smm-1', 'smm-2'], built_at: '2026-09-05T10:00:00.000Z' },
  modules: [
    {
      isa_domain: 'INFORMED_CONSENT',
      criticality: 'CRITICAL',
      items: [
        {
          id: 'smm-1',
          protocol_risk_id: 'risk-1',
          isa_domain: 'INFORMED_CONSENT',
          section_identifier: '§5.1',
          section_title: 'Primary endpoint: overall survival',
          criticality: 'CRITICAL',
          rationale: 'Derived from: primary endpoint, data integrity impact.',
        },
      ],
    },
  ],
};

const ROW = {
  id: 'scope-1',
  audit_id: 'audit-isa-1',
  content: CONTENT,
  approval_status: 'DRAFT',
  approved_by: null,
  approved_at: null,
  updated_at: '2026-09-05T10:00:00+00:00',
};

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSiteScope', () => {
  it('reads the audit’s row and flattens it (name resolved, content passed through)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', approved_at: '2026-09-05T11:00:00+00:00' },
      error: null,
    });

    const res = await fetchSiteScope('audit-isa-1');

    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('site_scope_objects');
    expect(res).toEqual({
      kind: 'loaded',
      scope: {
        id: 'scope-1',
        audit_id: 'audit-isa-1',
        content: CONTENT,
        approval_status: 'APPROVED',
        approved_at: '2026-09-05T11:00:00+00:00',
        approved_by_name: 'Ada Auditor',
        updated_at: '2026-09-05T10:00:00+00:00',
      },
    });
  });

  it('absence is not failure: no row → loaded with a null scope', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchSiteScope('audit-isa-1')).toEqual({ kind: 'loaded', scope: null });
  });

  it('a missing table (schema not applied yet) is unavailable, not failure', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST205', message: "Could not find the table 'public.site_scope_objects' in the schema cache" },
    });
    expect(await fetchSiteScope('audit-isa-1')).toEqual({ kind: 'unavailable' });

    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42P01', message: 'relation does not exist' } });
    expect(await fetchSiteScope('audit-isa-1')).toEqual({ kind: 'unavailable' });
  });

  it('any other read error is failed — the row state is unknown', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { code: '42501', message: 'permission denied' } });
    expect(await fetchSiteScope('audit-isa-1')).toEqual({ kind: 'failed' });
  });

  it('tolerates a malformed top-level content object (the upsert RPC does not validate shape)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...ROW, content: { built_from: { mapping_ids: ['ok', 42, null] }, modules: 'nope' } },
      error: null,
    });
    const res = await fetchSiteScope('audit-isa-1');
    expect(res.kind === 'loaded' && res.scope?.content).toEqual({
      built_from: { mapping_ids: ['ok'], built_at: '' },
      modules: [],
    });
  });
});

describe('upsertSiteScope', () => {
  it('routes through the generic upsert with p_kind site_scope and returns the flattened row', async () => {
    mockRpc.mockResolvedValueOnce({ data: ROW, error: null });

    const res = await upsertSiteScope('audit-isa-1', CONTENT, 'Site audit scope built from 2 module mappings');

    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_deliverable', {
      p_kind: 'site_scope',
      p_audit_id: 'audit-isa-1',
      p_content: CONTENT,
      p_reason: 'Site audit scope built from 2 module mappings',
    });
    expect(res).toMatchObject({ id: 'scope-1', approval_status: 'DRAFT', approved_by_name: null, content: CONTENT });
  });

  it('a failed upsert is null (the persistence hook reverts the optimistic row)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'Not authenticated' } });
    expect(await upsertSiteScope('audit-isa-1', CONTENT)).toBeNull();
  });
});

describe('approveSiteScope', () => {
  it('carries the updated_at pin and NO basis digest (this kind declares none)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', approved_at: '2026-09-05T11:00:00+00:00' },
      error: null,
    });

    const res = await approveSiteScope('scope-1', '2026-09-05T10:00:00+00:00');

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc.mock.calls[0][0]).toBe('audit_mode_approve_deliverable');
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_kind: 'site_scope',
      p_id: 'scope-1',
      p_reason: null,
      p_expected_updated_at: '2026-09-05T10:00:00+00:00',
    });
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ approval_status: 'APPROVED', approved_by_name: 'Ada Auditor' }),
    });
  });

  it('surfaces the server hint on a CAS miss', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Site audit scope changed since it was last reviewed', hint: 'STALE_CONTENT' },
    });

    expect(await approveSiteScope('scope-1', '2026-09-05T10:00:00+00:00', 'Scope reviewed')).toEqual({
      ok: false,
      error: 'Site audit scope changed since it was last reviewed',
      errorHint: 'STALE_CONTENT',
    });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_reason: 'Scope reviewed' });
  });
});
