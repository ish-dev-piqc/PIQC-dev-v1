// Unit tests for auditCertificate (PR-D6) — the second kind on the generic
// deliverable RPC pair, and the first with the REPORT_VERSION basis. Locks
// the honesty contracts at the API boundary:
//   - absence ≠ failure on the read (failed:true = row state UNKNOWN)
//   - upsert/approve route through the GENERIC RPCs with p_kind pinned
//   - approve carries BOTH pins (updated_at + report fingerprint) and
//     surfaces the server hints through errorHint
//   - fetchReportBasis mirrors the server's REPORT_VERSION arm exactly:
//     digest = readiness_fingerprint only while APPROVED, else null; a read
//     error is null (basis UNKNOWN), never a fabricated "unapproved"

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
  approveAuditCertificate,
  fetchAuditCertificate,
  fetchReportBasis,
  upsertAuditCertificate,
} from '../auditCertificate';

const ROW = {
  id: 'cert1',
  audit_id: 'a1',
  content: { body_text: 'This certificate records that…', scope: ['Data integrity', 'CAPA'] },
  approval_status: 'DRAFT',
  approved_by: null,
  approved_at: null,
  updated_at: '2026-09-07T10:00:00+00:00',
  basis_digest: null,
  generation_refs: null,
  grounding_snapshot: null,
  generated_at: null,
};

beforeEach(() => {
  mockRpc.mockReset();
  mockMaybeSingle.mockReset();
});

describe('fetchAuditCertificate', () => {
  it('flattens a present row (name resolved, content passed through)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: { ...ROW, approved_by: 'u1' }, error: null });
    const res = await fetchAuditCertificate('a1');
    expect(res.failed).toBe(false);
    expect(res.certificate).toMatchObject({
      id: 'cert1',
      content: { body_text: 'This certificate records that…', scope: ['Data integrity', 'CAPA'] },
      approved_by_name: 'Ada Auditor',
      basis_digest: null,
    });
  });

  it('absence is not failure: no row → certificate null, failed false', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchAuditCertificate('a1')).toEqual({ certificate: null, failed: false });
  });

  it('a read error is failure, not absence — callers must not render a scratch form', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'relation does not exist' } });
    expect(await fetchAuditCertificate('a1')).toEqual({ certificate: null, failed: true });
  });

  it('tolerates malformed jsonb content (the upsert RPC does not validate shape)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { ...ROW, content: { scope: ['ok', 42, null] } },
      error: null,
    });
    const res = await fetchAuditCertificate('a1');
    expect(res.certificate?.content).toEqual({ body_text: '', scope: ['ok'] });
  });
});

describe('fetchReportBasis', () => {
  it('an APPROVED report with a fingerprint yields the digest', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        approval_status: 'APPROVED',
        approved_at: '2026-09-06T09:00:00+00:00',
        readiness_fingerprint: 'fp-1',
      },
      error: null,
    });
    expect(await fetchReportBasis('a1')).toEqual({
      approved: true,
      approvedAt: '2026-09-06T09:00:00+00:00',
      digest: 'fp-1',
    });
  });

  it('a DRAFT report yields approved:false, digest null — even if a stale fingerprint lingers', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: { approval_status: 'DRAFT', approved_at: null, readiness_fingerprint: 'fp-old' },
      error: null,
    });
    expect(await fetchReportBasis('a1')).toEqual({ approved: false, approvedAt: null, digest: null });
  });

  it('a legacy APPROVED report without a fingerprint yields digest null (approve stays blocked)', async () => {
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        approval_status: 'APPROVED',
        approved_at: '2026-01-01T00:00:00+00:00',
        readiness_fingerprint: null,
      },
      error: null,
    });
    const basis = await fetchReportBasis('a1');
    expect(basis).toEqual({
      approved: true,
      approvedAt: '2026-01-01T00:00:00+00:00',
      digest: null,
    });
  });

  it('no report row yields approved:false — absence is a real state here', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });
    expect(await fetchReportBasis('a1')).toEqual({ approved: false, approvedAt: null, digest: null });
  });

  it('null on read error — basis UNKNOWN, never a fabricated "unapproved"', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } });
    expect(await fetchReportBasis('a1')).toBeNull();
  });
});

describe('upsertAuditCertificate', () => {
  it('routes through the generic RPC with p_kind pinned to audit_certificate', async () => {
    mockRpc.mockResolvedValueOnce({ data: ROW, error: null });
    const res = await upsertAuditCertificate('a1', ROW.content, 'Certificate edited');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_upsert_deliverable', {
      p_kind: 'audit_certificate',
      p_audit_id: 'a1',
      p_content: ROW.content,
      p_reason: 'Certificate edited',
    });
    expect(res?.id).toBe('cert1');
  });

  it('null on error — the persistence hook reverts and banners on null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    expect(await upsertAuditCertificate('a1', ROW.content)).toBeNull();
  });
});

describe('approveAuditCertificate', () => {
  it('carries BOTH pins: the certificate version and the report fingerprint', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { ...ROW, approval_status: 'APPROVED', approved_by: 'u1', basis_digest: 'fp-1' },
      error: null,
    });
    const res = await approveAuditCertificate('cert1', ROW.updated_at, 'fp-1');
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_approve_deliverable', {
      p_kind: 'audit_certificate',
      p_id: 'cert1',
      p_reason: null,
      p_expected_updated_at: ROW.updated_at,
      p_expected_basis_digest: 'fp-1',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.approval_status).toBe('APPROVED');
      expect(res.data.basis_digest).toBe('fp-1');
    }
  });

  it.each(['STALE_CONTENT', 'STALE_BASIS', 'MISSING_EXPECTED_BASIS'])(
    'surfaces the %s hint through errorHint',
    async (hint) => {
      mockRpc.mockResolvedValueOnce({
        data: null,
        error: { message: 'rejected', hint },
      });
      const res = await approveAuditCertificate('cert1', ROW.updated_at, 'fp-1');
      expect(res).toEqual({ ok: false, error: 'rejected', errorHint: hint });
    },
  );
});
