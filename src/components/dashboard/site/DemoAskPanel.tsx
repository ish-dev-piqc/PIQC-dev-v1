import { useMemo, useState } from 'react';
import {
  Sparkles,
  FileText,
  Calendar,
  ShieldCheck,
  AlertTriangle,
  Clock,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  DEMO_ASK_RESPONSES,
  DEMO_FALLBACK_ASK_RESPONSE,
  type DemoAskResponse,
} from '../../../lib/demo';

// =============================================================================
// DemoAskPanel — drop-in replacement for the Ask tab's DashboardChat in demo
// mode. Lives inside AskRail (a 380px right-docked panel mounted globally in
// Dashboard.tsx), so layout assumes narrow width.
//
// Why a separate component: DashboardChat is shared with audit mode and ties
// into the live LLM/RAG plumbing. We don't want demo mode mutating that path
// or accidentally hitting the LLM with empty RAG context.
//
// Demo-polish pass (kiara/ask-tab-demo-polish):
//   1. Suggestion cards stay reachable after the first answer (as a chip strip
//      above the input) so the demo always has a natural next click.
//   2. Each suggestion has an icon for visual parity with live-mode prompts.
//   3. Footer is now a visibly-disabled input affordance, not a text line —
//      avoids reading as "chat is broken."
//   4. Forced single-column suggestion layout (we're inside a 380px rail).
//   5. Stronger citation chips so the source-grounded differentiator lands.
//   6. Empty-state copy reinforces "grounded in this protocol."
// =============================================================================

interface DemoMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: DemoAskResponse['citations'];
  matchKey?: string;
}

interface SuggestionCard {
  text: string;
  matchKey: string;
  icon: LucideIcon;
}

const SUGGESTIONS_PER_PROTOCOL: SuggestionCard[] = [
  {
    text: 'What is the schedule of assessments?',
    matchKey: 'schedule of assessments',
    icon: Calendar,
  },
  {
    text: 'Summarise inclusion and exclusion criteria.',
    matchKey: 'inclusion',
    icon: ShieldCheck,
  },
  {
    text: 'What safety reporting requirements apply?',
    matchKey: 'safety reporting',
    icon: AlertTriangle,
  },
  {
    text: 'What are the visit windows and key timepoints?',
    matchKey: 'visit window',
    icon: Clock,
  },
];

