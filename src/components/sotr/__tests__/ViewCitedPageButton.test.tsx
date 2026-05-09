import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/sotr/protocolPdfApi', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/sotr/protocolPdfApi')>(
    '../../../lib/sotr/protocolPdfApi',
  );
  return {
    ...actual,
    fetchProtocolPdfUrl: vi.fn(),
  };
});

import ViewCitedPageButton from '../ViewCitedPageButton';
import {
  fetchProtocolPdfUrl,
  ProtocolPdfNotRetainedError,
  ProtocolPdfAccessDeniedError,
  ProtocolPdfSigningError,
} from '../../../lib/sotr/protocolPdfApi';

const mockFetch = fetchProtocolPdfUrl as unknown as ReturnType<typeof vi.fn>;

describe('ViewCitedPageButton', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('renders the button with the expected label', () => {
    render(<ViewCitedPageButton studyId="study-1" documentId="doc-1" />);
    expect(screen.getByTestId('sotr-view-cited-page-button'))
      .toHaveTextContent(/view cited page in protocol/i);
  });

  it('opens the signed URL in a new tab on click', async () => {
    const user = userEvent.setup();
    const opener = vi.fn();
    mockFetch.mockResolvedValueOnce({
      url: 'https://x.example/signed?token=ABC',
      expiresAt: Date.now() + 60_000,
    });

    render(
      <ViewCitedPageButton
        studyId="study-1"
        documentId="doc-1"
        opener={opener}
      />,
    );

    await user.click(screen.getByTestId('sotr-view-cited-page-button'));

    await waitFor(() => {
      expect(opener).toHaveBeenCalledOnce();
    });
    expect(opener).toHaveBeenCalledWith('https://x.example/signed?token=ABC');
    expect(screen.queryByTestId('sotr-view-cited-page-error')).toBeNull();
  });

  it('shows the not-retained message and does not open a URL on PDF-not-retained', async () => {
    const user = userEvent.setup();
    const opener = vi.fn();
    mockFetch.mockRejectedValueOnce(new ProtocolPdfNotRetainedError('doc-1'));

    render(
      <ViewCitedPageButton
        studyId="study-1"
        documentId="doc-1"
        opener={opener}
      />,
    );

    await user.click(screen.getByTestId('sotr-view-cited-page-button'));

    const err = await screen.findByTestId('sotr-view-cited-page-error');
    expect(err).toHaveTextContent(/no pdf stored/i);
    expect(opener).not.toHaveBeenCalled();
  });

  it('shows the access-denied message on PDF access denied', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new ProtocolPdfAccessDeniedError());

    render(<ViewCitedPageButton studyId="study-1" documentId="doc-1" />);
    await user.click(screen.getByTestId('sotr-view-cited-page-button'));

    expect(await screen.findByTestId('sotr-view-cited-page-error'))
      .toHaveTextContent(/do not have access/i);
  });

  it('shows generic friendly copy on unknown signing failure', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new ProtocolPdfSigningError());

    render(<ViewCitedPageButton studyId="study-1" documentId="doc-1" />);
    await user.click(screen.getByTestId('sotr-view-cited-page-button'));

    const err = await screen.findByTestId('sotr-view-cited-page-error');
    expect(err).toHaveTextContent(/could not open the protocol pdf/i);
    // Friendly — no raw error names
    expect(err.textContent || '').not.toMatch(/Error|Exception|stack/i);
  });

  it('disables the button while a request is in flight', async () => {
    const user = userEvent.setup();
    let resolve!: (v: { url: string; expiresAt: number }) => void;
    mockFetch.mockReturnValueOnce(
      new Promise((res) => { resolve = res; }),
    );

    render(<ViewCitedPageButton studyId="study-1" documentId="doc-1" opener={() => {}} />);

    const button = screen.getByTestId('sotr-view-cited-page-button');
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/opening/i);

    resolve({ url: 'https://x', expiresAt: Date.now() + 1000 });
    await waitFor(() => expect(button).not.toBeDisabled());
  });

  it('does not render any URL-shaped strings in the error UI', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new ProtocolPdfNotRetainedError('doc-1'));

    const { container } = render(
      <ViewCitedPageButton studyId="study-1" documentId="doc-1" />,
    );
    await user.click(screen.getByTestId('sotr-view-cited-page-button'));
    await screen.findByTestId('sotr-view-cited-page-error');

    expect(container.textContent || '').not.toMatch(/https?:\/\//);
    expect(container.textContent || '').not.toMatch(/supabase\.co\/storage/);
  });
});
