import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { NoticeRecord } from '../../../types/actions';

// Mock the api layer BEFORE importing the rail — the rail owns its own
// sync → fetch data flow, and we assert the silent-with-signal contract
// without touching supabase.
const syncNotices = vi.fn();
const fetchNotices = vi.fn();
const setNoticeStatus = vi.fn();
vi.mock('../../../lib/actions/actionsApi', () => ({
  syncNotices: (...a: unknown[]) => syncNotices(...a),
  fetchNotices: (...a: unknown[]) => fetchNotices(...a),
  setNoticeStatus: (...a: unknown[]) => setNoticeStatus(...a),
}));

import { NoticeRail } from '../NoticeRail';

// =============================================================================
// NoticeRail — ambient strip: sync → fetch, self-hiding, dismiss → refetch.
// Silent-with-signal: loading renders nothing, zero notices renders nothing.
// =============================================================================

const notice = (over: Partial<NoticeRecord> = {}): NoticeRecord => ({
  id: 'notice-1',
  protocol_id: 'prot-1',
  notice_type: 'tight_visit_window',
  severity: 1,
  headline: 'Tight visit windows',
  detail: '3 visits allow 2 days or less of scheduling tolerance.',
  observed_count: 3,
  protocol_evidence_ids: ['ev-1'],
  status: 'active',
  created_at: '2026-07-08T12:00:00Z',
  updated_at: '2026-07-08T12:00:00Z',
  ...over,
});

beforeEach(() => {
  syncNotices.mockReset();
  fetchNotices.mockReset();
  setNoticeStatus.mockReset();
  syncNotices.mockResolvedValue({ ok: true, data: { notices_upserted: 0, notices_deleted: 0 } });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('NoticeRail', () => {
  it('syncs then fetches, rendering ranked notices', async () => {
    fetchNotices.mockResolvedValue({ ok: true, data: [notice()] });
    render(<NoticeRail protocolId="prot-1" />);
    expect(await screen.findByTestId('notice-rail')).toBeInTheDocument();
    expect(screen.getByText('Tight visit windows')).toBeInTheDocument();
    expect(syncNotices).toHaveBeenCalledWith('prot-1');
    expect(fetchNotices).toHaveBeenCalledWith('prot-1');
  });

  it('renders nothing when there are zero notices (self-hiding)', async () => {
    fetchNotices.mockResolvedValue({ ok: true, data: [] });
    render(<NoticeRail protocolId="prot-1" />);
    await waitFor(() => expect(fetchNotices).toHaveBeenCalled());
    expect(screen.queryByTestId('notice-rail')).not.toBeInTheDocument();
  });

  it('hides a dismissed notice and still renders whatever the fetch returns', async () => {
    fetchNotices.mockResolvedValue({
      ok: true,
      data: [notice(), notice({ id: 'notice-2', status: 'dismissed', headline: 'Gone' })],
    });
    render(<NoticeRail protocolId="prot-1" />);
    expect(await screen.findByText('Tight visit windows')).toBeInTheDocument();
    expect(screen.queryByText('Gone')).not.toBeInTheDocument();
  });

  it('still fetches when the best-effort sync fails', async () => {
    syncNotices.mockResolvedValue({ ok: false, error: 'insufficient_privilege' });
    fetchNotices.mockResolvedValue({ ok: true, data: [notice()] });
    render(<NoticeRail protocolId="prot-1" />);
    expect(await screen.findByText('Tight visit windows')).toBeInTheDocument();
  });

  it('dismiss sets status then refetches server truth', async () => {
    fetchNotices
      .mockResolvedValueOnce({ ok: true, data: [notice()] })
      .mockResolvedValueOnce({ ok: true, data: [notice({ status: 'dismissed' })] });
    setNoticeStatus.mockResolvedValue({ ok: true, data: { notice_id: 'notice-1', status: 'dismissed' } });

    render(<NoticeRail protocolId="prot-1" />);
    await screen.findByText('Tight visit windows');
    await userEvent.click(screen.getByTestId('notice-card-dismiss'));

    expect(setNoticeStatus).toHaveBeenCalledWith('notice-1', 'dismissed');
    await waitFor(() =>
      expect(screen.queryByTestId('notice-rail')).not.toBeInTheDocument(),
    );
  });
});
