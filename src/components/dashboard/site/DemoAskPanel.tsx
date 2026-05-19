import { useState } from 'react';
import { Sparkles, FileText } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import {
  DEMO_ASK_RESPONSES,
  DEMO_FALLBACK_ASK_RESPONSE,
  type DemoAskResponse,
} from '../../../lib/demo';

// =============================================================================
// DemoAskPanel — drop-in replacement for the Ask tab's DashboardChat in demo
// mode. Renders the four protocol-anchored suggested prompts as clickable
// cards; each click inserts a pre-canned response into a local thread.
//
// Why a separate component: DashboardChat is shared with audit mode and ties
// into the live LLM/RAG plumbing. We don't want demo mode mutating that path
// or accidentally hitting the LLM with empty RAG context. This panel mocks
// the chat surface entirely client-side.
// =============================================================================

interface DemoMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  citations?: DemoAskResponse['citations'];
}

interface SuggestionCard {
  text: string;
  matchKey: string;
}

const SUGGESTIONS_PER_PROTOCOL: SuggestionCard[] = [
  { text: 'What is the schedule of assessments?', matchKey: 'schedule of assessments' },
  { text: 'Summarise inclusion and exclusion criteria.', matchKey: 'inclusion' },
  { text: 'What safety reporting requirements apply?', matchKey: 'safety reporting' },
  { text: 'What are the visit windows and key timepoints?', matchKey: 'visit window' },
];

export default function DemoAskPanel() {
  const { theme } = useTheme();
  const { activeProtocol } = useProtocol();
  const isLight = theme === 'light';
  const [thread, setThread] = useState<DemoMessage[]>([]);

  if (!activeProtocol) return null;

  const responses = DEMO_ASK_RESPONSES[activeProtocol.id] ?? [];

  // Fuzzy substring match is safe here because matchKey only ever comes from
  // the content-controlled SUGGESTIONS_PER_PROTOCOL constants below — never
  // from user-typed input. If we later allow free-form questions in demo
  // mode, tighten this (or use the FALLBACK response) so unrelated keys
  // don't accidentally match.
  function answerFor(matchKey: string): DemoAskResponse {
    const direct = responses.find((r) => r.key === matchKey);
    if (direct) return direct;
    const fuzzy = responses.find((r) => matchKey.toLowerCase().includes(r.key));
    return fuzzy ?? DEMO_FALLBACK_ASK_RESPONSE;
  }

  const handleSuggestion = (s: SuggestionCard) => {
    const ans = answerFor(s.matchKey);
    setThread((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', text: s.text },
      {
        id: `a-${Date.now() + 1}`,
        role: 'assistant',
        text: ans.answer,
        citations: ans.citations,
      },
    ]);
  };

  const bubbleUser = isLight
    ? 'bg-[#4a6fa5] text-white'
    : 'bg-[#4a6fa5] text-white';
  const bubbleAssistant = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#1a1f28]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0]';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        {thread.length === 0 ? (
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} className={isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]'} />
              <p className={`${subColor} text-sm`}>
                Pick a starter to see a demo response. Live chat is disabled in demo mode.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {SUGGESTIONS_PER_PROTOCOL.map((s) => (
                <button
                  key={s.matchKey}
                  onClick={() => handleSuggestion(s)}
                  className={`text-left p-4 rounded-xl border transition-colors ${
                    isLight
                      ? 'bg-white border-[#e2e8ee] hover:border-[#4a6fa5]/40 hover:bg-[#4a6fa5]/[0.04]'
                      : 'bg-[#131a22] border-white/10 hover:border-[#6e8fb5]/40 hover:bg-white/[0.04]'
                  }`}
                >
                  <p className={`text-sm font-medium ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>
                    {s.text}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-3">
            {thread.map((m) =>
              m.role === 'user' ? (
                <div key={m.id} className="flex justify-end">
                  <div className={`${bubbleUser} rounded-2xl px-4 py-2 max-w-[80%] text-sm`}>
                    {m.text}
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex justify-start">
                  <div className={`${bubbleAssistant} rounded-2xl px-4 py-3 max-w-[85%] text-sm leading-relaxed`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.citations && m.citations.length > 0 && (
                      <div className={`mt-3 pt-3 border-t ${isLight ? 'border-[#e2e8ee]' : 'border-white/10'} space-y-1.5`}>
                        {m.citations.map((c, idx) => (
                          <div key={idx} className="flex items-start gap-2">
                            <FileText size={12} className={`${mutedColor} mt-0.5 flex-shrink-0`} />
                            <p className={`${subColor} text-xs`}>
                              <span className="font-medium">{c.document_title}</span>
                              {c.page != null && <span className={mutedColor}> · p.{c.page}</span>}
                              <span className={`${mutedColor} ml-1`}>— {c.snippet}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ),
            )}
            <div className="pt-2">
              <button
                onClick={() => setThread([])}
                className={`text-xs ${subColor} hover:underline`}
              >
                Start over
              </button>
            </div>
          </div>
        )}
      </div>
      <div className={`flex-shrink-0 border-t px-6 py-3 ${isLight ? 'border-[#e2e8ee] bg-[#f5f7fa]' : 'border-white/[0.06] bg-white/[0.02]'}`}>
        <p className={`${mutedColor} text-xs text-center`}>
          Demo mode — chat input disabled. Use the suggestions above to explore demo answers.
        </p>
      </div>
    </div>
  );
}
