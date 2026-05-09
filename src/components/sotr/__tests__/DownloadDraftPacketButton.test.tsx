import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/sotr/exportApi', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/sotr/exportApi')>(
    '../../../lib/sotr/exportApi',
  );
  return { ...actual, downloadDraftConfidencePacket: vi.fn() };
});

import DownloadDraftPacketButton from '../DownloadDraftPacketButton';
import { downloadDraftConfidencePacket } from '../../../lib/sotr/exportApi';

const mockDownload = downloadDraftConfidencePacket as unknown as ReturnType<typeof vi.fn>;

describe('DownloadDraftPacketButton', () => {
  beforeEach(() => mockDownload.mockReset());

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
    mockDownload.mockResolvedValueOnce({
      rowCount: 7,
      filename: 'draft-confidence-packet_BRIGHTEN-2_2026-05-09.csv',
    });

    render(<DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith('study-1', 'BRIGHTEN-2');
    });

    const success = await screen.findByTestId('sotr-download-draft-packet-success');
    expect(success).toHaveTextContent(/7 rows/);
  });

  it('shows a disabled "Preparing…" state while in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (v: { rowCount: number; filename: string }) => void;
    mockDownload.mockReturnValueOnce(
      new Promise((res) => { resolve = res; }),
    );

    render(<DownloadDraftPacketButton studyId="study-1" studyCode="BRIGHTEN-2" />);
    const button = screen.getByTestId('sotr-download-draft-packet-button');
    await user.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/preparing/i);

    resolve({ rowCount: 1, filename: 'x.csv' });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('shows a friendly inline error and no raw error names on failure', async () => {
    const user = userEvent.setup();
    mockDownload.mockRejectedValueOnce(new Error('network down'));

    render(<DownloadDraftPacketButton studyId="study-1" />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    const err = await screen.findByTestId('sotr-download-draft-packet-error');
    expect(err).toHaveTextContent(/could not generate the draft packet/i);
    expect(err.textContent || '').not.toMatch(/network|Error:|stack|TypeError/i);
  });

  it('passes the studyCode through to the export call (filename stem)', async () => {
    const user = userEvent.setup();
    mockDownload.mockResolvedValueOnce({ rowCount: 0, filename: 'x.csv' });

    render(<DownloadDraftPacketButton studyId="s-1" studyCode={null} />);
    await user.click(screen.getByTestId('sotr-download-draft-packet-button'));

    await waitFor(() => {
      expect(mockDownload).toHaveBeenCalledWith('s-1', null);
    });
  });
});
