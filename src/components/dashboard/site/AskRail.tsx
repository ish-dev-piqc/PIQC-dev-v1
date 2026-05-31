import { useEffect, useState } from 'react';
import { MessageSquare, PanelRightClose, Sparkles } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useAskThread } from '../../../lib/site/useAskThread';
import AskTab from './AskTab';

// =============================================================================
// AskRail — the Site Mode "Ask" assistant, docked to the right on every tab.
//
// Replaces the old standalone "Ask" tab. Mounted once in the Site shell so the
// conversation survives tab switches; collapsed/expanded state and the
// conversation itself persist in-session (sessionStorage), and the thread is
// scoped per active protocol via useAskThread.
//
//   collapsed → a slim right-edge handle present on every tab
//   expanded  → a 380px panel wrapping the existing AskTab
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

export default function AskRail() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  const [open, setOpen] = useState<boolean>(() => loadOpen());
  const [messages, setMessages] = useAskThread(activeProtocol?.id ?? null);

  useEffect(() => {
    saveOpen(open);
  }, [open]);

  const panelBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const handleHover = isLight ? 'hover:bg-[#0F172A]/[0.03]' : 'hover:bg-white/[0.04]';

  // Collapsed — a slim handle on the right edge, always reachable.
  if (!open) {
    return (
      <div className={`flex-shrink-0 border-l ${panelBg} flex flex-col items-center`}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Ask assistant"
          title="Ask"
          data-testid="ask-rail-open"
          className={`mt-3 flex flex-col items-center gap-2 px-2.5 py-3 rounded-lg transition-colors ${handleHover}`}
        >
          <MessageSquare size={18} className="text-brand-300" />
          <span
            className="text-[11px] font-semibold tracking-wide text-fg-sub"
            style={{ writingMode: 'vertical-rl' }}
          >
            Ask
          </span>
        </button>
      </div>
    );
  }

  // Expanded — 380px column wrapping the existing AskTab.
  return (
    <div
      data-testid="ask-rail-panel"
      className={`flex-shrink-0 w-[380px] border-l ${panelBg} flex flex-col min-h-0`}
    >
      <div
        className={`flex-shrink-0 flex items-center justify-between px-4 py-2.5 border-b ${
          isLight ? 'border-[#E2E8F0]' : 'border-white/5'
        }`}
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-fg-heading">
          <Sparkles size={14} className="text-brand-300" /> Ask
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse Ask assistant"
          title="Collapse"
          data-testid="ask-rail-close"
          className={`p-1.5 rounded-md transition-colors ${handleHover} text-fg-sub`}
        >
          <PanelRightClose size={16} />
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
