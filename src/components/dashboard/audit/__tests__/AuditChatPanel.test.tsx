// Unit tests for AuditChatPanel (F-3) — auditor-facing chat surface.
//
// The panel is a controlled component: thread state lives in the parent
// (AuditWorkspaceShell). These tests assert the user-visible contract,
// not the parent integration:
//
//   - empty state renders advisory framing
//   - send invokes requestAuditChat with the thread tail
//   - happy path: parent's onMessagesChange is called twice — once
//     optimistically with the user turn, once again with the assistant reply
//   - failure path: user turn is NOT rolled back; an error footer renders
//     instead of a fake assistant turn (the auditor must always know what
//     came from the model vs the platform)
//   - Enter submits, Shift+Enter inserts a newline
//   - thread trim contract: long threads are truncated to the server cap
//     before send; the local view keeps everything
//
// Mock surface: only chatApi. The panel's local state, focus, scroll, and
// keyboard handlers are exercised through RTL.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AuditChatPanel from '../AuditChatPanel';
import type { AuditChatMessage } from '../../../../lib/audit/chatApi';

vi.mock('../../../../lib/audit/chatApi', async () => {
  const actual = await vi.importActual<typeof import('../../../../lib/audit/chatApi')>(
    '../../../../lib/audit/chatApi',
  );
  return {
    ...actual,
    requestAuditChat: vi.fn(),
  };
});

import { requestAuditChat, AuditChatError } from '../../../../lib/audit/chatApi';
const mockChat = requestAuditChat as unknown as ReturnType<typeof vi.fn>;

function setup(
  initial: AuditChatMessage[] = [],
  viewedStage?: string,
  signals?: import('../../../../hooks/usePiqcSignals').PiqcSignal[],
  onSignalAction?: (kind: import('../../../../hooks/usePiqcSignals').PiqcSignalKind) => void,
  onAssistantWriteback?: (
    kind: 'executive_summary' | 'conclusions',
    text: string,
  ) => Promise<void>,
) {
  const onMessagesChange = vi.fn();
  const onClose = vi.fn();
  let messages = initial;
  const Wrapper = () => (
    <AuditChatPanel
      auditId="audit-1"
      messages={messages}
      onMessagesChange={(next) => {
        messages = next;
        onMessagesChange(next);
      }}
      onClose={onClose}
      viewedStage={viewedStage}
      signals={signals}
      onSignalAction={onSignalAction}
      onAssistantWriteback={onAssistantWriteback}
    />
  );
  const utils = render(<Wrapper />);
  return { ...utils, onMessagesChange, onClose, getMessages: () => messages };
}

beforeEach(() => {
  mockChat.mockReset();
});

describe('AuditChatPanel — empty state', () => {
  it('renders the advisory framing when no messages exist', () => {
    setup([]);
    expect(screen.getByTestId('audit-chat-empty')).toBeInTheDocument();
    // The "AI · advisory" chip is the central honesty signal. If this
    // disappears the auditor might mistake replies for sign-off output.
    expect(screen.getByLabelText('AI-drafted, advisory only')).toBeInTheDocument();
  });

  it('disables send when the input is empty', () => {
    setup([]);
    const send = screen.getByTestId('audit-chat-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
  });
});

describe('AuditChatPanel — sending a turn', () => {
  it('appends user turn optimistically, then appends assistant reply on success', async () => {
    mockChat.mockResolvedValueOnce('Counts look light for a Stage 6 closeout.');
    const user = userEvent.setup();
    const { onMessagesChange, getMessages } = setup([]);

    await user.type(screen.getByTestId('audit-chat-input'), 'Did I miss anything?');
    await user.click(screen.getByTestId('audit-chat-send'));

    // Two updates: optimistic user turn, then user+assistant.
    await waitFor(() => expect(onMessagesChange).toHaveBeenCalledTimes(2));

    const firstCall = onMessagesChange.mock.calls[0][0];
    expect(firstCall).toEqual([
      { role: 'user', content: 'Did I miss anything?' },
    ]);
    const secondCall = onMessagesChange.mock.calls[1][0];
    expect(secondCall).toEqual([
      { role: 'user', content: 'Did I miss anything?' },
      { role: 'assistant', content: 'Counts look light for a Stage 6 closeout.' },
    ]);
    // chatApi receives the thread tail, not the empty starting state.
    expect(mockChat).toHaveBeenCalledWith('audit-1', [
      { role: 'user', content: 'Did I miss anything?' },
    ]);
    expect(getMessages()).toHaveLength(2);
  });

  it('Enter submits; Shift+Enter inserts a newline', async () => {
    mockChat.mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    setup([]);

    const input = screen.getByTestId('audit-chat-input') as HTMLTextAreaElement;
    await user.click(input);
    await user.keyboard('first line{Shift>}{Enter}{/Shift}second line');
    expect(input.value).toBe('first line\nsecond line');
    expect(mockChat).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1));
    expect(mockChat.mock.calls[0][1]).toEqual([
      { role: 'user', content: 'first line\nsecond line' },
    ]);
  });

  it('clears the draft after a successful send', async () => {
    mockChat.mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    setup([]);

    const input = screen.getByTestId('audit-chat-input') as HTMLTextAreaElement;
    await user.type(input, 'hello');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() => expect(input.value).toBe(''));
  });
});

