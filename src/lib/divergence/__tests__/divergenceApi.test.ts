import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn(() => ({ eq: (...a: unknown[]) => eqMock(...a) }));
const fromMock = vi.fn(() => ({ select: (...a: unknown[]) => selectMock(...a) }));
vi.mock('../../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { fetchProtocolDivergences, updateDivergenceStatus } from '../divergenceApi';
import { validDivergenceRow as validRow } from './fixtures';

// =============================================================================
// divergenceApi — Result<T> contract: exact query/RPC shapes, error passthrough,
// and defensive payload handling. The property that matters most: a malformed
// row is DROPPED rather than surfaced half-parsed, because every record here is
// a claim that two readings of the protocol disagree.
// =============================================================================

beforeEach(() => {
  rpcMock.mockReset();
  eqMock.mockReset();
  selectMock.mockClear();
  fromMock.mockClear();
});

describe('fetchProtocolDivergences', () => {
  it('queries protocol_divergences scoped to the protocol and returns adapted records', async () => {
    eqMock.mockResolvedValueOnce({ data: [validRow], error: null });
    const r = await fetchProtocolDivergences('p1');
    expect(fromMock).toHaveBeenCalledWith('protocol_divergences');
    expect(selectMock).toHaveBeenCalledWith('*');
    expect(eqMock).toHaveBeenCalledWith('protocol_id', 'p1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].divergence_class).toBe('window_mismatch');
    }
  });

  it('returns records in sortDivergences order — open work first', async () => {
    eqMock.mockResolvedValueOnce({
      data: [
        { ...validRow, id: 'closed', status: 'resolved' },
        { ...validRow, id: 'open' },
      ],
      error: null,
    });
    const r = await fetchProtocolDivergences('p1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.map((d) => d.id)).toEqual(['open', 'closed']);
  });

  it('drops malformed rows instead of surfacing them half-parsed', async () => {
    eqMock.mockResolvedValueOnce({
      data: [validRow, { ...validRow, id: 'bad', class: 'made_up' }, null],
      error: null,
    });
    const r = await fetchProtocolDivergences('p1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.map((d) => d.id)).toEqual(['d1']);
  });

  it('tolerates a non-array payload', async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await fetchProtocolDivergences('p1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual([]);
  });

  it('passes a query error through as ok:false', async () => {
    eqMock.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const r = await fetchProtocolDivergences('p1');
    expect(r).toEqual({ ok: false, error: 'permission denied' });
  });

  it('converts a thrown client error into ok:false, never a throw', async () => {
    eqMock.mockRejectedValueOnce(new Error('network down'));
    const r = await fetchProtocolDivergences('p1');
    expect(r).toEqual({ ok: false, error: 'network down' });
  });
});

describe('updateDivergenceStatus', () => {
  it('calls protocol_divergence_set_status with the exact argument shape', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...validRow, status: 'raised_with_sponsor' },
      error: null,
    });
    const r = await updateDivergenceStatus('d1', 'raised_with_sponsor', 'asked the sponsor');
    expect(rpcMock).toHaveBeenCalledWith('protocol_divergence_set_status', {
      p_divergence_id: 'd1',
      p_status: 'raised_with_sponsor',
      p_note: 'asked the sponsor',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('raised_with_sponsor');
  });

  it('forwards a null note (the RPC, not the client, enforces when one is required)', async () => {
    rpcMock.mockResolvedValueOnce({ data: validRow, error: null });
    await updateDivergenceStatus('d1', 'open', null);
    expect(rpcMock).toHaveBeenCalledWith(
      'protocol_divergence_set_status',
      expect.objectContaining({ p_note: null }),
    );
  });

  it('passes an RPC error through — e.g. the required-note guard', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'a note is required to resolve a divergence' },
    });
    const r = await updateDivergenceStatus('d1', 'resolved', null);
    expect(r).toEqual({ ok: false, error: 'a note is required to resolve a divergence' });
  });

  it('rejects an unexpected response shape rather than returning a partial record', async () => {
    rpcMock.mockResolvedValueOnce({ data: { id: 'd1' }, error: null });
    const r = await updateDivergenceStatus('d1', 'resolved', 'done');
    expect(r).toEqual({ ok: false, error: 'Unexpected response shape from status update' });
  });

  it('converts a thrown client error into ok:false, never a throw', async () => {
    rpcMock.mockRejectedValueOnce(new Error('socket closed'));
    const r = await updateDivergenceStatus('d1', 'resolved', 'done');
    expect(r).toEqual({ ok: false, error: 'socket closed' });
  });
});
