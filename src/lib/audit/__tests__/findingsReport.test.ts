// Unit tests for findingsReport (PR-D4) — the first kind on the generic
// deliverable RPC pair. Locks the honesty contracts at the API boundary:
//   - absence ≠ failure on the read (failed:true = row state UNKNOWN)
//   - upsert/approve route through the GENERIC RPCs with p_kind pinned
//   - approve carries BOTH pins (updated_at + basis digest) and surfaces the
//     server hints (STALE_CONTENT / STALE_BASIS) through errorHint
//   - an unfetchable digest is null, never '' — the approve gate reads null
//     as "unknown", and unknown must block, not pass

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import {
  approveFindingsReport,
  fetchEntrySetDigest,
  fetchFindingsReport,
  upsertFindingsReport,
} from '../findingsReport';

const ROW = {
  id: 'fr1',
  audit_id: 'a1',
  content: { intro_text: 'Purpose of this audit…', closing_text: 'Next steps…' },
  approval_status: 'DRAFT',
  approved_by: null,
  approved_at: null,
  updated_at: '2026-09-06T10:00:00+00:00',
  basis_digest: null,
  generation_refs: null,
  grounding_snapshot: null,
  generated_at: null,
};

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
});

describe('fetchFindingsReport', () => {
  it('flattens a present row (name resolved, content passed through)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...ROW, approved_by: 'u1' }, error: null });
    const res = await fetchFindingsReport('a1');
    expect(res.failed).toBe(false);
    expect(res.report).toMatchObject({
      id: 'fr1',
      content: { intro_text: 'Purpose of this audit…', closing_text: 'Next steps…' },
      approved_by_name: 'Ada Auditor',
      basis_digest: null,
    });
  });

  it('absence is not failure: no row → report null, failed false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchFindingsReport('a1')).toEqual({ report: null, failed: false });
  });

  it('a read error is failure, not absence — callers must not render a scratch form', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'relation does not exist' } });
    expect(await fetchFindingsReport('a1')).toEqual({ report: null, failed: true });
  });

  it('tolerates malformed jsonb content (the upsert RPC does not validate shape)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...ROW, content: {} }, error: null });
    const res = await fetchFindingsReport('a1');
    expect(res.report?.content).toEqual({ intro_text: '', closing_text: '' });
  });
});

describe('fetchEntrySetDigest', () => {
  it('returns the server digest', async () => {
    mockRpc.mockResolvedValueOnce({ data: 'abc123', error: null });
    expect(await fetchEntrySetDigest('a1')).toBe('abc123');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_entry_set_digest', { p_audit_id: 'a1' });
  });

  it('null on error and on a non-string payload — unknown, never empty', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'function does not exist' } });
    expect(await fetchEntrySetDigest('a1')).toBeNull();
    mockRpc.mockResolvedValueOnce({ data: 42, error: null });
    expect(await fetchEntrySetDigest('a1')).toBeNull();
  });
});

describe('upsertFindingsReport', () => {
  it('routes through the generic RPC with p_kind pinned to findings_report', async () => {
    mockRpc.mockResolvedValueOnce({ data: ROW, error: null });
    const res = await upsertFindingsReport('a1', ROW.content, 'Narrative edited');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_deliverable', {
      p_kind: 'findings_report',
      p_audit_id: 'a1',
      p_content: ROW.content,
      p_reason: 'Narrative edited',
    });
    expect(res?.id).toBe('fr1');
  });

  it('null on error — the persistence hook reverts and banners on null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    expect(await upsertFindingsReport('a1', ROW.content)).toBeNull();
  });
});

describe('approveFindingsReport', () => {
  it('carries BOTH pins: the narrative version and the entry-set digest', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', basis_digest: 'digest-1' },
      error: null,
    });
    const res = await approveFindingsReport('fr1', ROW.updated_at, 'digest-1');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_approve_deliverable', {
      p_kind: 'findings_report',
      p_id: 'fr1',
      p_reason: null,
      p_expected_updated_at: ROW.updated_at,
      p_expected_basis_digest: 'digest-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.approval_status).toBe('APPROVED');
      expect(res.data.basis_digest).toBe('digest-1');
    }
  });

  it.each(['STALE_CONTENT', 'STALE_BASIS', 'MISSING_EXPECTED_BASIS'])(
    'surfaces the %s hint through errorHint',
    async (hint) => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'rejected', hint },
      });
      const res = await approveFindingsReport('fr1', ROW.updated_at, 'digest-1');
      expect(res).toEqual({ ok: false, error: 'rejected', errorHint: hint });
    },
  );
});
