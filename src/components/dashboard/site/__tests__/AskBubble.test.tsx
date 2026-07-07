// Regression guard for the New-chat-mid-stream orphan bubble (site twin of the
// sponsor fix in SponsorAskPanel, PR #464 / commit 2e83f83).
//
// The bug: "New chat" clears the thread and remounts the keyed AskTab, whose
// DashboardChat aborts the in-flight stream on unmount. The aborted send's
// finally then pushes {role:'assistant', content:'', error:'Stopped before a
// response was received.'} through the still-valid same-protocol setter —
// landing as the sole message of the freshly cleared thread, with a Retry that
// can't work (no user turn to retry). AskBubble's guardedSetMessages drops
// exactly that write: a functional update onto an empty thread that produces
// messages with no user turn but an assistant error.
//
// vitest runs with globals:false and RTL auto-cleanup isn't registered, so we
// unmount between cases ourselves (matches VisitConfidenceChip.test.tsx).
//
// Mock surface: ThemeContext / ProtocolContext (render prerequisites) and
// AskTab (captures the messages/setMessages props so the test can play the
// role of DashboardChat's aborted send). useAskThread runs for real against
// happy-dom's sessionStorage — the guard composes with the real thread hook.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import type { ExtendedMessage } from '../../../../lib/supabase';

type SetMessages = React.Dispatch<React.SetStateAction<ExtendedMessage[]>>;
type CapturedAskTabProps = { messages: ExtendedMessage[]; setMessages: SetMessages };

const captured = vi.hoisted(() => ({
  renders: [] as { messages: ExtendedMessage[]; setMessages: unknown }[],
}));

vi.mock('../AskTab', () => ({
  default: (props: CapturedAskTabProps) => {
    captured.renders.push(props);
    return <div data-testid="mock-ask-tab" />;
  },
}));

vi.mock('../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' }),
}));

vi.mock('../../../../context/ProtocolContext', () => ({
  useProtocol: () => ({
    activeProtocol: { id: 'proto-1', code: 'PX-101', sponsor: 'Sponsor', phase: 'Phase 1' },
  }),
}));

import AskBubble from '../AskBubble';

const OPEN_KEY = 'piq-site-ask-open-v1';
const THREAD_KEY = 'piq-site-ask-thread-v1:proto-1';

const SETTLED_EXCHANGE: ExtendedMessage[] = [
  { role: 'user', content: 'What are the visit windows?' },
  { role: 'assistant', content: 'Visits are windowed ±3 days.' },
];

// DashboardChat's handleSend-finally stopped branch, verbatim shape: no
// assistant placeholder was added yet, so it pushes an error-only bubble.
const stoppedStragglerUpdate = (prev: ExtendedMessage[]): ExtendedMessage[] => [
  ...prev,
  { role: 'assistant', content: '', error: 'Stopped before a response was received.' },
];

function latest(): CapturedAskTabProps {
  const last = captured.renders[captured.renders.length - 1];
  return { messages: last.messages, setMessages: last.setMessages as SetMessages };
}

beforeEach(() => {
  sessionStorage.clear();
  captured.renders.length = 0;
  sessionStorage.setItem(OPEN_KEY, '1'); // start expanded — AskTab mounted
});

afterEach(cleanup);

describe('AskBubble — New-chat-mid-stream orphan guard', () => {
  it('drops the aborted send\'s "Stopped…" straggler landing on the cleared thread', () => {
    sessionStorage.setItem(THREAD_KEY, JSON.stringify(SETTLED_EXCHANGE));
    render(<AskBubble />);
    expect(latest().messages).toEqual(SETTLED_EXCHANGE);

    // The in-flight send's closure holds the setter from before the remount.
    const setterHeldByAbortedSend = latest().setMessages;

    fireEvent.click(screen.getByTestId('ask-bubble-new-chat'));
    expect(latest().messages).toEqual([]);

    act(() => setterHeldByAbortedSend(stoppedStragglerUpdate));

    // Thread stays empty — no orphaned error bubble with a dead Retry.
    expect(latest().messages).toEqual([]);
    expect(screen.getByTestId('ask-bubble-new-chat')).toBeDisabled();
  });

  it('still lets a legitimate first send through after New chat', () => {
    sessionStorage.setItem(THREAD_KEY, JSON.stringify(SETTLED_EXCHANGE));
    render(<AskBubble />);
    fireEvent.click(screen.getByTestId('ask-bubble-new-chat'));

    const firstSend: ExtendedMessage[] = [
      { role: 'user', content: 'New question' },
      { role: 'assistant', content: '', streaming: true },
    ];
    act(() => latest().setMessages((prev) => [...prev, ...firstSend]));

    expect(latest().messages).toEqual(firstSend);
  });

  it('does not drop a normal Stop-mid-stream bubble when a user turn exists', () => {
    render(<AskBubble />);

    act(() => latest().setMessages([{ role: 'user', content: 'Question' }]));
    act(() => latest().setMessages(stoppedStragglerUpdate));

    expect(latest().messages).toEqual([
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: '', error: 'Stopped before a response was received.' },
    ]);
  });
});
