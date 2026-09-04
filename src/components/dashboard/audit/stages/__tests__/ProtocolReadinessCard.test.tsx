// ProtocolReadinessCard — the Stage-1 "is the protocol parsed?" card.
//
// The precedence table lives in protocolReadinessApi.test.ts; here we lock
// what the auditor SEES per state and the two behaviors a diff can't prove:
//   - { available: false } (RPC not applied yet) is a neutral line — no upload
//     control and never the "No protocol PDF" empty state;
//   - the poll: fires on mount for an own pending document, again on the
//     10 s tick, refetches status on a terminal answer, never overlaps an
//     in-flight check, and stops on unmount.
//
// Mock idiom: context hooks mocked (IsaConductWorkspace.test.tsx), the Api
// module partially mocked so the real deriveProtocolReadiness runs.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ProtocolDocumentStatus } from '../../../../../types/audit';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: {
      id: 'audit-1',
      protocol_id: 'protocol-1',
      protocol_code: 'PROTO-001',
      protocol_title: 'Protocol one',
    },
  }),
}));

vi.mock('../../../../../lib/audit/auditCreationApi', () => ({
  uploadProtocolPdf: vi.fn(),
}));

vi.mock('../../../../../lib/audit/protocolReadinessApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../lib/audit/protocolReadinessApi')>();
  return {
    ...actual,
    fetchProtocolDocumentStatus: vi.fn(),
    checkIngestStatus: vi.fn(),
  };
});

import ProtocolReadinessCard from '../ProtocolReadinessCard';
import { ProtocolSourceOpenContext } from '../../protocolSourceDrawerContext';
import {
  checkIngestStatus,
  fetchProtocolDocumentStatus,
} from '../../../../../lib/audit/protocolReadinessApi';

const mockFetchStatus = fetchProtocolDocumentStatus as unknown as ReturnType<typeof vi.fn>;
const mockCheckIngest = checkIngestStatus as unknown as ReturnType<typeof vi.fn>;

const BASE: ProtocolDocumentStatus = {
  protocol_id: 'protocol-1',
  any_ready: 0,
  own_ready: 0,
  any_pending: 0,
  own_pending_document_id: null,
  own_failed_error: null,
  visible_item_count: 0,
};

function statusOk(patch: Partial<ProtocolDocumentStatus>) {
  return { ok: true as const, data: { available: true as const, ...BASE, ...patch } };
}

beforeEach(() => {
  mockFetchStatus.mockReset();
  mockCheckIngest.mockReset();
});

