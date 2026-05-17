import { useEffect, useRef, useState } from 'react';
import { X, Send } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import {
  requestAuditChat,
  AuditChatError,
  type AuditChatMessage,
} from '../../../lib/audit/chatApi';
import { STAGE_LABELS } from '../../../lib/audit/labels';
import type { AuditStage } from '../../../types/audit';
import type { PiqcSignal, PiqcSignalKind } from '../../../hooks/usePiqcSignals';
import PiqcMark from './PiqcMark';

// =============================================================================
// AuditChatPanel (F-3) — freeform auditor chat about the active audit.
//
// Right-edge slide-over (same z-40 surface as SourceTruthListDrawer). Thread
// state is owned by the parent (AuditWorkspaceShell), keyed per audit, so
// the conversation survives drawer open/close while the auditor stays on
// the same audit. Cleared on audit switch by the parent.
//
// Doctrine reminders:
//   - Advisory only. Every reply renders with a "Drafted with AI" marker
//     so the auditor never confuses the panel for a sign-off path.
//   - Earned write-back ONLY (since PR #78). When the auditor explicitly
//     opts in via the per-turn "Use in exec summary →" / "Use in
//     conclusions →" affordances + a second-step inline confirm, PIQC
//     hands the assistant text to Stage 7 via the parent's
//     onAssistantWriteback callback. Two human checkpoints (initiate +
//     confirm) before any DB write. The auditor still reviews + saves on
//     Stage 7; existing PR #72 contract flips the provenance source to
//     'auditor_edited' on edit.
//   - Stage workspaces remain the source of truth — chat is for thinking,
//     stage workspaces are for committing.
//
// Server-side caps: thread is trimmed to MAX_LOCAL_MESSAGES turns before
// send so we don't surprise the auditor with a 400 from the edge function's
// MAX_MESSAGES guard (24). Keep one below the server cap to leave headroom.
// =============================================================================

// Server caps (see supabase/functions/audit-mode-chat/index.ts):
//   MAX_MESSAGES      = 24  → we send 22 to leave headroom
//   MAX_MESSAGE_CHARS = 2000 → mirrored here exactly
// MAX_LOCAL_HISTORY caps the in-panel view at 2x the sent slice. Without
// this, a long session accumulates turns the model never sees but the
// browser still renders — death by a thousand <li>s. The trim happens
// once per send, dropping the oldest turns past the cap.
const MAX_LOCAL_MESSAGES = 22;
const MAX_LOCAL_HISTORY  = MAX_LOCAL_MESSAGES * 2;
const MAX_INPUT_CHARS    = 2_000;

interface Props {
  auditId:  string;
  messages: AuditChatMessage[];
  /** Replace the parent-owned thread for this audit. Parent persists keyed by audit id. */
  onMessagesChange: (next: AuditChatMessage[]) => void;
  onClose: () => void;
  /** The stage the auditor is currently looking at. Forwarded to the edge
   *  function so PIQC can bias its replies. Optional; server validates and
   *  falls back to no stage bias when omitted. */
  viewedStage?: string;
  /** Ambient signals PIQC has noticed about this audit. Rendered in the
   *  empty state when present; never shown alongside thread turns (PIQC
   *  doesn't keep haranguing the auditor mid-conversation). Empty array
   *  treated the same as undefined. */
  signals?: PiqcSignal[];
  /** Callback invoked when the auditor clicks a signal's "Take me there"
   *  shortcut. The shell wires this to navigate to the right surface
   *  (open the SOTR drawer, navigate to the questionnaire stage, etc.).
   *  Optional — when omitted, signal rows render as static text without
   *  the shortcut affordance. Keeping it optional preserves backward
   *  compat for any future caller that wants to render signals without
   *  enabling navigation. */
  onSignalAction?: (kind: PiqcSignalKind) => void;
  /** Earned write-back: when the auditor confirms an assistant turn into
   *  a Stage 7 field, the shell performs the refetch + upsert (preserving
   *  the other field per PR #72's RPC contract) and routes the viewer to
   *  Stage 7. Must throw on failure so the panel can surface an error.
   *  Optional — when omitted, the per-turn write-back affordances are
   *  hidden entirely. The auditor can still copy-paste manually. */
  onAssistantWriteback?: (
    kind: 'executive_summary' | 'conclusions',
    text: string,
  ) => Promise<void>;
}

