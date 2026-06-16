import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Calendar,
  ClipboardList,
  FlaskConical,
  Pill,
  ShieldCheck,
  Stethoscope,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSiteData } from '../../../context/SiteDataContext';
import { useDemoMode } from '../../../context/DemoModeContext';
import DashboardChat from '../DashboardChat';
import DemoAskPanel from './DemoAskPanel';
import { deriveAskPrompts } from '../../../lib/site/askPrompts';
import { fetchVisitTemplates } from '../../../lib/site/siteApi';
import type { ChatMessage, RagStatus } from '../../../lib/supabase';

const PROMPT_ICONS: Record<string, LucideIcon> = {
  Calendar,
  ShieldCheck,
  ClipboardList,
  Pill,
  FlaskConical,
  Activity,
  BarChart3,
  Stethoscope,
};

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
  const { documents, teamMembers, loading } = useSiteData();
  const { demoActive } = useDemoMode();
  const isLight = theme === 'light';

  // Visit templates inform the "Schedule of assessments" prompt — if the
  // protocol's PDF hasn't been parsed yet there's nothing to ask about.
  const [hasVisitTemplates, setHasVisitTemplates] = useState(false);
  useEffect(() => {
    if (!activeProtocol) {
      setHasVisitTemplates(false);
      return;
    }
    let cancelled = false;
    fetchVisitTemplates(activeProtocol.id).then((r) => {
      if (cancelled) return;
      setHasVisitTemplates(r.ok && r.data.length > 0);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  // Local doc-id list scoped to this protocol's tagged documents. Recomputes
  // when the documents array changes (including realtime updates). Held in
  // local state so Audit-mode chat selection isn't affected by Site Ask.
  const protocolDocIds = useMemo(() => documents.map((d) => d.id), [documents]);
  const [_localOverride, _setLocalOverride] = useState<string[] | null>(null);
  const localSelectedDocIds = _localOverride ?? protocolDocIds;
  const setLocalSelectedDocIds = (ids: string[]) => _setLocalOverride(ids);

  // Rule-based dynamic prompts (D3a) — see src/lib/site/askPrompts.ts.
  // Derived from the active protocol's phase, the presence of an extracted
  // schedule, and the team-member roles staffed on the study.
  //
  // NOTE: these hooks run unconditionally (before the early-return below) to
  // satisfy react-hooks/rules-of-hooks. They guard internally against the
  // null-protocol case so an early null return below is still the source of
  // truth for rendering.
  const protocolTeam = useMemo(
    () =>
      activeProtocol
        ? teamMembers.filter((m) => m.protocol_id === activeProtocol.id)
        : [],
    [teamMembers, activeProtocol],
  );
  const protocolSuggestions = useMemo(
    () =>
      activeProtocol
        ? deriveAskPrompts({
            protocol: activeProtocol,
            team: protocolTeam,
            hasVisitTemplates,
          }).map(({ icon, text }) => ({
            icon: PROMPT_ICONS[icon] ?? Calendar,
            text,
          }))
        : [],
    [activeProtocol, protocolTeam, hasVisitTemplates],
  );

  if (!activeProtocol) return null;

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const stripBg = isLight
    ? 'bg-brand-600/[0.04] border-brand-600/15'
    : 'bg-brand-300/[0.05] border-brand-300/20';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Protocol metadata strip — second of the two header rows in the bubble
          (the first is "Protocol Assistant" in AskBubble). No icon here; the
          bubble header already has one. Single truncating line: code · sponsor
          · phase. */}
      <div className={`flex-shrink-0 border-b ${stripBg} px-4 py-2`}>
        <p className="text-xs min-w-0 truncate">
          <span className={`${headingColor} font-semibold`}>{activeProtocol.code}</span>
          <span className={`${mutedColor} mx-1.5`}>·</span>
          <span className={subColor}>
            {activeProtocol.sponsor} · {activeProtocol.phase}
          </span>
        </p>
      </div>

      {/* Demo mode: short-circuit to canned-response panel — never hits the live LLM. */}
      {demoActive ? (
        <DemoAskPanel />
      ) : /* Hard-block when no protocol documents exist for this protocol */
      documents.length === 0 ? (
        <div className="flex-1 min-h-0 overflow-y-auto p-8">
          <div
            className={`max-w-md mx-auto text-center border rounded-xl px-6 py-10 ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
            }`}
          >
            <Upload className={`mx-auto mb-3 ${mutedColor}`} size={28} />
            <p className={`${headingColor} text-base font-semibold`}>
              {loading ? 'Loading documents…' : 'Upload a protocol document to enable Ask'}
            </p>
            <p className={`${subColor} text-xs mt-2 leading-relaxed`}>
              Ask is grounded in the documents tagged to{' '}
              <span className="font-mono font-semibold">{activeProtocol.code}</span>. Upload a
              protocol PDF in the document library — once we extract the protocol
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
            hideHeader
          />
        </div>
      )}
    </div>
  );
}
