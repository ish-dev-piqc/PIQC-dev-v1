// DashboardChat — shared chat engine (Site Ask + Audit Mode).
// Guards the Ask remediation behaviors AND Audit-mode non-regression:
// empty-response surfacing, failed-send retry, protocolId scope gating, and
// abort-on-unmount opt-in.
//
// Note: each test sets its own mock behavior (which overrides the previous), and
// we deliberately avoid a beforeEach mock-reset — resetting a mock in beforeEach
// races with testing-library's act() flushing and spuriously flags a caught
// rejection as unhandled. Failure is simulated with a synchronous throw so no
// floating rejected promise is ever created.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('../../../lib/supabase', () => ({
  streamDashboardChat: vi.fn(),
  // Chainable stub for the org-wide document fetch (Audit-mode selector).
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: [] }),
          }),
        }),
      }),
    }),
  },
}));

import DashboardChat from '../DashboardChat';
import { streamDashboardChat, type ExtendedMessage } from '../../../lib/supabase';

const mockStream = streamDashboardChat as unknown as ReturnType<typeof vi.fn>;

function Harness(props: Partial<React.ComponentProps<typeof DashboardChat>>) {
  const [messages, setMessages] = useState<ExtendedMessage[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  return (
    <DashboardChat
      messages={messages}
      setMessages={setMessages}
      selectedDocIds={selectedDocIds}
      setSelectedDocIds={setSelectedDocIds}
      {...props}
    />
  );
}

async function send(text: string) {
  await userEvent.type(screen.getByLabelText('Ask a question'), text);
  await userEvent.click(screen.getByRole('button', { name: /send/i }));
}

describe('DashboardChat', () => {
  afterEach(() => cleanup());

  it('surfaces an error (not a silent no-op) when the stream returns zero tokens', async () => {
    mockStream.mockResolvedValue({ ragStatus: 'not_found', ragError: '', sources: [] });
    render(<Harness protocolId="proto-1" />);

    await send('what is the dosing regimen');

    // User message stays; an error bubble with Retry appears.
    expect(await screen.findByText('what is the dosing regimen')).toBeTruthy();
    expect(await screen.findByText(/did not return a response/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('keeps the user message and shows an in-bubble error + retry on failure', async () => {
    // Synchronous throw — caught by handleSend's try, no floating rejected promise.
    mockStream.mockImplementation(() => { throw new Error('boom'); });
    render(<Harness protocolId="proto-1" />);

    await send('why did this fail');

    expect(await screen.findByText('why did this fail')).toBeTruthy();
    expect(await screen.findByText('boom')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('protocol-scoped mode hides the selector and sends protocolId with empty docIds', async () => {
    mockStream.mockClear();
    mockStream.mockResolvedValue({ ragStatus: 'found', ragError: '', sources: [] });
    render(<Harness protocolId="proto-1" />);

    // The "All documents" selector button is not rendered in protocol mode.
    expect(screen.queryByText('All documents')).toBeNull();

    await send('hello');
    await waitFor(() => expect(mockStream).toHaveBeenCalled());
    const arg = mockStream.mock.calls.at(-1)![0];
    expect(arg.protocolId).toBe('proto-1');
    expect(arg.selectedDocIds).toEqual([]);
  });

  it('Audit mode (no protocolId) shows the document selector', async () => {
    mockStream.mockResolvedValue({ ragStatus: 'found', ragError: '', sources: [] });
    render(<Harness />);
    expect(await screen.findByText('All documents')).toBeTruthy();
  });

  it('aborts the in-flight stream on unmount when abortOnUnmount is set', async () => {
    let capturedSignal: AbortSignal | undefined;
    // Reject on abort so the promise settles instead of dangling.
    mockStream.mockImplementation((opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise((_resolve, reject) => {
        opts.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    });

    const { unmount } = render(<Harness protocolId="proto-1" abortOnUnmount />);
    await send('long running');
    await waitFor(() => expect(capturedSignal).toBeDefined());
    act(() => unmount());
    expect(capturedSignal!.aborted).toBe(true);
  });

  it('does not abort on unmount when abortOnUnmount is unset (Audit background completion)', async () => {
    let capturedSignal: AbortSignal | undefined;
    let settle: (() => void) | undefined;
    mockStream.mockImplementation((opts: { signal?: AbortSignal }) => {
      capturedSignal = opts.signal;
      return new Promise<{ ragStatus: string; ragError: string; sources: [] }>((resolve) => {
        settle = () => resolve({ ragStatus: 'stopped', ragError: '', sources: [] });
      });
    });

    const { unmount } = render(<Harness protocolId="proto-1" />);
    await send('long running');
    await waitFor(() => expect(capturedSignal).toBeDefined());
    act(() => unmount());
    expect(capturedSignal!.aborted).toBe(false);
    settle?.(); // let the pending stream settle so the runner doesn't hang
  });
});