export default function DemoAskPanel() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';
  const [thread, setThread] = useState<DemoMessage[]>([]);

  // NOTE: all hooks must run before any conditional return to satisfy
  // react-hooks/rules-of-hooks. `askedKeys` only depends on `thread` so it's
  // safe to compute regardless of `activeProtocol`.
  const askedKeys = useMemo(
    () => new Set(thread.filter((m) => m.role === 'user' && m.matchKey).map((m) => m.matchKey!)),
    [thread],
  );

  if (!activeProtocol) return null;

  const responses = DEMO_ASK_RESPONSES[activeProtocol.id] ?? [];

  // Fuzzy substring match is safe here because matchKey only ever comes from
  // the content-controlled SUGGESTIONS_PER_PROTOCOL constants above — never
  // from user-typed input.
  function answerFor(matchKey: string): DemoAskResponse {
    const direct = responses.find((r) => r.key === matchKey);
    if (direct) return direct;
    const fuzzy = responses.find((r) => matchKey.toLowerCase().includes(r.key));
    return fuzzy ?? DEMO_FALLBACK_ASK_RESPONSE;
  }

  const remainingSuggestions = SUGGESTIONS_PER_PROTOCOL.filter((s) => !askedKeys.has(s.matchKey));

  const handleSuggestion = (s: SuggestionCard) => {
    const ans = answerFor(s.matchKey);
    setThread((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: 'user',
        text: s.text,
        matchKey: s.matchKey,
      },
      {
        id: `a-${Date.now() + 1}`,
        role: 'assistant',
        text: ans.answer,
        citations: ans.citations,
      },
    ]);
  };

  const bubbleUser = 'bg-brand-600 text-white';
  const bubbleAssistant = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#0F172A]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1]';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const labelColor = 'text-fg-label';

  const cardBase = isLight
    ? 'bg-white border-[#E2E8F0] hover:border-brand-600/40 hover:bg-brand-600/[0.04]'
    : 'bg-[#0F172A] border-white/10 hover:border-brand-300/40 hover:bg-white/[0.04]';

  const isEmpty = thread.length === 0;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Scrollable conversation / empty state.
          Ishika feedback (2026-06-03): chat should dominate over chrome and
          starters. Empty-state cards became compact chips, the explainer is
          one short line, and the bulk of the bubble reads as "chat area
          waiting" rather than "menu of options." */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        {isEmpty ? (
          <div className="h-full flex flex-col">
            {/* Top spacer keeps the chat area visually open above the chips */}
            <div className="flex-1 min-h-[40px]" />
            <div className="flex items-center gap-1.5 mb-2">
              <Sparkles
                size={11}
                className={`flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`}
              />
              <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
                Try a starter
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS_PER_PROTOCOL.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.matchKey}
                    onClick={() => handleSuggestion(s)}
                    className={`text-left text-xs px-2.5 py-2 rounded-lg border flex items-center gap-2 transition-colors ${cardBase}`}
                  >
                    <Icon
                      size={12}
                      className={`flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`}
                    />
                    <span className={`${subColor} truncate`}>{s.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {thread.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className={`${bubbleUser} rounded-2xl px-4 py-2 max-w-[85%] text-sm`}>
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div
                    className={`${bubbleAssistant} rounded-2xl px-4 py-3 max-w-[90%] text-sm leading-relaxed shadow-sm`}
                  >
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.citations && m.citations.length > 0 && (
                      <div
                        className={`mt-3 pt-3 border-t ${
                          isLight ? 'border-[#E2E8F0]' : 'border-white/10'
                        } space-y-2`}
                      >
                        <p
                          className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}
                        >
                          Sources
                        </p>
                        {m.citations.map((c, idx) => (
                          <div
                            key={idx}
                            className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                              isLight
                                ? 'bg-brand-600/[0.04] border-brand-600/15'
                                : 'bg-brand-300/[0.06] border-brand-300/20'
                            }`}
                          >
                            <span
                              className={`flex-shrink-0 inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold ${
                                isLight
                                  ? 'bg-brand-600/15 text-brand-600'
                                  : 'bg-brand-300/20 text-brand-300'
                              }`}
                            >
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs flex items-center gap-1.5 flex-wrap">
                                <FileText
                                  size={11}
                                  className={`${mutedColor} flex-shrink-0`}
                                />
                                <span className="font-semibold text-fg-heading truncate">
                                  {c.document_title}
                                </span>
                                {c.page != null && (
                                  <span className={`${mutedColor} text-[11px]`}>· p. {c.page}</span>
                                )}
                              </p>
                              <p className={`${subColor} text-[11px] mt-1 leading-relaxed italic`}>
                                "{c.snippet}"
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </div>

      {/* Persistent suggestion strip (only when there's a thread + suggestions left) */}
      {!isEmpty && remainingSuggestions.length > 0 && (
        <div
          className={`flex-shrink-0 px-4 py-3 border-t ${
            isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-white/[0.06] bg-white/[0.02]'
          }`}
        >
          <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
            Try another question
          </p>
          <div className="flex flex-col gap-1.5">
            {remainingSuggestions.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.matchKey}
                  onClick={() => handleSuggestion(s)}
                  className={`text-left text-xs px-2.5 py-2 rounded-lg border flex items-center gap-2 transition-colors ${cardBase}`}
                >
                  <Icon
                    size={12}
                    className={isLight ? 'text-brand-600' : 'text-brand-300'}
                  />
                  <span className={`${subColor} truncate`}>{s.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Reset link when no suggestions remain */}
      {!isEmpty && remainingSuggestions.length === 0 && (
        <div
          className={`flex-shrink-0 px-4 py-3 border-t text-center ${
            isLight ? 'border-[#E2E8F0] bg-[#F8FAFC]' : 'border-white/[0.06] bg-white/[0.02]'
          }`}
        >
          <button
            onClick={() => setThread([])}
            className={`text-xs font-medium ${
              isLight ? 'text-brand-600 hover:text-brand-700' : 'text-brand-300 hover:text-brand-200'
            }`}
          >
            ← Start a new conversation
          </button>
        </div>
      )}

      {/* Visibly-disabled input affordance — looks like the live chat input
          so the demo viewer understands chat is intentionally off, not broken. */}
      <div
        className={`flex-shrink-0 px-4 pb-4 pt-3 border-t ${
          isLight ? 'border-[#E2E8F0] bg-white' : 'border-white/[0.06] bg-[#11171d]'
        }`}
      >
        <div
          className={`rounded-2xl border px-3.5 py-2.5 flex items-center gap-2 cursor-not-allowed ${
            isLight
              ? 'bg-[#F1F5F9] border-[#E2E8F0]'
              : 'bg-[#0F172A] border-white/[0.08]'
          }`}
          aria-disabled="true"
        >
          <span className={`${mutedColor} text-sm flex-1 truncate`}>
            Live chat off in demo mode — pick a suggestion
          </span>
          <span
            className={`flex-shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
              isLight
                ? 'bg-brand-600/10 text-brand-600'
                : 'bg-brand-300/15 text-brand-300'
            }`}
          >
            Demo
          </span>
        </div>
      </div>
    </div>
  );
}