describe('AuditChatPanel — error handling', () => {
  it('renders the error footer on AuditChatError and does NOT roll back the user turn', async () => {
    mockChat.mockRejectedValueOnce(new AuditChatError('Rate limit exceeded', 429));
    const user = userEvent.setup();
    const { onMessagesChange } = setup([]);

    await user.type(screen.getByTestId('audit-chat-input'), 'q');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() =>
      expect(screen.getByTestId('audit-chat-error')).toHaveTextContent('Rate limit exceeded (429)'),
    );
    // Optimistic user turn was kept — only one onMessagesChange call total.
    expect(onMessagesChange).toHaveBeenCalledTimes(1);
    expect(onMessagesChange.mock.calls[0][0]).toEqual([
      { role: 'user', content: 'q' },
    ]);
    // The user turn renders, but NO assistant turn is invented.
    expect(screen.getByTestId('audit-chat-user-turn')).toHaveTextContent('q');
    expect(screen.queryByTestId('audit-chat-assistant-turn')).not.toBeInTheDocument();
  });

  it('renders a generic error message for non-AuditChatError failures', async () => {
    mockChat.mockRejectedValueOnce(new Error('network died'));
    const user = userEvent.setup();
    setup([]);

    await user.type(screen.getByTestId('audit-chat-input'), 'q');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() =>
      expect(screen.getByTestId('audit-chat-error')).toHaveTextContent(
        'Could not reach the chat service. Try again in a moment.',
      ),
    );
  });
});

describe('AuditChatPanel — thread trim contract', () => {
  it('trims the sent thread to the server cap while keeping the local view intact', async () => {
    mockChat.mockResolvedValueOnce('ok');
    const user = userEvent.setup();

    // 22 prior turns + 1 new user turn = 23 local; the wrapper trims to the
    // last 22 (MAX_LOCAL_MESSAGES) when sending. The new turn is always
    // included (it's the last entry), and the very first old turn is dropped.
    const prior: AuditChatMessage[] = Array.from({ length: 22 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `t${i}`,
    }));
    setup(prior);

    await user.type(screen.getByTestId('audit-chat-input'), 'NEW');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1));
    const sent = mockChat.mock.calls[0][1] as AuditChatMessage[];
    expect(sent).toHaveLength(22);
    // First old turn dropped, new turn at the tail.
    expect(sent[0]).toEqual({ role: 'assistant', content: 't1' });
    expect(sent[sent.length - 1]).toEqual({ role: 'user', content: 'NEW' });
  });
});

describe('AuditChatPanel — viewedStage prop forwarding', () => {
  it('passes viewedStage through to requestAuditChat when provided', async () => {
    mockChat.mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    setup([], 'AUDIT_CONDUCT');

    await user.type(screen.getByTestId('audit-chat-input'), 'q');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1));
    expect(mockChat.mock.calls[0][2]).toBe('AUDIT_CONDUCT');
  });

  it('passes undefined when viewedStage is omitted (no stage bias)', async () => {
    mockChat.mockResolvedValueOnce('ok');
    const user = userEvent.setup();
    setup([]);

    await user.type(screen.getByTestId('audit-chat-input'), 'q');
    await user.click(screen.getByTestId('audit-chat-send'));

    await waitFor(() => expect(mockChat).toHaveBeenCalledTimes(1));
    expect(mockChat.mock.calls[0][2]).toBeUndefined();
  });
});

