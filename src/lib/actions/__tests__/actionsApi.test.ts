import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  fetchActionCards,
  setActionCardStatus,
  syncActionCards,
} from '../actionsApi';

// =============================================================================
// actionsApi — ActionsResult<T> contract: exact RPC argument shapes, error
// passthrough, defensive payload handling. Sync is best-effort for callers;
// its failure shape must still be a clean ok:false.
// =============================================================================

beforeEach(() => {
  rpcMock.mockReset();
});

describe('syncActionCards', () => {
  it('calls action_cards_sync with p_protocol_id and shapes counters', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { cards_created: 1, cards_updated: 0 },
      error: null,
    });
    const r = await syncActionCards('prot-1');
    expect(rpcMock).toHaveBeenCalledWith('action_cards_sync', {
      p_protocol_id: 'prot-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ cards_created: 1, cards_updated: 0 });
  });

  it('defaults missing counters to 0', async () => {
    rpcMock.mockResolvedValueOnce({ data: {}, error: null });
    const r = await syncActionCards('prot-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ cards_created: 0, cards_updated: 0 });
  });

  it('surfaces the RPC error message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'insufficient_privilege' },
    });
    const r = await syncActionCards('prot-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('insufficient_privilege');
  });
});

describe('fetchActionCards', () => {
  it('calls action_cards_get and adapts entries defensively', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [
        {
          id: 'card-1',
          protocol_id: 'prot-1',
          deliverable_id: null,
          trigger_context: 'monitoring_prep',
          title: 'Plan monitoring travel',
          rationale: 'A monitoring visit will need focused preparation.',
          protocol_evidence_ids: [],
          suggested_window: null,
          external_destination_type: 'travel',
          external_url_or_template: null,
          disclaimer: 'Planning support only.',
          status: 'suggested',
          created_at: '2026-07-04T12:00:00Z',
          updated_at: '2026-07-04T12:00:00Z',
        },
        { junk: true },
      ],
      error: null,
    });
    const r = await fetchActionCards('prot-1');
    expect(rpcMock).toHaveBeenCalledWith('action_cards_get', {
      p_protocol_id: 'prot-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toHaveLength(1);
      expect(r.data[0].id).toBe('card-1');
    }
  });

  it('surfaces the RPC error message', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const r = await fetchActionCards('prot-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('permission denied');
  });
});

describe('setActionCardStatus', () => {
  it('calls action_card_set_status with the exact args', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { card_id: 'card-1', status: 'dismissed' },
      error: null,
    });
    const r = await setActionCardStatus('card-1', 'dismissed');
    expect(rpcMock).toHaveBeenCalledWith('action_card_set_status', {
      p_card_id: 'card-1',
      p_status: 'dismissed',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.status).toBe('dismissed');
  });

  it('rejects a malformed payload as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: { nope: true }, error: null });
    const r = await setActionCardStatus('card-1', 'acted');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});
