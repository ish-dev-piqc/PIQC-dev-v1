import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, BookOpen, Stethoscope, User, ChevronDown, Search, FileText, ChevronUp, X, Check, Sparkles, Activity, Shield, GitBranch, AlertTriangle, Database, HelpCircle } from 'lucide-react';
import { streamDashboardChat, ChatMessage, RagStatus, supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';

interface Document {
  id: string;
  title: string;
  source: string;
}

type ExtendedMessage = ChatMessage & {
  streaming?: boolean;
  ragStatus?: RagStatus;
  ragError?: string;
};

const DOC_SUGGESTED_PROMPTS: Record<string, string[]> = {};

const GENERAL_SUGGESTIONS = [
  { icon: Activity, text: 'What are the key clinical protocols in the knowledge base?' },
  { icon: Shield, text: 'What compliance requirements should I be aware of?' },
  { icon: GitBranch, text: 'Walk me through the standard care workflow steps.' },
  { icon: Stethoscope, text: 'What documentation is required for patient handoffs?' },
];

function getDefaultSuggestionsForDoc(title: string): string[] {
  const t = title.toLowerCase();
  const prompts: string[] = [];

  if (t.includes('sepsis')) {
    prompts.push(
      `What are the early warning signs described in "${title}"?`,
      `What is the recommended treatment protocol in "${title}"?`,
      `What are the diagnostic criteria outlined in "${title}"?`,
      `Who is responsible for initiating the protocol in "${title}"?`
    );
  } else if (t.includes('fall') || t.includes('prevention')) {
    prompts.push(
      `What fall risk assessment tools are described in "${title}"?`,
      `What interventions are recommended in "${title}"?`,
      `How is patient risk stratified in "${title}"?`,
      `What documentation is required per "${title}"?`
    );
  } else if (t.includes('medication') || t.includes('reconciliation') || t.includes('pharma')) {
    prompts.push(
      `What steps are outlined for medication reconciliation in "${title}"?`,
      `What high-risk medications are highlighted in "${title}"?`,
      `How should discrepancies be handled per "${title}"?`,
      `What staff roles are involved according to "${title}"?`
    );
  } else if (t.includes('hipaa') || t.includes('compliance') || t.includes('privacy')) {
    prompts.push(
      `What are the key compliance requirements in "${title}"?`,
      `What violations are addressed in "${title}"?`,
      `What patient rights are described in "${title}"?`,
      `What are the audit procedures per "${title}"?`
    );
  } else {
    prompts.push(
      `Summarize the key points of "${title}"`,
      `What are the main protocols described in "${title}"?`,
      `Who does "${title}" apply to?`,
      `What compliance requirements are outlined in "${title}"?`
    );
  }

  return prompts;
}

function getSuggestionsForDocs(docs: Document[]): string[] {
  if (docs.length === 0) return [];
  if (docs.length === 1) {
    const doc = docs[0];
    return DOC_SUGGESTED_PROMPTS[doc.id] ?? getDefaultSuggestionsForDoc(doc.title);
  }
  const titles = docs.map(d => `"${d.title}"`).join(' and ');
  return [
    `Compare the protocols described in ${titles}`,
    `What do ${titles} have in common?`,
    `Summarize the key differences between ${titles}`,
    `What compliance requirements are shared across ${titles}?`,
  ];
}

function renderContent(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

function RagStatusTag({ ragStatus, ragError, isLight }: { ragStatus: RagStatus; ragError?: string; isLight: boolean }) {
  if (ragStatus === 'found') {
    return (
      <div className={`flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full w-fit text-[10px] font-medium ${
        isLight ? 'text-[#3a6b3c]/70 bg-[#487e4a]/08' : 'text-[#6aaa6c]/60 bg-[#487e4a]/10'
      }`}>
        <Database size={9} />
        <span>Answered from knowledge base</span>
      </div>
    );
  }

  if (ragStatus === 'not_found') {
    return (
      <div className={`flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full w-fit text-[10px] font-medium ${
        isLight ? 'text-[#6b5a1a]/60 bg-amber-100/60' : 'text-amber-400/50 bg-amber-900/15'
      }`}>
        <HelpCircle size={9} />
        <span>Not found in documents — general answer</span>
      </div>
    );
  }

  if (ragStatus === 'error') {
    return (
      <div className={`flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg w-fit text-[10px] font-medium border ${
        isLight
          ? 'text-red-700/80 bg-red-50 border-red-200/60'
          : 'text-red-400/80 bg-red-950/25 border-red-800/30'
      }`}>
        <AlertTriangle size={9} className="flex-shrink-0" />
        <span>Document search failed — answer based on general knowledge{ragError ? `: ${ragError}` : ''}</span>
      </div>
    );
  }

  return null;
}

function MessageBubble({ msg, isLight }: { msg: ExtendedMessage; isLight: boolean }) {
  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-3 group ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-[#5a9a5c] to-[#3d6b3f]'
          : isLight
          ? 'bg-gradient-to-br from-[#e8f0e8] to-[#d4e4d4] border border-[#c8dcc8]'
          : 'bg-gradient-to-br from-[#1e2b1e] to-[#141d14] border border-[#2a3a2a]'
      }`}>
        {isUser
          ? <User size={14} className="text-white" />
          : <BookOpen size={14} className="text-[#5a8a5c]" />
        }
      </div>

      <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        <span className={`text-[10px] font-medium tracking-wide uppercase px-1 ${
          isUser
            ? isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'
            : isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'
        }`}>
          {isUser ? 'You' : 'Protocol Assistant'}
        </span>
        <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
          isUser
            ? 'bg-gradient-to-br from-[#5a9a5c] to-[#3d6b3f] text-white rounded-tr-sm'
            : isLight
            ? 'bg-white text-[#2a3a2a] rounded-tl-sm border border-[#e2e8e2] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
            : 'bg-[#171f18] text-[#c8d4c8] rounded-tl-sm border border-white/[0.07] shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
        }`}>
          {msg.content.split('\n').map((line, i) => {
            if (line.startsWith('- ')) {
              return (
                <div key={i} className="flex gap-2 my-1">
                  <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${isUser ? 'bg-white/70' : 'bg-[#5a8a5c]'}`} />
                  <span>{renderContent(line.slice(2))}</span>
                </div>
              );
            }
            return (
              <p key={i} className={i > 0 && line !== '' ? 'mt-2' : ''}>
                {renderContent(line)}
              </p>
            );
          })}
          {msg.streaming && (
            <span className="inline-block w-0.5 h-4 ml-0.5 bg-[#5a8a5c] animate-pulse rounded-full align-middle" />
          )}
        </div>
        {!isUser && !msg.streaming && msg.ragStatus && (
          <RagStatusTag ragStatus={msg.ragStatus} ragError={msg.ragError} isLight={isLight} />
        )}
      </div>
    </div>
  );
}

function TypingIndicator({ retrieving, isLight }: { retrieving?: boolean; isLight: boolean }) {
  return (
    <div className="flex gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 shadow-sm ${
        isLight
          ? 'bg-gradient-to-br from-[#e8f0e8] to-[#d4e4d4] border border-[#c8dcc8]'
          : 'bg-gradient-to-br from-[#1e2b1e] to-[#141d14] border border-[#2a3a2a]'
      }`}>
        <BookOpen size={14} className="text-[#5a8a5c]" />
      </div>
      <div className="flex flex-col gap-1 items-start">
        <span className={`text-[10px] font-medium tracking-wide uppercase px-1 ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'}`}>
          Protocol Assistant
        </span>
        <div className={`rounded-2xl rounded-tl-sm px-4 py-3 flex gap-2 items-center shadow-sm ${
          isLight
            ? 'bg-white border border-[#e2e8e2] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
            : 'bg-[#171f18] border border-white/[0.07] shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
        }`}>
          {retrieving ? (
            <>
              <Search size={13} className="text-[#5a8a5c] animate-pulse flex-shrink-0" />
              <span className={`text-xs ${isLight ? 'text-[#374137]/50' : 'text-[#d2d7d2]/40'}`}>Searching knowledge base...</span>
            </>
          ) : (
            <div className="flex gap-1.5 items-center">
              <span className="w-2 h-2 rounded-full bg-[#5a8a5c]/70 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#5a8a5c]/70 animate-bounce" style={{ animationDelay: '160ms' }} />
              <span className="w-2 h-2 rounded-full bg-[#5a8a5c]/70 animate-bounce" style={{ animationDelay: '320ms' }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface DocumentSelectorProps {
  selectedDocIds: string[];
  onSelectionChange: (ids: string[]) => void;
  isLight: boolean;
}

function DocumentSelector({ selectedDocIds, onSelectionChange, isLight }: DocumentSelectorProps) {
  const [open, setOpen] = useState(false);
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    supabase
      .from('documents')
      .select('id, title, source')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setDocs(data ?? []);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const toggle = (id: string) => {
    onSelectionChange(
      selectedDocIds.includes(id)
        ? selectedDocIds.filter(d => d !== id)
        : [...selectedDocIds, id]
    );
  };

  const selectedDocs = docs.filter(d => selectedDocIds.includes(d.id));

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all duration-150 ${
          selectedDocIds.length > 0
            ? 'bg-[#487e4a]/15 border-[#487e4a]/40 text-[#5a8a5c]'
            : isLight
            ? 'bg-transparent border-[#d8e4d8] text-[#374137]/50 hover:text-[#374137]/80 hover:border-[#c8d8c8]'
            : 'bg-transparent border-white/10 text-[#d2d7d2]/40 hover:text-[#d2d7d2]/70 hover:border-white/15'
        }`}
      >
        <FileText size={11} />
        <span className="truncate max-w-[120px]">
          {selectedDocIds.length === 0
            ? 'All documents'
            : selectedDocIds.length === 1
            ? selectedDocs[0]?.title ?? '1 document'
            : `${selectedDocIds.length} documents`
          }
        </span>
        {open ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>

      {open && (
        <div className={`absolute bottom-full left-0 mb-2 w-72 border rounded-xl shadow-2xl z-50 overflow-hidden ${
          isLight
            ? 'bg-white border-[#dce8dc] shadow-[#1a1f1a]/12'
            : 'bg-[#141c14] border-white/10 shadow-black/40'
        }`}>
          <div className={`px-3 py-2.5 border-b flex items-center justify-between ${
            isLight ? 'border-[#eef4ee]' : 'border-white/5'
          }`}>
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${
              isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/35'
            }`}>Filter by document</span>
            {selectedDocIds.length > 0 && (
              <button
                onClick={() => onSelectionChange([])}
                className={`text-xs transition-colors flex items-center gap-1 ${
                  isLight
                    ? 'text-[#374137]/40 hover:text-[#374137]/70'
                    : 'text-[#d2d7d2]/30 hover:text-[#d2d7d2]/60'
                }`}
              >
                <X size={10} />
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className={`px-3 py-5 text-xs text-center ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'}`}>Loading documents...</div>
            ) : docs.length === 0 ? (
              <div className={`px-3 py-5 text-xs text-center ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'}`}>No documents in knowledge base</div>
            ) : (
              docs.map(doc => {
                const selected = selectedDocIds.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => toggle(doc.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? isLight ? 'bg-[#487e4a]/08' : 'bg-[#487e4a]/12'
                        : isLight ? 'hover:bg-[#f5f9f5]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      selected
                        ? 'bg-[#487e4a] border-[#487e4a]'
                        : isLight ? 'border-[#c8d8c8] bg-transparent' : 'border-white/20 bg-transparent'
                    }`}>
                      {selected && <Check size={9} className="text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm truncate leading-tight font-medium ${isLight ? 'text-[#2a3a2a]' : 'text-[#c8d4c8]'}`}>{doc.title || 'Untitled'}</p>
                      {doc.source && (
                        <p className={`text-xs truncate mt-0.5 ${isLight ? 'text-[#374137]/40' : 'text-[#d2d7d2]/30'}`}>{doc.source}</p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DashboardChatProps {
  messages: ExtendedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ExtendedMessage[]>>;
  selectedDocIds: string[];
  setSelectedDocIds: (ids: string[]) => void;
}

export default function DashboardChat({
  messages,
  setMessages,
  selectedDocIds,
  setSelectedDocIds,
}: DashboardChatProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [allDocs, setAllDocs] = useState<Document[]>([]);
  const [chatError, setChatError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const showEmpty = messages.length === 0;

  useEffect(() => {
    supabase
      .from('documents')
      .select('id, title, source')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setAllDocs(data ?? []));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const selectedDocs = allDocs.filter(d => selectedDocIds.includes(d.id));
  const docSuggestions = getSuggestionsForDocs(selectedDocs);

  const handleSend = useCallback(async (text?: string) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setChatError(null);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    const history = messages.filter(m => !m.streaming);
    const userMsg: ExtendedMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);
    setRetrieving(true);

    const ac = new AbortController();
    abortRef.current = ac;

    const assistantMsg: ExtendedMessage = {
      role: 'assistant',
      content: '',
      streaming: true,
    };

    let firstToken = true;
    let finalRagStatus: RagStatus = 'not_found';
    let finalRagError = '';

    try {
      const result = await streamDashboardChat(
        content,
        history,
        selectedDocIds,
        (token) => {
          if (firstToken) {
            firstToken = false;
            setRetrieving(false);
            setMessages(prev => [...prev, assistantMsg]);
          }
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + token };
            }
            return updated;
          });
        },
        ac.signal
      );
      finalRagStatus = result.ragStatus;
      finalRagError = result.ragError;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const errorMsg = err.message || 'Something went wrong. Please try again.';
        setChatError(errorMsg);
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant' && last.content === '') {
            updated.pop();
          }
          return updated;
        });
      }
    } finally {
      setRetrieving(false);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            streaming: false,
            ragStatus: finalRagStatus,
            ragError: finalRagError,
          };
        }
        return updated;
      });
      setLoading(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }, [input, loading, messages, selectedDocIds, setMessages]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const statusLabel = loading
    ? retrieving ? 'Searching...' : 'Responding...'
    : 'Ready';

  const statusColor = loading
    ? 'bg-amber-400'
    : 'bg-emerald-400';

  return (
    <div className={`flex flex-col h-full ${isLight ? 'bg-[#fafcfa]' : 'bg-[#0c110d]'}`}>

      {/* Header */}
      <div className={`flex-shrink-0 px-5 py-3.5 border-b ${
        isLight
          ? 'border-[#e2eae2] bg-white'
          : 'border-white/[0.06] bg-[#111711]'
      }`}>
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${
            isLight
              ? 'bg-gradient-to-br from-[#dceadc] to-[#c4d8c4]'
              : 'bg-gradient-to-br from-[#1e2e1e] to-[#162016]'
          }`}>
            <BookOpen size={17} className="text-[#4a7a4c]" />
          </div>
          <div>
            <h2 className={`font-semibold text-sm leading-tight ${isLight ? 'text-[#1a2a1a]' : 'text-[#e0e8e0]'}`}>
              Protocol Assistant
            </h2>
            <p className={`text-[11px] leading-tight mt-0.5 ${isLight ? 'text-[#374137]/50' : 'text-[#8a9a8a]'}`}>
              Clinical knowledge at your fingertips
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${statusColor} ${loading ? '' : 'animate-pulse'}`} />
            <span className={`text-[11px] font-medium transition-all duration-300 ${isLight ? 'text-[#374137]/50' : 'text-[#8a9a8a]'}`}>
              {statusLabel}
            </span>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto scroll-smooth relative">
        <div className="px-5 py-5 space-y-5">

          {showEmpty && (
            <div className="flex flex-col items-center justify-center min-h-[280px] text-center pt-4 pb-2">
              <div className="relative mb-5">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-md ${
                  isLight
                    ? 'bg-gradient-to-br from-[#dceadc] to-[#bdd4bd]'
                    : 'bg-gradient-to-br from-[#1e2e1e] to-[#162016]'
                }`}>
                  <Stethoscope size={28} className="text-[#4a7a4c]" />
                </div>
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-[#5a9a5c] to-[#3d6b3f] flex items-center justify-center shadow-sm">
                  <Sparkles size={10} className="text-white" />
                </div>
              </div>
              <h3 className={`font-bold text-lg mb-2 tracking-tight ${isLight ? 'text-[#1a2a1a]' : 'text-[#e0e8e0]'}`}>
                Clinical Protocol Assistant
              </h3>
              <p className={`text-sm max-w-[280px] leading-relaxed ${isLight ? 'text-[#374137]/55' : 'text-[#8a9a8a]'}`}>
                Ask me about care protocols, workflows, compliance requirements, or anything in your knowledge base.
              </p>

              {docSuggestions.length > 0 ? (
                <div className="mt-6 w-full max-w-sm space-y-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-widest mb-3 ${isLight ? 'text-[#374137]/35' : 'text-[#8a9a8a]/60'}`}>
                    Suggested for selected documents
                  </p>
                  {docSuggestions.slice(0, 4).map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(prompt)}
                      className={`w-full text-left text-xs px-3.5 py-2.5 rounded-xl border transition-all duration-150 leading-relaxed group ${
                        isLight
                          ? 'bg-white border-[#dce8dc] text-[#2a3a2a]/70 hover:border-[#5a8a5c]/40 hover:bg-[#f0f8f0] hover:text-[#2a3a2a]'
                          : 'bg-[#141c14] border-white/[0.07] text-[#a0b0a0] hover:border-[#5a8a5c]/30 hover:bg-[#1a241a] hover:text-[#c0d0c0]'
                      }`}
                    >
                      <span className="flex items-start gap-2">
                        <span className="text-[#5a8a5c] mt-0.5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform">›</span>
                        {prompt}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-6 w-full max-w-sm grid grid-cols-2 gap-2">
                  {GENERAL_SUGGESTIONS.map(({ icon: Icon, text }, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(text)}
                      className={`text-left text-xs px-3 py-3 rounded-xl border transition-all duration-150 group ${
                        isLight
                          ? 'bg-white border-[#dce8dc] text-[#2a3a2a]/65 hover:border-[#5a8a5c]/40 hover:bg-[#f4fbf4] hover:text-[#2a3a2a]'
                          : 'bg-[#141c14] border-white/[0.07] text-[#8a9a8a] hover:border-[#5a8a5c]/30 hover:bg-[#192019] hover:text-[#b0c0b0]'
                      }`}
                    >
                      <Icon size={14} className="text-[#5a8a5c] mb-2 group-hover:scale-110 transition-transform" />
                      <span className="leading-snug">{text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble key={i} msg={msg} isLight={isLight} />
          ))}

          {(retrieving || (loading && messages[messages.length - 1]?.role !== 'assistant')) && (
            <TypingIndicator retrieving={retrieving} isLight={isLight} />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Scroll fade */}
        <div className={`sticky bottom-0 left-0 right-0 h-6 pointer-events-none ${
          isLight
            ? 'bg-gradient-to-t from-[#fafcfa] to-transparent'
            : 'bg-gradient-to-t from-[#0c110d] to-transparent'
        }`} />
      </div>

      {/* Error banner */}
      {chatError && (
        <div className={`flex-shrink-0 mx-4 mb-2 flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border text-xs ${
          isLight
            ? 'bg-red-50 border-red-200/70 text-red-700'
            : 'bg-red-950/30 border-red-800/40 text-red-400'
        }`}>
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <span className="font-semibold">Error: </span>
            <span className="break-words">{chatError}</span>
          </div>
          <button
            onClick={() => setChatError(null)}
            className="ml-auto flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Input area */}
      <div className={`flex-shrink-0 px-4 pb-4 pt-3 border-t ${
        isLight ? 'border-[#e2eae2] bg-white' : 'border-white/[0.06] bg-[#111711]'
      }`}>
        <div className={`rounded-2xl border transition-all duration-200 ${
          isLight
            ? 'bg-[#f5f9f5] border-[#d8e8d8] focus-within:border-[#5a8a5c]/60 focus-within:shadow-[0_0_0_3px_rgba(90,138,92,0.08)]'
            : 'bg-[#141c14] border-white/[0.08] focus-within:border-[#5a8a5c]/40 focus-within:shadow-[0_0_0_3px_rgba(90,138,92,0.06)]'
        }`}>

          <div className="px-4 pt-3 pb-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about a protocol or workflow..."
              rows={1}
              className={`w-full bg-transparent text-sm resize-none focus:outline-none leading-relaxed ${
                isLight
                  ? 'text-[#1a2a1a] placeholder-[#374137]/30'
                  : 'text-[#d8e4d8] placeholder-[#4a5a4a]'
              }`}
              style={{ maxHeight: '120px' }}
            />
          </div>

          <div className={`flex items-center gap-2 px-3 pb-2.5 pt-1 border-t ${
            isLight ? 'border-[#dce8dc]' : 'border-white/[0.06]'
          }`}>
            <DocumentSelector
              selectedDocIds={selectedDocIds}
              onSelectionChange={setSelectedDocIds}
              isLight={isLight}
            />
            {selectedDocIds.length > 0 && (
              <span className={`text-[11px] truncate max-w-[140px] ${isLight ? 'text-[#374137]/40' : 'text-[#8a9a8a]/70'}`}>
                Scoped to {selectedDocIds.length === 1 ? 'selected doc' : `${selectedDocIds.length} docs`}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className={`text-[10px] hidden sm:block ${isLight ? 'text-[#374137]/30' : 'text-[#4a5a4a]'}`}>
                Enter to send
              </span>
              {loading ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/25 text-red-400 hover:bg-red-500/25 transition-colors text-xs font-medium"
                >
                  <StopCircle size={13} />
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => handleSend()}
                  disabled={!input.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-[#5a9a5c] to-[#3d6b3f] text-white hover:from-[#62a864] hover:to-[#456e47] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs font-medium shadow-sm"
                >
                  <Send size={12} />
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
