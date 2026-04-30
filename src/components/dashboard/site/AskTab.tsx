import {
  Calendar,
  ShieldCheck,
  ClipboardList,
  Pill,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import DashboardChat from '../DashboardChat';
import type { ChatMessage, RagStatus } from '../../../lib/supabase';

// =============================================================================
// AskTab — protocol-grounded AI assistant.
//
// Per UX spec: "PIQC may feel as easy as ChatGPT, but is fundamentally
// different — not free-form Q&A, not document interpretation, structured
// execution logic already created." The Ask surface should make the protocol
// context explicit and offer protocol-relevant suggested prompts so the
// auditor never feels like they're talking to a generic LLM.
//
// This component is a thin wrapper around DashboardChat (the existing RAG
// chat engine). It adds:
//   - A protocol context strip so the user always knows what's loaded
//   - Protocol-specific suggested prompts in the empty state
//   - A "grounded in this protocol" framing message
//
// The chat engine itself is unchanged.
// =============================================================================

type ExtendedMessage = ChatMessage & {
  streaming?: boolean;
  ragStatus?: RagStatus;
  ragError?: string;
};

interface AskTabProps {
  messages: ExtendedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ExtendedMessage[]>>;
  selectedDocIds: string[];
  setSelectedDocIds: (ids: string[]) => void;
}

export default function AskTab({
  messages,
  setMessages,
  selectedDocIds,
  setSelectedDocIds,
}: AskTabProps) {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';

  // ProtocolRequiredGate wraps this component, so activeProtocol is non-null
  // by the time we render. Guard defensively anyway.
  if (!activeProtocol) return null;

  // Protocol-specific suggested prompts. Phase B: hand-tuned per phase /
  // therapeutic area would be ideal; for now we offer a useful generic
  // protocol-anchored set that beats the truly generic suggestions.
  const protocolSuggestions = [
    {
      icon: Calendar,
      text: `What is the schedule of assessments for ${activeProtocol.code}?`,
    },
    {
      icon: ClipboardList,
      text: `Summarise the inclusion and exclusion criteria for ${activeProtocol.code}.`,
    },
    {
      icon: ShieldCheck,
      text: `What safety reporting requirements apply on ${activeProtocol.code}?`,
    },
    {
      icon: Pill,
      text: `What are the visit windows and key timepoints for ${activeProtocol.code}?`,
    },
  ];

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/65' : 'text-[#d2d7e0]/55';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const sectionHeader = isLight ? 'text-[#374152]/45' : 'text-[#d2d7e0]/40';
  const stripBg = isLight
    ? 'bg-[#4a6fa5]/[0.05] border-[#4a6fa5]/20'
    : 'bg-[#6e8fb5]/[0.06] border-[#6e8fb5]/25';
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#6e8fb5]/15 border-[#6e8fb5]/25 text-[#6e8fb5]';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Protocol context strip */}
      <div className={`flex-shrink-0 border-b ${stripBg} px-5 py-3`}>
        <div className="flex items-start gap-3">
          <div
            className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border flex-shrink-0 ${iconBg}`}
          >
            <Sparkles size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Protocol-grounded assistant
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-0.5 truncate`}>
              Asking about <span className="font-bold">{activeProtocol.code}</span>
              <span className={`${mutedColor} font-normal ml-2`}>·</span>
              <span className={`${subColor} font-medium ml-2`}>
                {activeProtocol.sponsor} · {activeProtocol.phase}
              </span>
            </p>
            <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
              Answers are grounded in this protocol's documents. Citations point back to the
              source section so you can verify before acting.
            </p>
          </div>
        </div>
      </div>

      {/* Mock-data caveat — surfaces honestly until live RAG is wired */}
      <div
        className={`flex-shrink-0 px-5 py-2 text-[11px] flex items-center gap-2 border-b ${
          isLight
            ? 'bg-amber-50/50 border-amber-200/60 text-amber-700'
            : 'bg-amber-500/[0.04] border-amber-500/15 text-amber-300'
        }`}
      >
        <AlertCircle size={11} className="flex-shrink-0" />
        <span>
          This assistant currently runs over the general knowledge base. Per-protocol
          scoping ships with the Supabase wire-up.
        </span>
      </div>

      {/* Chat — unchanged engine, custom empty-state framing for the active protocol */}
      <div className="flex-1 min-h-0">
        <DashboardChat
          messages={messages}
          setMessages={setMessages}
          selectedDocIds={selectedDocIds}
          setSelectedDocIds={setSelectedDocIds}
          customSuggestions={protocolSuggestions}
          emptyHeading={`Ask about ${activeProtocol.code}`}
          emptySubtext={`Grounded in ${activeProtocol.code} (${activeProtocol.phase}, ${activeProtocol.sponsor}). Pick a starter or ask anything.`}
        />
      </div>
    </div>
  );
}
