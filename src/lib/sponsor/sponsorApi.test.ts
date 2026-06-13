import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
vi.mock('../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import { listMySponsorPortfolio } from './sponsorApi';

describe('sponsorApi.listMySponsorPortfolio', () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it('returns adapted rows on success', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          protocol_id: 'p-1',
          protocol_code: 'NCT99999',
          protocol_title: 'Phase II Onco Study',
          site_org_id: 'so-1',
          site_org_name: 'Acme CRO',
          participant_count: 12,
          last_visit_at: '2026-06-10',
        },
      ],
      error: null,
    });

    const res = await listMySponsorPortfolio();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data).toHaveLength(1);
    expect(res.data[0].protocolCode).toBe('NCT99999');
    expect(res.data[0].participantCount).toBe(12);
  });

  it('returns ok:true with empty array when RPC returns no rows', async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const res = await listMySponsorPortfolio();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it('coerces null data into an empty array', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const res = await listMySponsorPortfolio();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toEqual([]);
  });

  it('surfaces RPC errors as Result.fail', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });
    const res = await listMySponsorPortfolio();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('listMySponsorPortfolio');
      expect(res.error).toContain('permission denied');
    }
  });
});