type WritebackKind = 'executive_summary' | 'conclusions';
type WritebackPending = {
  /** Index of the assistant turn the auditor opened the confirm on. Used
   *  ONLY to render the confirm block under the right bubble — not as the
   *  source of truth for what gets written. Indices can shift if the local
   *  history trim drops the head of the thread mid-confirm (a 22+ message
   *  sequence after opening). */
  turnIndex: number;
  kind: WritebackKind;
  /** Snapshot of the assistant turn's content taken at open-time. The
   *  write-back uses THIS, not messages[turnIndex], so trim or any future
   *  mid-thread mutation can't silently shift what gets written.
   *  Belt-and-suspenders alongside the turnIndex; if they diverge, the
   *  snapshot wins and the confirm UI just renders under the closest
   *  surviving turn. */
  content: string;
};

const WRITEBACK_KIND_LABELS: Record<WritebackKind, string> = {
  executive_summary: 'exec summary',
  conclusions:       'conclusions',
};

export default function AuditChatPanel({
  auditId,
  messages,
  onMessagesChange,
  onClose,
  viewedStage,
  signals,
  onSignalAction,
  onAssistantWriteback,
}: Props) {
  const panelRef     = useRef<HTMLDivElement>(null);
  const scrollerRef  = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLTextAreaElement>(null);
  // Re-entrancy guard for handleSend. `pending` state is the user-visible
  // signal, but state updates are async — two rapid Enter keydowns could
  // both pass the `!canSend` gate before React commits setPending(true).
  // A ref is the precise tool: synchronous flip, no render coupling.
  const inFlightRef  = useRef(false);
  // Same defensive pattern for the write-back confirm — rapid double-click
  // (or held Enter on the focused button) could fire onAssistantWriteback
  // twice before writebackInFlight state commits. Mirrors PR #76's
  // handleSend ref guard.
  const writebackInFlightRef = useRef(false);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const [draft, setDraft]         = useState('');
  const [pending, setPending]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  // Write-back UI state. `pending` is the auditor opening a confirm
  // affordance on a specific assistant turn × destination. `inFlight`
  // covers the async DB write so we can render a spinner + disable a
  // second click. `error` surfaces inside the confirm block so it sits
  // next to the action that produced it (not the general chat-error
  // footer — that's for thread failures).
  const [writebackPending, setWritebackPending]   = useState<WritebackPending | null>(null);
  const [writebackInFlight, setWritebackInFlight] = useState(false);
  const [writebackError, setWritebackError]       = useState<string | null>(null);

  const trimmed = draft.trim();
  const canSend = !pending && trimmed.length > 0 && trimmed.length <= MAX_INPUT_CHARS;

  // Autoscroll to the bottom whenever the thread grows or pending toggles —
  // keeps the latest turn (or the typing indicator) in view without yanking
  // focus from the input field.
  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, pending]);

  // Focus the input when the panel opens so the auditor can start typing
  // immediately — mirrors the keyboard-first behavior of the SOTR drawer's
  // search field.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = async () => {
    if (!canSend || inFlightRef.current) return;
    inFlightRef.current = true;
    setError(null);

    const userTurn: AuditChatMessage = { role: 'user', content: trimmed };
    // Compose what we'll send AND what the UI will show. They diverge only
    // when the local thread is being trimmed for performance — the SENT
    // slice always honours the server cap (MAX_LOCAL_MESSAGES); the local
    // view is also capped at MAX_LOCAL_HISTORY to keep the panel responsive
    // over long sessions. Dropped older turns are gone from both stores;
    // the model never saw them anyway (they were already past the send cap).
    const appended = [...messages, userTurn];
    const localNext = appended.length > MAX_LOCAL_HISTORY
      ? appended.slice(-MAX_LOCAL_HISTORY)
      : appended;
    const sendable = localNext.slice(-MAX_LOCAL_MESSAGES);

    onMessagesChange(localNext);
    setDraft('');
    setPending(true);

    try {
      const reply = await requestAuditChat(auditId, sendable, viewedStage);
      const withReply = [...localNext, { role: 'assistant' as const, content: reply }];
      const trimmedReply = withReply.length > MAX_LOCAL_HISTORY
        ? withReply.slice(-MAX_LOCAL_HISTORY)
        : withReply;
      onMessagesChange(trimmedReply);
    } catch (err) {
      const status =
        err instanceof AuditChatError ? err.status : 0;
      const message =
        err instanceof AuditChatError
          ? err.message
          : 'Could not reach the chat service. Try again in a moment.';
      // Surface the user turn we already optimistically rendered — don't
      // roll it back; the auditor knows what they sent. Render the error
      // as a footer, not as a fake assistant turn, so it never gets
      // confused with model output.
      setError(`${message}${status ? ` (${status})` : ''}`);
    } finally {
      inFlightRef.current = false;
      setPending(false);
    }
  };

  // Open the inline write-back confirm for a specific assistant turn +
  // destination field. Snapshots the assistant turn's content at open-time
  // so a later history trim or other mutation can't silently shift what
  // gets written. Replaces any previously-open confirm; only one confirm
  // visible at a time.
  const openWritebackConfirm = (turnIndex: number, kind: WritebackKind) => {
    const turn = messages[turnIndex];
    if (!turn || turn.role !== 'assistant') return;
    setWritebackError(null);
    setWritebackPending({ turnIndex, kind, content: turn.content });
  };

  const cancelWriteback = () => {
    if (writebackInFlightRef.current) return;
    setWritebackPending(null);
    setWritebackError(null);
  };

  // Execute the write-back. Calls the parent's onAssistantWriteback which
  // is responsible for the refetch + upsert + navigation (parent has the
  // RPC + audit context wired). On success the shell typically closes the
  // panel and routes the auditor to Stage 7. On failure we surface inside
  // the confirm block so the auditor sees the error next to the action.
  //
  // Uses writebackPending.content (snapshotted at open-time) rather than
  // messages[turnIndex] — defensive against any mid-confirm mutation that
  // could shift indices (history trim, future edit-in-place affordances).
  // Ref guard fires synchronously to prevent double-firing before the
  // writebackInFlight state commit.
  const confirmWriteback = async () => {
    if (
      !writebackPending ||
      !onAssistantWriteback ||
      writebackInFlightRef.current
    ) {
      return;
    }
    writebackInFlightRef.current = true;
    const { kind, content } = writebackPending;

    setWritebackInFlight(true);
    setWritebackError(null);
    try {
      await onAssistantWriteback(kind, content);
      // Parent owns navigation (closes panel, sets viewedStage). Reset
      // local state in case the panel re-mounts on the same audit.
      setWritebackPending(null);
    } catch (err) {
      setWritebackError(
        err instanceof Error
          ? err.message
          : 'Could not save to Stage 7. Try again, or copy the text manually.',
      );
    } finally {
      writebackInFlightRef.current = false;
      setWritebackInFlight(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a newline. Mirrors the convention
    // every modern chat surface uses; the auditor doesn't need to learn one.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const empty = messages.length === 0 && !pending;
  const turnCount = messages.length;

  return (
    <div
      data-testid="audit-chat-panel"
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="PIQC chat"
    >
      <div
        data-testid="audit-chat-panel-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className="relative w-full max-w-xl h-full bg-[#f5f7fa] dark:bg-[#0d1118] shadow-xl border-l border-[#e2e8ee] dark:border-white/5 flex flex-col"
      >
        {/* Header.
            PIQC's brand mark + name lead; the "AI · advisory" honesty chip
            stays — it's the trust signal, not the brand signal. When the
            auditor is viewing a specific stage, a soft "focused on …" chip
            renders below so PIQC's stage-awareness is visible, not just
            inferred from replies. */}
        <div className="sticky top-0 z-10 bg-[#f5f7fa]/95 dark:bg-[#0d1118]/95 backdrop-blur px-5 py-3 border-b border-[#e2e8ee] dark:border-white/5 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[#4a6fa5] dark:text-[#6e8fb5] flex-shrink-0">
                <PiqcMark size={14} />
              </span>
              <h2
                className="text-fg-heading text-sm font-semibold truncate"
                /* Pronunciation cue lives in the hover layer — "PIQC" in
                   writing is unrecoverable as "pixie" without it. Quiet and
                   professional; never appears as visible body copy. */
                title="PIQC (pronounced 'pixie')"
              >
                PIQC
              </h2>
              <span
                className="text-[10px] uppercase tracking-wider font-semibold text-fg-muted bg-[#eef2f6] dark:bg-white/[0.04] border border-[#cbd2db] dark:border-white/10 rounded px-1.5 py-0.5 flex-shrink-0"
                aria-label="AI-drafted, advisory only"
              >
                AI · advisory
              </span>
            </div>
            {/* The `as AuditStage` cast is informational: viewedStage
                originates from the shell's AuditStage state and is round-
                tripped through the edge function's VALID_VIEWED_STAGES
                allow-list. The short-circuit `&& STAGE_LABELS[...]` is
                the runtime safety net — unknown values render nothing. */}
            {viewedStage && STAGE_LABELS[viewedStage as AuditStage] && (
              <p
                data-testid="audit-chat-stage-focus"
                className="text-[11px] text-fg-muted mt-0.5 truncate"
              >
                Focused on {STAGE_LABELS[viewedStage as AuditStage]}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PIQC"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-sub hover:bg-[#e2e8ee] dark:hover:bg-white/[0.06] flex-shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div ref={scrollerRef} className="flex-1 overflow-y-auto px-5 py-4">
          {empty && (
            <div
              data-testid="audit-chat-empty"
              className="text-sm text-fg-sub leading-relaxed space-y-3"
            >
              <p className="text-fg-heading font-medium">
                Hi — I've been reading along.
              </p>

              {/* Ambient signals — when PIQC has noticed something specific,
                  it leads with that before the generic primer. The auditor
                  came here because the dock's dot caught their eye; landing
                  on the signal answers "what did you notice?" within one
                  read. Amber accent mirrors the dot — same color = same
                  affordance, no new vocabulary.
                  Voice: first-person partner ("Worth a look:") rather than
                  third-person system ("PIQC noticed:") — keeps the empty
                  state's tonal register consistent ("Hi — I've been reading
                  along" / "I can recall from…" / "I'm advisory only").
                  Each signal renders with a "Take me there →" shortcut when
                  onSignalAction is wired, so the auditor goes from
                  awareness → action in one click instead of five. */}
              {signals && signals.length > 0 && (
                <div
                  data-testid="audit-chat-signals"
                  className="rounded-md border border-amber-300/60 dark:border-amber-500/30 bg-amber-50/70 dark:bg-amber-500/[0.06] px-3 py-2.5"
                >
                  <p className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1.5">
                    Worth a look:
                  </p>
                  <ul className="space-y-1.5 text-xs text-amber-900/90 dark:text-amber-100/90">
                    {signals.map((s) => (
                      <li
                        key={s.kind}
                        data-testid={`audit-chat-signal-${s.kind}`}
                        className="flex items-start gap-2"
                      >
                        <span className="flex-1 min-w-0">
                          {s.label}
                          {/* Thematic hint (v2 / PR after #80) — a quieter
                              sub-line surfaces when one cluster dominates
                              the underlying rows. Reads as "PIQC noticed a
                              pattern" rather than "PIQC counted." Skipped
                              by the hook when no theme is decisive (see
                              buildThemeHint in usePiqcSignals.ts). */}
                          {s.themeHint && (
                            <span
                              data-testid={`audit-chat-signal-hint-${s.kind}`}
                              className="block text-[11px] mt-0.5 text-amber-800/75 dark:text-amber-200/75"
                            >
                              {s.themeHint}
                            </span>
                          )}
                        </span>
                        {onSignalAction && (
                          <button
                            type="button"
                            onClick={() => onSignalAction(s.kind)}
                            data-testid={`audit-chat-signal-action-${s.kind}`}
                            className="flex-shrink-0 text-[11px] font-medium text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100 underline underline-offset-2 decoration-amber-400/50 hover:decoration-amber-500"
                            aria-label={`Take me to ${s.label}`}
                          >
                            Take me there →
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p>
                Ask me anything about this audit. I can recall from:
              </p>
              <ul className="list-disc pl-5 space-y-0.5 text-xs">
                <li>the approved vendor questionnaire</li>
                <li>protocol items you've reviewed in the parsed source list</li>
                <li>your approved risk summary and any workspace findings</li>
                <li>any report draft you've started</li>
              </ul>
              <p>
                Use me to spot gaps, restate findings in different words, or
                sanity-check your reasoning before you commit a change.
              </p>
              <p className="text-xs text-fg-muted">
                I'm advisory only — you stay the decision-maker. Nothing I say
                writes back to the audit.
              </p>
            </div>
          )}

          {messages.length > 0 && (
            <ul className="space-y-3" data-testid="audit-chat-thread">
              {messages.map((m, i) => {
                const isAssistant = m.role === 'assistant';
                const writebackOpen =
                  writebackPending !== null && writebackPending.turnIndex === i;
                return (
                  <li
                    key={i}
                    data-testid={m.role === 'user' ? 'audit-chat-user-turn' : 'audit-chat-assistant-turn'}
                    className={
                      m.role === 'user'
                        ? 'flex flex-col items-end'
                        : 'flex flex-col items-start'
                    }
                  >
                    <div
                      className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-[#4a6fa5] text-white'
                          : 'bg-white dark:bg-white/[0.04] border border-[#e2e8ee] dark:border-white/10 text-fg-heading'
                      }`}
                    >
                      {m.content}
                    </div>

                    {/* Earned write-back affordance — assistant turns only.
                        Two subtle buttons, one per destination field.
                        Hidden when onAssistantWriteback is unwired (caller
                        opted out). Hidden while the confirm for THIS turn
                        is open (replaced by the confirm block below). */}
                    {isAssistant && onAssistantWriteback && !writebackOpen && (
                      <div
                        data-testid={`audit-chat-writeback-row-${i}`}
                        className="mt-1 flex flex-wrap gap-3 text-[11px] text-fg-sub"
                      >
                        <button
                          type="button"
                          onClick={() => openWritebackConfirm(i, 'executive_summary')}
                          data-testid={`audit-chat-writeback-open-exec-${i}`}
                          className="font-medium underline underline-offset-2 decoration-[#4a6fa5]/40 hover:decoration-[#4a6fa5] hover:text-fg-heading"
                          aria-label="Use this PIQC reply as your executive summary draft"
                        >
                          Use in exec summary →
                        </button>
                        <button
                          type="button"
                          onClick={() => openWritebackConfirm(i, 'conclusions')}
                          data-testid={`audit-chat-writeback-open-conclusions-${i}`}
                          className="font-medium underline underline-offset-2 decoration-[#4a6fa5]/40 hover:decoration-[#4a6fa5] hover:text-fg-heading"
                          aria-label="Use this PIQC reply as your conclusions draft"
                        >
                          Use in conclusions →
                        </button>
                      </div>
                    )}

                    {/* Inline confirm block — only renders when this turn ×
                        destination is selected. Sits beneath the assistant
                        bubble so the auditor sees what they're sending and
                        where it's going in the same visual unit. */}
                    {isAssistant && writebackOpen && writebackPending && (
                      <div
                        data-testid={`audit-chat-writeback-confirm-${i}`}
                        className="mt-2 max-w-[85%] rounded-md border border-[#4a6fa5]/30 dark:border-[#4a6fa5]/40 bg-[#eef2f6] dark:bg-white/[0.04] px-3 py-2.5 text-xs text-fg-heading"
                      >
                        <p className="font-semibold mb-1">
                          Drop this into your {WRITEBACK_KIND_LABELS[writebackPending.kind]} draft?
                        </p>
                        <p className="text-fg-sub leading-relaxed mb-2">
                          I'll replace your current text. You'll review it on Stage 7 before saving.
                        </p>
                        {writebackError && (
                          <p
                            data-testid={`audit-chat-writeback-error-${i}`}
                            className="text-amber-800 dark:text-amber-300 mb-2"
                            role="alert"
                          >
                            {writebackError}
                          </p>
                        )}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={cancelWriteback}
                            disabled={writebackInFlight}
                            data-testid={`audit-chat-writeback-cancel-${i}`}
                            className="text-[11px] font-medium text-fg-sub hover:text-fg-heading disabled:opacity-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={confirmWriteback}
                            disabled={writebackInFlight}
                            data-testid={`audit-chat-writeback-confirm-action-${i}`}
                            className="text-[11px] font-semibold px-2.5 py-1 rounded-md bg-[#4a6fa5] text-white hover:bg-[#3f5f8e] disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {writebackInFlight ? 'Saving…' : 'Replace and review →'}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
              {pending && (
                <li className="flex justify-start" data-testid="audit-chat-pending">
                  <div className="bg-white dark:bg-white/[0.04] border border-[#e2e8ee] dark:border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-fg-sub italic">
                    Thinking…
                  </div>
                </li>
              )}
            </ul>
          )}
        </div>

        {/* Error footer — separated from the message list so it can't be
            mistaken for a model reply. */}
        {error && (
          <div
            data-testid="audit-chat-error"
            className="border-t border-amber-300/60 dark:border-amber-500/30 bg-amber-50 dark:bg-amber-500/[0.08] text-amber-800 dark:text-amber-200 text-xs px-5 py-2"
            role="alert"
          >
            {error}
          </div>
        )}

        {/* Input */}
        <div className="border-t border-[#e2e8ee] dark:border-white/5 bg-[#f5f7fa] dark:bg-[#0d1118] px-5 py-3">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, MAX_INPUT_CHARS))}
              onKeyDown={handleKeyDown}
              placeholder="Ask about findings, risk posture, or what's missing…"
              rows={2}
              disabled={pending}
              aria-label="Message PIQC"
              data-testid="audit-chat-input"
              className="flex-1 resize-none rounded-md border border-[#dce4ed] dark:border-white/10 bg-white dark:bg-[#131a22] text-sm text-fg-heading placeholder:text-fg-muted px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#4a6fa5]/30 disabled:opacity-60"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
              data-testid="audit-chat-send"
              className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-[#4a6fa5] text-white hover:bg-[#3f5f8e] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex-shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
          <p className="mt-1.5 text-[10px] text-fg-muted">
            Enter to send · Shift+Enter for newline · {turnCount} turn{turnCount === 1 ? '' : 's'} in this thread
          </p>
        </div>
      </div>
    </div>
  );
}