// Under fake timers the chain status → effect → check → status spans several
// React commits: effects only flush when an act() round ends, and each effect
// starts a new mocked promise. Advance the clock once, then run a few act
// rounds so every commit's promises drain and its effects run.
async function settle(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  for (let round = 0; round < 4; round += 1) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ProtocolReadinessCard — states', () => {
  it('renders a neutral line, no upload control, when the RPC is not applied yet', async () => {
    mockFetchStatus.mockResolvedValue({ ok: true, data: { available: false } });
    render(<ProtocolReadinessCard />);

    expect(await screen.findByText("Parse status isn't available in this environment yet.")).toBeInTheDocument();
    expect(screen.queryByText(/No protocol PDF/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Upload/)).not.toBeInTheDocument();
    expect(screen.queryByText(/PIQC drafts can cite/)).not.toBeInTheDocument();
  });

  it('shows the load error with a Retry that refetches', async () => {
    const user = userEvent.setup();
    mockFetchStatus
      .mockResolvedValueOnce({ ok: false, error: 'boom' })
      .mockResolvedValueOnce(statusOk({}));
    render(<ProtocolReadinessCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load protocol status: boom");
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/No protocol PDF has been parsed for PROTO-001/)).toBeInTheDocument();
    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
  });

  it('none → empty-state copy, upload control, "can cite: no"', async () => {
    mockFetchStatus.mockResolvedValue(statusOk({}));
    render(<ProtocolReadinessCard />);

    expect(await screen.findByText(/No protocol PDF has been parsed for PROTO-001/)).toBeInTheDocument();
    expect(screen.getByLabelText('Upload protocol PDF')).toBeInTheDocument();
    expect(screen.getByText('PIQC drafts can cite this protocol: no')).toBeInTheDocument();
  });

  it('ready → item count, "Open protocol source" only with a provider, no upload control', async () => {
    const open = vi.fn();
    mockFetchStatus.mockResolvedValue(statusOk({ any_ready: 1, visible_item_count: 12 }));
    const user = userEvent.setup();

    const { unmount } = render(
      <ProtocolSourceOpenContext.Provider value={open}>
        <ProtocolReadinessCard />
      </ProtocolSourceOpenContext.Provider>,
    );
    expect(await screen.findByText(/Parsed · 12 worksheet items visible/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open protocol source' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(/Upload/)).not.toBeInTheDocument();
    expect(screen.getByText('PIQC drafts can cite this protocol: yes')).toBeInTheDocument();
    unmount();

    render(<ProtocolReadinessCard />);
    expect(await screen.findByText(/Parsed · 12 worksheet items visible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open protocol source' })).not.toBeInTheDocument();
  });

  it('ready without items → its own remedy and "Upload a different PDF"', async () => {
    mockFetchStatus.mockResolvedValue(statusOk({ any_ready: 1, visible_item_count: 0 }));
    render(<ProtocolReadinessCard />);

    expect(await screen.findByText(/no worksheet items were extracted/)).toBeInTheDocument();
    expect(screen.getByLabelText('Upload a different PDF')).toBeInTheDocument();
  });

  it('failed → the reason and "Upload again"', async () => {
    mockFetchStatus.mockResolvedValue(statusOk({ own_failed_error: 'Reducto job ended with status: failed' }));
    render(<ProtocolReadinessCard />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Parse failed: Reducto job ended with status: failed.',
    );
    expect(screen.getByLabelText('Upload again')).toBeInTheDocument();
  });

  it('parsing elsewhere → copy and a "Check again" that refetches', async () => {
    const user = userEvent.setup();
    mockFetchStatus.mockResolvedValue(statusOk({ any_pending: 1 }));
    render(<ProtocolReadinessCard />);

    expect(await screen.findByText(/being parsed under another account/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Check again/ }));
    await waitFor(() => expect(mockFetchStatus).toHaveBeenCalledTimes(2));
    expect(mockCheckIngest).not.toHaveBeenCalled();
  });
});

describe('ProtocolReadinessCard — poll', () => {
  it('polls an own pending document on mount and every 10 s, refetches on ready, stops on unmount', async () => {
    vi.useFakeTimers();
    mockFetchStatus
      .mockResolvedValueOnce(statusOk({ own_pending_document_id: 'doc-9', any_pending: 1 }))
      .mockResolvedValue(statusOk({ any_ready: 1, own_ready: 1, visible_item_count: 7 }));
    mockCheckIngest
      .mockResolvedValueOnce({ ok: true, data: { status: 'pending', error_message: null } })
      .mockResolvedValueOnce({ ok: true, data: { status: 'ready', error_message: null } });

    const { unmount } = render(<ProtocolReadinessCard />);

    // Status resolves → poll arms and fires immediately.
    await settle();
    expect(mockCheckIngest).toHaveBeenCalledTimes(1);
    expect(mockCheckIngest).toHaveBeenCalledWith('doc-9');
    expect(screen.getByText(/Parsing Protocol one/)).toBeInTheDocument();

    // Tick → second check answers ready → status refetched, poll stopped.
    await settle(10_000);
    expect(mockCheckIngest).toHaveBeenCalledTimes(2);
    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
    expect(screen.getByText(/Parsed · 7 worksheet items visible/)).toBeInTheDocument();

    await settle(30_000);
    expect(mockCheckIngest).toHaveBeenCalledTimes(2);

    unmount();
    await settle(30_000);
    expect(mockCheckIngest).toHaveBeenCalledTimes(2);
  });

  it('never overlaps: a slow check suppresses the next tick', async () => {
    vi.useFakeTimers();
    mockFetchStatus.mockResolvedValue(statusOk({ own_pending_document_id: 'doc-9', any_pending: 1 }));
    mockCheckIngest.mockReturnValue(new Promise(() => {})); // never resolves

    const { unmount } = render(<ProtocolReadinessCard />);
    await settle();
    expect(mockCheckIngest).toHaveBeenCalledTimes(1);

    await settle(25_000);
    expect(mockCheckIngest).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('keeps a failure it watched happen on screen after the refetch', async () => {
    vi.useFakeTimers();
    mockFetchStatus
      .mockResolvedValueOnce(statusOk({ own_pending_document_id: 'doc-9', any_pending: 1 }))
      .mockResolvedValue(statusOk({ any_ready: 1, visible_item_count: 0 }));
    mockCheckIngest.mockResolvedValueOnce({
      ok: true,
      data: { status: 'failed', error_message: 'Reducto job ended with status: failed' },
    });

    const { unmount } = render(<ProtocolReadinessCard />);
    await settle();

    expect(screen.getByRole('alert')).toHaveTextContent('Parse failed: Reducto job ended with status: failed.');
    expect(screen.getByLabelText('Upload again')).toBeInTheDocument();
    expect(mockFetchStatus).toHaveBeenCalledTimes(2);
    unmount();
  });
});
