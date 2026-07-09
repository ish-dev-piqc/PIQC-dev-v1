import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { fetchNotices, setNoticeStatus, syncNotices } from '../actionsApi';

// =============================================================================
// actionsApi (notices) — ActionsResult<T> contract: exact RPC argument shapes,
// error passthrough, defensive payload handling. Sync is best-effort for
// callers; its failure shape must still be a clean ok:false.
// =============================================================================

beforeEach(() => {
  rpcMock.mockReset();
});

describe('syncNotices', () => {
  it('calls protocol_notices_sync with p_protocol_id and shapes counters', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { notices_upserted: 2, notices_deleted: 1 },
      error: null,
    });
    const r = await syncNotices('prot-1');
    expect(rpcMock).toHaveBeenCalledWith('protocol_notices_sync', {
      p_protocol_id: 'prot-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ notices_upserted: 2, notices_deleted: 1 });
  });

  it('defaults missing counters to 0', async () => {
    rpcMock.mockResolvedValueOnce({ data: {}, error: null });
    const r = await syncNotices('prot-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ notices_upserted: 0, notices_deleted: 0 });
  });

  it('surfaces the RPC error message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'insufficient_privilege' },
    });
    const r = await syncNotices('prot-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('insufficient_privilege');
  });
});

describe('fetchNotices', () => {
  it('calls protocol_notices_get and adapts entries defensively', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: 'notice-1',
          protocol_id: 'prot-1',
          notice_type: 'tight_visit_window',
          severity: 1,
          headline: 'Tight visit windows',
          detail: '3 visits allow 2 days or less of scheduling tolerance.',
          observed_count: 3,
          protocol_evidence_ids: [],
          status: 'active',
          created_at: '2026-07-08T12:00:00Z',
          updated_at: '2026-07-08T12:00:00Z',
        },
        { junk: true },
      ],
      error: null,
    });
    const r = await fetchNotices('prot-1');
    expect(rpcMock).toHaveBeenCalledWith('protocol_notices_get', {
      p_protocol_id: 'prot-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].id).toBe('notice-1');
    }
  });

  it('surfaces the RPC error message', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const r = await fetchNotices('prot-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('permission denied');
  });
});

describe('setNoticeStatus', () => {
  it('calls protocol_notice_set_status with the exact args', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { notice_id: 'notice-1', status: 'dismissed' },
      error: null,
    });
    const r = await setNoticeStatus('notice-1', 'dismissed');
    expect(rpcMock).toHaveBeenCalledWith('protocol_notice_set_status', {
      p_notice_id: 'notice-1',
      p_status: 'dismissed',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('dismissed');
  });

  it('rejects a malformed payload as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: { nope: true }, error: null });
    const r = await setNoticeStatus('notice-1', 'active');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});
