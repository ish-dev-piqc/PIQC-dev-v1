import { useEffect, useState } from 'react';
import { MessageSquare, X, Sparkles } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useAskThread } from '../../../lib/site/useAskThread';
import AskTab from './AskTab';

// =============================================================================
// AskBubble — the Site Mode "Ask" assistant as a floating bubble anchored to
// the bottom-right of the dashboard. Replaces the earlier docked AskRail.
//
// Per Ishika's feedback (2026-06-03):
//   - Should be a bubble, not a rail (familiar Intercom/HubSpot pattern)
//   - Tall — should use most of the available vertical space
//   - Inside Ask, the chat surface should dominate over chrome + suggestions
//
// States:
//   collapsed → 56px circular FAB in the bottom-right corner
//   expanded  → 420px-wide × min(720px, 80vh) tall floating panel,
//                anchored to the bottom-right, above dashboard content
//
// Open/closed state and the conversation itself persist in-session
// (sessionStorage), and the thread is scoped per active protocol via
// useAskThread.
// =============================================================================

const OPEN_KEY = 'piq-site-ask-open-v1';

function loadOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveOpen(open: boolean): void {
  try {
    sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
  } catch {
    // ignore — degrade to default-collapsed on next load
  }
}

export default function AskBubble() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  const [open, setOpen] = useState<boolean>(() => loadOpen());
  const [messages, setMessages] = useAskThread(activeProtocol?.id ?? null);

  useEffect(() => {
    saveOpen(open);
  }, [open]);

  // ---------------------------------------------------------------------------
  // Collapsed — circular FAB. Sits below z-50 drawers/modals so it doesn't
  // overlap the participant / visit detail drawers when those are open.
  // ---------------------------------------------------------------------------
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open Ask assistant"
        title="Ask"
        data-testid="ask-bubble-open"
        className={`fixed bottom-6 right-6 z-40 inline-flex items-center justify-center w-14 h-14 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 ${
          isLight
            ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-brand-600/30'
            : 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-black/40'
        }`}
      >
        <MessageSquare size={22} />
        <span className="sr-only">Ask</span>
        {/* Tiny accent dot to suggest "AI / sparkles" without crowding the icon */}
        <span
          className={`absolute -top-0.5 -right-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full border-2 ${
            isLight
              ? 'bg-white border-brand-600 text-brand-600'
              : 'bg-[#0F172A] border-brand-300 text-brand-300'
          }`}
        >
          <Sparkles size={10} />
        </span>
      </button>
    );
  }

  // ---------------------------------------------------------------------------
  // Expanded — floating panel anchored bottom-right. Uses fixed positioning so
  // it overlays dashboard content rather than competing with it inside the
  // flex layout. Width caps at 420px; height fills viewport minus margin.
  // ---------------------------------------------------------------------------
  const panelBg = isLight
    ? 'bg-white border-[#E2E8F0] shadow-[0_24px_48px_-12px_rgba(15,23,42,0.18)]'
    : 'bg-[#0F172A] border-white/[0.08] shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]';
  const headerBorder = isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]';

  return (
    <div
      data-testid="ask-bubble-panel"
      className={`fixed z-40 flex flex-col overflow-hidden rounded-2xl border ${panelBg}`}
      style={{
        right: '1.5rem',
        bottom: '1.5rem',
        width: 'min(420px, calc(100vw - 3rem))',
        height: 'min(720px, calc(100vh - 7rem))',
      }}
    >
      {/* Compact header — Ishika feedback: chat should dominate, so chrome is
          slim. Single row with icon + protocol code + close. */}
      <div
        className={`flex-shrink-0 flex items-center gap-2 px-3.5 py-2.5 border-b ${headerBorder}`}
      >
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 ${
            isLight
              ? 'bg-brand-600/10 text-brand-600'
              : 'bg-brand-300/15 text-brand-300'
          }`}
        >
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 flex-1">
          {/* Per Kiara/Ishika 2026-06-03: single bolded title here ("Protocol
              Assistant"). Protocol metadata (code · sponsor · phase) lives in
              the AskTab strip below — we only show two header rows total. */}
          <p className="text-sm font-bold text-fg-heading leading-tight truncate">
            Protocol Assistant
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Ask assistant"
          title="Close"
          data-testid="ask-bubble-close"
          className={`flex-shrink-0 p-1.5 rounded-md transition-colors text-fg-sub ${
            isLight ? 'hover:bg-[#0F172A]/[0.04]' : 'hover:bg-white/[0.05]'
          }`}
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 min-h-0">
        {activeProtocol ? (
          <AskTab messages={messages} setMessages={setMessages} />
        ) : (
          <div className="h-full flex items-center justify-center p-6 text-center">
            <p className="text-fg-sub text-xs leading-relaxed">
              Select a protocol to ask questions grounded in its documents.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
