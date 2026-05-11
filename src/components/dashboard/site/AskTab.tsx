import { useMemo, useState } from 'react';
import {
  Calendar,
  ShieldCheck,
  ClipboardList,
  Pill,
  Sparkles,
  Upload,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
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
  // selectedDocIds + setter are accepted for prop-shape compatibility with
  // Dashboard's switch case but intentionally NOT used by Site Mode's Ask.
  // Site Ask derives its own scope from the active protocol's tagged docs so
  // we don't pollute Audit-mode chat selection.
  selectedDocIds?: string[];
  setSelectedDocIds?: (ids: string[]) => void;
}

export default function AskTab({
  messages,
  setMessages,
}: AskTabProps) {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const { documents, loading } = useSiteData();
  const isLight = theme === 'light';

  // Local doc-id list scoped to this protocol's tagged documents. Recomputes
  // when the documents array changes (including realtime updates). Held in
  // local state so Audit-mode chat selection isn't affected by Site Ask.
  const protocolDocIds = useMemo(() => documents.map((d) => d.id), [documents]);
  const [_localOverride, _setLocalOverride] = useState<string[] | null>(null);
  const localSelectedDocIds = _localOverride ?? protocolDocIds;
  const setLocalSelectedDocIds = (ids: string[]) => _setLocalOverride(ids);

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
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
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

      {/* Hard-block when no protocol documents exist for this protocol */}
      {documents.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-8">
          <div
            className={`max-w-md mx-auto text-center border rounded-xl px-6 py-10 ${
              isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5'
            }`}
          >
            <Upload className={`mx-auto mb-3 ${mutedColor}`} size={28} />
            <p className={`${headingColor} text-base font-semibold`}>
              {loading ? 'Loading documents…' : 'Upload a protocol document to enable Ask'}
            </p>
            <p className={`${subColor} text-xs mt-2 leading-relaxed`}>
              Ask is grounded in the documents tagged to{' '}
              <span className="font-mono font-semibold">{activeProtocol.code}</span>. Upload a
              protocol PDF in the document library — once Reducto extracts the protocol
              number, it will be auto-tagged here and the assistant will switch on.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <DashboardChat
            messages={messages}
            setMessages={setMessages}
            selectedDocIds={localSelectedDocIds}
            setSelectedDocIds={setLocalSelectedDocIds}
            customSuggestions={protocolSuggestions}
            emptyHeading={`Ask about ${activeProtocol.code}`}
            emptySubtext={`Grounded in ${documents.length} document${documents.length === 1 ? '' : 's'} for ${activeProtocol.code}. Pick a starter or ask anything.`}
          />
        </div>
      )}
    </div>
  );
}