describe('AuditChatPanel — ambient signals in empty state', () => {
  it('does not render the signals block when none are present', () => {
    setup([]);
    expect(screen.queryByTestId('audit-chat-signals')).not.toBeInTheDocument();
  });

  it('renders "Worth a look:" with one line per signal (first-person partner voice)', () => {
    setup([], undefined, [
      { kind: 'sotr_awaiting_review',    count: 3, label: '3 parsed protocol items awaiting your review' },
      { kind: 'questionnaire_flagged',   count: 1, label: '1 questionnaire response you flagged as inconsistent' },
    ]);
    const block = screen.getByTestId('audit-chat-signals');
    // "Worth a look:" — first-person partner voice, consistent with the
    // empty-state primer's "Hi — I've been reading along" register.
    // Locking the copy so a future drift back to third-person ("PIQC
    // noticed:") would fail this test loudly.
    expect(block).toHaveTextContent(/Worth a look:/i);
    expect(block).not.toHaveTextContent(/PIQC noticed:/i);
    expect(screen.getByTestId('audit-chat-signal-sotr_awaiting_review'))
      .toHaveTextContent('3 parsed protocol items awaiting your review');
    expect(screen.getByTestId('audit-chat-signal-questionnaire_flagged'))
      .toHaveTextContent('1 questionnaire response you flagged as inconsistent');
  });

  it('renders a "Take me there →" affordance per signal when onSignalAction is wired', () => {
    setup(
      [],
      undefined,
      [
        { kind: 'sotr_awaiting_review',  count: 2, label: '2 items awaiting your review' },
        { kind: 'questionnaire_flagged', count: 1, label: '1 flagged response' },
      ],
      vi.fn(),
    );
    expect(screen.getByTestId('audit-chat-signal-action-sotr_awaiting_review'))
      .toBeInTheDocument();
    expect(screen.getByTestId('audit-chat-signal-action-questionnaire_flagged'))
      .toBeInTheDocument();
  });

  it('omits the action affordance when onSignalAction is not provided', () => {
    setup([], undefined, [
      { kind: 'sotr_awaiting_review', count: 2, label: '2 items awaiting your review' },
    ]);
    // Static text still renders; the shortcut just doesn't. Defensive default
    // for any future caller that wants to render signals without enabling
    // navigation.
    expect(screen.getByTestId('audit-chat-signal-sotr_awaiting_review'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('audit-chat-signal-action-sotr_awaiting_review'))
      .not.toBeInTheDocument();
  });

  it('calls onSignalAction with the clicked signal kind', async () => {
    const onSignalAction = vi.fn();
    const user = userEvent.setup();
    setup(
      [],
      undefined,
      [
        { kind: 'sotr_awaiting_review',  count: 2, label: '2 items awaiting your review' },
        { kind: 'questionnaire_flagged', count: 1, label: '1 flagged response' },
      ],
      onSignalAction,
    );

    await user.click(screen.getByTestId('audit-chat-signal-action-questionnaire_flagged'));
    expect(onSignalAction).toHaveBeenCalledWith('questionnaire_flagged');

    await user.click(screen.getByTestId('audit-chat-signal-action-sotr_awaiting_review'));
    expect(onSignalAction).toHaveBeenCalledWith('sotr_awaiting_review');
    expect(onSignalAction).toHaveBeenCalledTimes(2);
  });

  it('renders themeHint as a quieter sub-line under the signal label (v2)', () => {
    setup([], undefined, [
      {
        kind:      'sotr_awaiting_review',
        count:     3,
        label:     '3 parsed protocol items awaiting your review',
        themeHint: '— 2 are about visit schedule',
      },
    ]);
    // The hint shares the signal row but renders as a separate testid so
    // future style changes can target it without touching the label.
    const hint = screen.getByTestId('audit-chat-signal-hint-sotr_awaiting_review');
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent('— 2 are about visit schedule');
    // And the original label still reads — the hint adds, doesn't replace.
    expect(screen.getByTestId('audit-chat-signal-sotr_awaiting_review'))
      .toHaveTextContent('3 parsed protocol items awaiting your review');
  });

  it('omits the hint element entirely when themeHint is absent (no empty sub-line)', () => {
    setup([], undefined, [
      {
        kind:  'questionnaire_flagged',
        count: 1,
        label: '1 questionnaire response you flagged as inconsistent',
        // no themeHint
      },
    ]);
    expect(screen.queryByTestId('audit-chat-signal-hint-questionnaire_flagged'))
      .not.toBeInTheDocument();
  });

  it('renders "Ask about these →" only when the signal has a topTheme + buildable prompt', () => {
    setup([], undefined, [
      // Has topTheme → button renders
      {
        kind:      'sotr_awaiting_review',
        count:     3,
        label:     '3 parsed protocol items awaiting your review',
        themeHint: '— 2 are about visit schedule',
        topTheme:  { label: 'visit schedule', count: 2 },
      },
      // No topTheme → no cluster prompt affordance, even if a hint
      // somehow existed (defensive — the hook keeps them in lockstep
      // but the panel doesn't assume).
      {
        kind:      'questionnaire_flagged',
        count:     1,
        label:     '1 questionnaire response you flagged as inconsistent',
        // no themeHint, no topTheme
      },
    ]);
    expect(screen.getByTestId('audit-chat-signal-cluster-prompt-sotr_awaiting_review'))
      .toBeInTheDocument();
    expect(screen.queryByTestId('audit-chat-signal-cluster-prompt-questionnaire_flagged'))
      .not.toBeInTheDocument();
  });

  it('clicking "Ask about these →" pre-seeds the composer + focuses input (two checkpoints, no auto-send)', async () => {
    const user = userEvent.setup();
    setup([], undefined, [
      {
        kind:      'sotr_awaiting_review',
        count:     3,
        label:     '3 parsed protocol items awaiting your review',
        themeHint: '— 2 are about visit schedule',
        topTheme:  { label: 'visit schedule', count: 2 },
      },
    ]);

    await user.click(screen.getByTestId('audit-chat-signal-cluster-prompt-sotr_awaiting_review'));

    // Draft is pre-filled — auditor sees the question, can edit, then
    // clicks Send. Locked auditor-voice phrasing.
    const input = screen.getByTestId('audit-chat-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Tell me about the 2 visit schedule items awaiting my review.');
    // Focus moves to the input — the auditor's hand naturally goes to
    // edit/send.
    expect(document.activeElement).toBe(input);
    // No premature send — chatApi was not called. The mock would record
    // any call.
    expect(mockChat).not.toHaveBeenCalled();
  });

  it('has an accessible aria-label naming the cluster (not just generic "Ask")', () => {
    setup([], undefined, [
      {
        kind:      'questionnaire_flagged',
        count:     3,
        label:     '3 questionnaire responses you flagged as inconsistent',
        themeHint: '— 2 are about Vendor oversight',
        topTheme:  { label: 'Vendor oversight', count: 2 },
      },
    ]);
    expect(screen.getByLabelText(/Ask PIQC about the Vendor oversight items/i))
      .toBeInTheDocument();
  });

  it('hides the signals block once the thread is non-empty (PIQC stops haranguing mid-conversation)', () => {
    setup(
      [{ role: 'user', content: 'q' }],
      undefined,
      [{ kind: 'sotr_awaiting_review', count: 2, label: '2 items awaiting your review' }],
    );
    // The empty-state primer (and its signals) only renders when messages.length === 0.
    // Once the auditor starts a conversation, PIQC respects the thread and
    // doesn't keep re-surfacing what the dot already conveyed.
    expect(screen.queryByTestId('audit-chat-signals')).not.toBeInTheDocument();
  });
});

describe('AuditChatPanel — stage focus chip (visible PIQC presence signal)', () => {
  it('renders "Focused on …" when viewedStage is a valid AuditStage', () => {
    setup([], 'AUDIT_CONDUCT');
    const chip = screen.getByTestId('audit-chat-stage-focus');
    // Uses STAGE_LABELS so the chip reads as "Focused on Audit Conduct",
    // not the raw enum value. Locking the label-via-helper contract here
    // so a future renaming of stage labels doesn't silently drift.
    expect(chip).toHaveTextContent(/Focused on /i);
    expect(chip).not.toHaveTextContent('AUDIT_CONDUCT');
  });

  it('hides the chip when viewedStage is omitted', () => {
    setup([]);
    expect(screen.queryByTestId('audit-chat-stage-focus')).not.toBeInTheDocument();
  });
});

describe('AuditChatPanel — earned write-back to Stage 7', () => {
  const assistantTurn: AuditChatMessage = {
    role: 'assistant',
    content: 'Suggested executive summary: the vendor demonstrated strong validation evidence…',
  };
  const userTurn: AuditChatMessage = { role: 'user', content: 'Draft an exec summary' };

  it('hides write-back affordances entirely when onAssistantWriteback is not wired', () => {
    setup([userTurn, assistantTurn]);
    expect(screen.queryByTestId('audit-chat-writeback-row-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audit-chat-writeback-open-exec-1')).not.toBeInTheDocument();
  });

  it('renders affordance row on assistant turns only — never on user turns', () => {
    setup([userTurn, assistantTurn], undefined, undefined, undefined, vi.fn());
    // User turn (index 0) → no affordance.
    expect(screen.queryByTestId('audit-chat-writeback-row-0')).not.toBeInTheDocument();
    // Assistant turn (index 1) → both destination buttons.
    expect(screen.getByTestId('audit-chat-writeback-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('audit-chat-writeback-open-exec-1')).toBeInTheDocument();
    expect(screen.getByTestId('audit-chat-writeback-open-conclusions-1')).toBeInTheDocument();
  });

  it('opens the inline confirm when an affordance is clicked', async () => {
    const user = userEvent.setup();
    setup([userTurn, assistantTurn], undefined, undefined, undefined, vi.fn());

    await user.click(screen.getByTestId('audit-chat-writeback-open-exec-1'));

    // Confirm block visible; affordance row collapses.
    expect(screen.getByTestId('audit-chat-writeback-confirm-1')).toBeInTheDocument();
    expect(screen.queryByTestId('audit-chat-writeback-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-chat-writeback-confirm-1'))
      // Confirm copy is first-person partner voice ("Drop this into…" + "I'll
      // replace…") — consistent with the empty-state primer's "Hi — I've been
      // reading along" register. Locking the copy so a future drift back to
      // third-person system voice ("PIQC will replace…") fails this test.
      .toHaveTextContent(/Drop this into your exec summary draft\?/i);
  });

  it('Cancel restores the affordance row without invoking the callback', async () => {
    const onWriteback = vi.fn();
    const user = userEvent.setup();
    setup([userTurn, assistantTurn], undefined, undefined, undefined, onWriteback);

    await user.click(screen.getByTestId('audit-chat-writeback-open-conclusions-1'));
    expect(screen.getByTestId('audit-chat-writeback-confirm-1')).toBeInTheDocument();

    await user.click(screen.getByTestId('audit-chat-writeback-cancel-1'));
    // Confirm hidden; affordance back; callback never fired.
    expect(screen.queryByTestId('audit-chat-writeback-confirm-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('audit-chat-writeback-row-1')).toBeInTheDocument();
    expect(onWriteback).not.toHaveBeenCalled();
  });

  it('confirm invokes onAssistantWriteback with the chosen kind + the assistant text', async () => {
    const onWriteback = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup([userTurn, assistantTurn], undefined, undefined, undefined, onWriteback);

    await user.click(screen.getByTestId('audit-chat-writeback-open-exec-1'));
    await user.click(screen.getByTestId('audit-chat-writeback-confirm-action-1'));

    await waitFor(() => expect(onWriteback).toHaveBeenCalledTimes(1));
    expect(onWriteback).toHaveBeenCalledWith('executive_summary', assistantTurn.content);
  });

  it('routes to the conclusions destination when the conclusions affordance was chosen', async () => {
    const onWriteback = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    setup([userTurn, assistantTurn], undefined, undefined, undefined, onWriteback);

    await user.click(screen.getByTestId('audit-chat-writeback-open-conclusions-1'));
    await user.click(screen.getByTestId('audit-chat-writeback-confirm-action-1'));

    await waitFor(() => expect(onWriteback).toHaveBeenCalledTimes(1));
    expect(onWriteback).toHaveBeenCalledWith('conclusions', assistantTurn.content);
  });

  it('surfaces a writeback error inside the confirm block without losing the auditor state', async () => {
    const onWriteback = vi.fn().mockRejectedValue(new Error('Refetch returned null'));
    const user = userEvent.setup();
    setup([userTurn, assistantTurn], undefined, undefined, undefined, onWriteback);

    await user.click(screen.getByTestId('audit-chat-writeback-open-exec-1'));
    await user.click(screen.getByTestId('audit-chat-writeback-confirm-action-1'));

    await waitFor(() =>
      expect(screen.getByTestId('audit-chat-writeback-error-1'))
        .toHaveTextContent('Refetch returned null'),
    );
    // Confirm block stays open so the auditor can retry or cancel.
    expect(screen.getByTestId('audit-chat-writeback-confirm-1')).toBeInTheDocument();
  });
});

describe('AuditChatPanel — close affordance', () => {
  it('invokes onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const { onClose } = setup([]);
    await user.click(screen.getByLabelText('Close PIQC'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
