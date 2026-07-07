import { useState } from 'react';
import {
  ClipboardList,
  FileText,
  GitCompareArrows,
  MessageCircleQuestion,
  ShieldCheck,
  SquarePen,
  Target,
  X,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import DashboardChat from '../../DashboardChat';
import { useSponsorAskThread } from './useSponsorAskThread';

// =============================================================================
// SponsorAskPanel — the Sponsor surface's "Ask" (Protocol Intelligence tab).
//
// CRITICAL scope note (plan sponsor-ask): this is the PROTOCOL-GROUNDED Ask —
// the shared DashboardChat in its protocolId mode, where the dashboard-chat
// edge fn scopes retrieval to the selected protocol's parsed documents and
// answers with section/page citations (the AskTab.tsx:169 pattern). It is NOT
// the org-tab chat (Dashboard.tsx `case 'chat'`), which has no protocol scope.
// If protocolId ever comes off the DashboardChat below, it's the wrong Ask.
//
// Shape: an inline collapsible card at the end of the tab's selected-protocol
// column. Collapsed = a one-row invitation ("Ask about this protocol").
// Expanded = a bounded-height chat. Inline (not a floating bubble like Site's)
// because it lives inside the Fable-owned tab: no shell mount, no z-index
// contest with drawers, and it reads as "ask about what you're looking at".
//
// Thread state: useSponsorAskThread — per-protocol, session-persisted,
// stale-stream-safe. The chat is keyed by `${protocol.id}:${epoch}` (the
// AskBubble trick): a protocol switch or "New chat" remounts DashboardChat, so
// abortOnUnmount kills any in-flight stream instead of letting it write into
// the next thread (the hook's bound setter would drop those tokens anyway —
// the remount also resets the chat's local input/streaming UI).
//
// No document-count gate: Site's AskTab gates on useSiteData().documents, a
// SITE context this surface must not import (context isolation). When the
// protocol has no parsed documents the edge fn answers with its explicit
// "documents don't cover this" rule — honest, and no cross-mode coupling.
//
// Draft-only vocabulary: answers are grounded readings of the protocol, and
// the panel says so; nothing here is "approved".
// =============================================================================

interface SponsorAskPanelProps {
  protocol: { id: string; code: string; name: string };
}

/** Sponsor-register starter prompts — oversight questions over the parsed
 *  protocol (structurally ChatSuggestion[]: {icon, text}). */
const SPONSOR_SUGGESTIONS = [
  { icon: FileText, text: 'Summarize this protocol' },
  { icon: Target, text: 'What are the primary endpoints?' },
  { icon: ShieldCheck, text: 'What are the key eligibility criteria?' },
  { icon: ClipboardList, text: 'Which visits have the tightest scheduling windows?' },
  { icon: GitCompareArrows, text: 'What changed in the latest amendment?' },
];

export default function SponsorAskPanel({ protocol }: SponsorAskPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [open, setOpen] = useState(false);
  // Bumped by "New chat" so the keyed DashboardChat remounts (aborting any
  // in-flight stream) in the same gesture that clears the thread.
  const [epoch, setEpoch] = useState(0);

  const [messages, setMessages, clearThread] = useSponsorAskThread(protocol.id);

  const handleNewChat = () => {
    clearThread();
    setEpoch((e) => e + 1);
  };

  const cardChrome = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const accentFg = isLight ? '#534AB7' : '#7F77DD';

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="sponsor-ask-open"
        aria-expanded={false}
        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${cardChrome} ${
          isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.03]'
        }`}
      >
        <span
          className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)',
            color: accentFg,
          }}
        >
          <MessageCircleQuestion size={16} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-fg-heading text-sm font-semibold">
            Ask about this protocol
          </span>
          <span className="block text-fg-sub text-xs mt-0.5 truncate">
            Answers grounded in {protocol.code}&apos;s parsed documents, with citations.
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="sponsor-ask-panel"
      className={`rounded-xl border overflow-hidden flex flex-col ${cardChrome}`}
    >
      {/* Header row: title + new-chat + collapse */}
      <div
        className={`flex-shrink-0 flex items-center gap-2 px-4 py-2.5 border-b ${
          isLight ? 'border-[#F2F2F2]' : 'border-white/[0.06]'
        }`}
      >
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)',
            color: accentFg,
          }}
        >
          <MessageCircleQuestion size={13} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-fg-heading leading-tight truncate">
            Ask about this protocol
          </p>
          <p className="text-fg-muted text-[11px] leading-tight truncate">
            {protocol.code} · grounded in the parsed protocol
          </p>
        </div>
        <button
          type="button"
          onClick={handleNewChat}
          disabled={messages.length === 0}
          aria-label="Start new chat"
          title="New chat"
          data-testid="sponsor-ask-new-chat"
          className={`flex-shrink-0 p-1.5 rounded-md transition-colors text-fg-sub disabled:opacity-30 disabled:cursor-not-allowed ${
            isLight ? 'hover:bg-[#0F172A]/[0.04]' : 'hover:bg-white/[0.05]'
          }`}
        >
          <SquarePen size={15} />
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Ask panel"
          title="Collapse"
          data-testid="sponsor-ask-close"
          className={`flex-shrink-0 p-1.5 rounded-md transition-colors text-fg-sub ${
            isLight ? 'hover:bg-[#0F172A]/[0.04]' : 'hover:bg-white/[0.05]'
          }`}
        >
          <X size={15} />
        </button>
      </div>

      {/* Bounded-height chat body. Keyed remount on protocol switch / new chat
          so abortOnUnmount stops an in-flight stream (see header comment). */}
      <div className="h-[520px] min-h-0">
        <DashboardChat
          key={`${protocol.id}:${epoch}`}
          messages={messages}
          setMessages={setMessages}
          protocolId={protocol.id}
          abortOnUnmount
          customSuggestions={SPONSOR_SUGGESTIONS}
          emptyHeading={`Ask about ${protocol.code}`}
          emptySubtext={`Answers come from ${protocol.code}'s parsed protocol documents, with section and page citations. Pick a starter or ask anything.`}
          hideHeader
        />
      </div>
    </div>
  );
}
