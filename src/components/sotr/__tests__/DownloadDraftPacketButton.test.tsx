import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mocked at the supabase seam (same pattern as exportApi.test.ts) instead of
// mocking the exportApi module: any vi.mock/vi.doMock of the exportApi module
// id (factory, sync factory, or automock alike) deadlocks the vitest 2.1.9
// worker once src/lib/supabase.ts stops throwing at collection (test.env
// injection in vitest.config.ts). The real exportApi runs here; tests drive
// success/failure through the RPC instead.
vi.mock('../../../lib/supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import DownloadDraftPacketButton from '../DownloadDraftPacketButton';
import { supabase } from '../../../lib/supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

function packetResponse(rowCount: number, studyCode: string | null = 'BRIGHTEN-2') {
  return {
    data: {
      study_id: 'study-1',
      study_code: studyCode,
      generated_at: '2026-07-04',
      rows: Array.from({ length: rowCount }, (_, i) => ({ worksheet_item_id: `item-${i}` })),
    },
    error: null,
  };
}

describe('DownloadDraftPacketButton', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockRpc.mockReset();
    // fetchDraftConfidencePacket logs a safe rowCount summary; keep test output clean.
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    infoSpy.mockRestore();
    // Local cleanup: globals is false so RTL auto-cleanup never registers.
    // Redundant-but-harmless once fix-vitest-cleanup lands it in setup.ts.
    cleanup();
  });

  it('renders the trigger with the draft-confidence label', () => {
    render(<DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />);
    expect(screen.getByTestId('sotr-download-draft-packet-button'))
      .toHaveTextContent(/Download Draft Confidence Packet/i);
  });

  it('uses no final-approval / signature language', () => {
    const { container } = render(
      <DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />,
    );
    const text = container.textContent || '';
    expect(text).not.toMatch(/\bApproved\b|\bSigned\b|\bCertified\b|\bGxP\b|\bPart 11\b/i);
  });

  it('triggers the export on click and shows success feedback', async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValueOnce(packetResponse(7));

    render(<DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('sotr_get_draft_confidence_packet', {
        p_study_id: 'study-1',
      });
    });

    const success = await screen.findByTestId('sotr-download-draft-packet-success');
    expect(success).toHaveTextContent(/7 rows/);
  });

  it('shows a disabled "Preparing…" state while in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (v: ReturnType<typeof packetResponse>) => void;
    mockRpc.mockReturnValueOnce(
      new Promise((res) => { resolve = res; }),
    );

    render(<DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />);
    const button = screen.getByTestId('sotr-download-draft-packet-button');
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/preparing/i);

    resolve(packetResponse(1));
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows a friendly inline error and no raw error names on failure', async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValueOnce({ data: null, error: new Error('network down') });

    render(<DownloadDraftPacketButton studyId="study-1" />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    const err = await screen.findByTestId('sotr-download-draft-packet-error');
    expect(err).toHaveTextContent(/could not generate the draft packet/i);
    expect(err.textContent || '').not.toMatch(/network|Error:|stack|TypeError/i);
  });

  it('completes with the studyCode fallback when the packet has none', async () => {
    const user = userEvent.setup();
    mockRpc.mockResolvedValueOnce(packetResponse(0, null));

    render(<DownloadDraftPacketButton studyId="s-1" studyCode={null} />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('sotr_get_draft_confidence_packet', {
        p_study_id: 's-1',
      });
    });

    // Filename fallback sanitization happens inside downloadDraftConfidencePacket;
    // reaching success feedback proves the null studyCode path completes.
    const success = await screen.findByTestId('sotr-download-draft-packet-success');
    expect(success).toHaveTextContent(/0 rows/);
  });
});
