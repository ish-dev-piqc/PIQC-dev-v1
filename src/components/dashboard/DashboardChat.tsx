import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, BookOpen, Stethoscope, User, ChevronDown, Search, FileText, ChevronUp, X, Check, Sparkles, Activity, Shield, GitBranch, AlertTriangle, Database, HelpCircle, RefreshCw, Copy, ArrowDown, type LucideIcon } from 'lucide-react';
import { streamDashboardChat, ChatMessage, RagStatus, SourceCitation, ExtendedMessage, supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';

interface Document {
  id: string;
  title: string;
  source: string;
}

// If the assistant produces no first byte within this window, abort and surface
// a timeout error rather than hanging on the typing indicator indefinitely.
const FIRST_BYTE_TIMEOUT_MS = 35_000;

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
    return getDefaultSuggestionsForDoc(docs[0].title);
  }
  const titles = docs.map(d => `"${d.title}"`).join(' and ');
  return [
    `Compare the protocols described in ${titles}`,
    `What do ${titles} have in common?`,
    `Summarize the key differences between ${titles}`,
    `What compliance requirements are shared across ${titles}?`,
  ];
}

function renderLine(
  text: string,
  sources: SourceCitation[] | undefined,
  onCitationClick: ((n: number) => void) | undefined,
  isLight: boolean,
  isUser: boolean
): React.ReactNode[] {
  const parts = text.split(/(\[\d+\]|\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((part, i) => {
    const citationMatch = part.match(/^\[(\d+)\]$/);
    if (citationMatch && sources && onCitationClick) {
      const n = parseInt(citationMatch[1]);
      if (sources.some((s) => s.n === n)) {
        return (
          <button
            key={i}
            onClick={() => onCitationClick(n)}
            title={`Source ${n}`}
            className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-bold leading-none mx-0.5 align-middle transition-colors ${
              isUser
                ? 'bg-white/25 text-white hover:bg-white/40'
                : isLight
                ? 'bg-brand-600/15 text-brand-600 hover:bg-brand-600/30'
                : 'bg-brand-600/20 text-[#6a9fc8] hover:bg-brand-600/40'
            }`}
          >
            {n}
          </button>
        );
      }
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

function SourceDetailPanel({
  source,
  onClose,
  isLight,
}: {
  source: SourceCitation;
  onClose: () => void;
  isLight: boolean;
}) {
  const hasPage = source.page_start !== null;
  const pageLabel = hasPage
    ? `p. ${source.page_start}${source.page_end !== source.page_start ? `–${source.page_end}` : ''}`
    : null;

  return (
    <div
      className={`mt-2 rounded-xl border p-3 text-xs animate-in fade-in slide-in-from-top-1 duration-150 ${
        isLight
          ? 'bg-[#f0f8fb] border-[#c8dce8] text-[#334155]'
          : 'bg-[#0F172A] border-[#253040] text-[#CBD5E1]'
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded text-[9px] font-bold flex-shrink-0 ${
              isLight ? 'bg-brand-600/15 text-brand-600' : 'bg-brand-600/20 text-[#6a9fc8]'
            }`}
          >
            {source.n}
          </span>
          <span className="font-semibold truncate">{source.document_title || 'Untitled'}</span>
        </div>
        <button
          onClick={onClose}
          className={`flex-shrink-0 transition-opacity hover:opacity-100 opacity-50 ${
            isLight ? 'text-[#334155]' : 'text-[#94A3B8]'
          }`}
        >
          <X size={11} />
        </button>
      </div>
      {(pageLabel || source.section_heading) && (
        <div className={`flex items-center flex-wrap gap-x-3 gap-y-0.5 mb-1.5 text-[10px] ${isLight ? 'text-[#334155]/60' : 'text-[#94A3B8]'}`}>
          {pageLabel && <span>📄 {pageLabel}</span>}
          {source.section_heading && <span>§ {source.section_heading}</span>}
        </div>
      )}
      {source.chunk_preview && (
        <p
          className={`text-[11px] leading-relaxed italic border-l-2 pl-2 ${
            isLight
              ? 'border-brand-600/30 text-[#334155]/70'
              : 'border-brand-600/30 text-[#a0b0c0]'
          }`}
        >
          "{source.chunk_preview.trim()}…"
        </p>
      )}
    </div>
  );
}

function RagStatusTag({ ragStatus, isLight }: { ragStatus: RagStatus; isLight: boolean }) {
  if (ragStatus === 'found') {
    return (
      <div className={`flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full w-fit text-[10px] font-medium ${
        isLight ? 'text-[#3a5a85]/70 bg-brand-600/08' : 'text-[#6a8fb8]/60 bg-brand-600/10'
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
        <span>Document search failed — answer based on general knowledge</span>
      </div>
    );
  }

  if (ragStatus === 'stopped') {
    return (
      <div className={`flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full w-fit text-[10px] font-medium ${
        isLight ? 'text-[#334155]/50 bg-[#334155]/06' : 'text-[#94A3B8]/60 bg-white/[0.04]'
      }`}>
        <StopCircle size={9} />
        <span>Response stopped</span>
      </div>
    );
  }

  return null;
}

function MessageBubble({ msg, isLight, onRetry }: { msg: ExtendedMessage; isLight: boolean; onRetry?: () => void }) {
  const isUser = msg.role === 'user';
  const [expandedSource, setExpandedSource] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCitationClick = (n: number) => {
    setExpandedSource((prev) => (prev === n ? null : n));
  };

  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(msg.content)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => { /* clipboard unavailable */ });
  };

  const expandedSourceData = msg.sources?.find((s) => s.n === expandedSource);
  const showCopy = !isUser && !msg.streaming && !msg.error && msg.content.trim().length > 0;
  const showBubble = msg.content.length > 0 || msg.streaming;

  return (
    <div className={`flex gap-3 group ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center shadow-sm ${
        isUser
          ? 'bg-gradient-to-br from-brand-500 to-brand-600'
          : isLight
          ? 'bg-gradient-to-br from-[#e8f0f6] to-[#d4e4ee] border border-[#c8dce4]'
          : 'bg-gradient-to-br from-[#1e2b35] to-[#141d22] border border-[#334155]'
      }`}>
        {isUser
          ? <User size={14} className="text-white" />
          : <BookOpen size={14} className="text-brand-600" />
        }
      </div>

      <div className={`flex flex-col gap-1 max-w-[78%] ${isUser ? 'items-end' : 'items-start'}`}>
        <div className={`flex items-center gap-1.5 px-1 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
          <span className={`text-[10px] font-medium tracking-wide uppercase ${
            isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'
          }`}>
            {isUser ? 'You' : 'Protocol Assistant'}
          </span>
          {showCopy && (
            <button
              onClick={handleCopy}
              aria-label="Copy message"
              title="Copy message"
              className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                isLight ? 'text-[#334155]/40 hover:text-[#334155]/70' : 'text-[#CBD5E1]/30 hover:text-[#CBD5E1]/60'
              }`}
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
          )}
        </div>

        {showBubble && (
          <div className={`rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${
            isUser
              ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white rounded-tr-sm'
              : isLight
              ? 'bg-white text-[#334155] rounded-tl-sm border border-[#E2E8F0] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
              : 'bg-[#171f25] text-[#CBD5E1] rounded-tl-sm border border-white/[0.07] shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
          }`}>
            {msg.content.split('\n').map((line, i) => {
              const lineContent = line.startsWith('- ') ? line.slice(2) : line;
              const rendered = renderLine(
                lineContent,
                msg.sources,
                isUser ? undefined : handleCitationClick,
                isLight,
                isUser
              );
              if (line.startsWith('- ')) {
                return (
                  <div key={i} className="flex gap-2 my-1">
                    <span className={`mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full ${isUser ? 'bg-white/70' : 'bg-brand-600'}`} />
                    <span>{rendered}</span>
                  </div>
                );
              }
              return (
                <p key={i} className={i > 0 && line !== '' ? 'mt-2' : ''}>
                  {rendered}
                </p>
              );
            })}
            {msg.streaming && (
              <span className="inline-block w-0.5 h-4 ml-0.5 bg-brand-600 animate-pulse rounded-full align-middle" />
            )}
          </div>
        )}

        {/* Failed send — inline error with retry, keeps the user's question in place */}
        {msg.error && !msg.streaming && (
          <div className={`flex items-center gap-2 mt-0.5 px-3 py-2 rounded-xl border text-xs ${
            isLight ? 'bg-red-50 border-red-200/70 text-red-700' : 'bg-red-950/30 border-red-800/40 text-red-400'
          }`}>
            <AlertTriangle size={13} className="flex-shrink-0" />
            <span className="min-w-0 break-words">{msg.error}</span>
            {onRetry && (
              <button
                onClick={onRetry}
                className={`ml-1 flex-shrink-0 inline-flex items-center gap-1 font-medium transition-opacity hover:opacity-80 ${
                  isLight ? 'text-red-700' : 'text-red-300'
                }`}
              >
                <RefreshCw size={11} />
                Retry
              </button>
            )}
          </div>
        )}

        {/* Citation expand panel */}
        {expandedSourceData && (
          <div className="w-full">
            <SourceDetailPanel
              source={expandedSourceData}
              onClose={() => setExpandedSource(null)}
              isLight={isLight}
            />
          </div>
        )}

        {!isUser && !msg.streaming && msg.ragStatus && (
          <RagStatusTag ragStatus={msg.ragStatus} isLight={isLight} />
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
          ? 'bg-gradient-to-br from-[#e8f0f6] to-[#d4e4ee] border border-[#c8dce4]'
          : 'bg-gradient-to-br from-[#1e2b35] to-[#141d22] border border-[#334155]'
      }`}>
        <BookOpen size={14} className="text-brand-600" />
      </div>
      <div className="flex flex-col gap-1 items-start">
        <span className={`text-[10px] font-medium tracking-wide uppercase px-1 ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>
          Protocol Assistant
        </span>
        <div className={`rounded-2xl rounded-tl-sm px-4 py-3 flex gap-2 items-center shadow-sm ${
          isLight
            ? 'bg-white border border-[#E2E8F0] shadow-[0_1px_4px_rgba(0,0,0,0.06)]'
            : 'bg-[#171f25] border border-white/[0.07] shadow-[0_1px_4px_rgba(0,0,0,0.3)]'
        }`}>
          {retrieving ? (
            <>
              <Search size={13} className="text-brand-600 animate-pulse flex-shrink-0" />
              <span className={`text-xs ${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/40'}`}>Searching knowledge base...</span>
            </>
          ) : (
            <div className="flex gap-1.5 items-center">
              <span className="w-2 h-2 rounded-full bg-brand-600/70 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-brand-600/70 animate-bounce" style={{ animationDelay: '160ms' }} />
              <span className="w-2 h-2 rounded-full bg-brand-600/70 animate-bounce" style={{ animationDelay: '320ms' }} />
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
      .eq('status', 'ready')
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
            ? 'bg-brand-600/15 border-brand-600/40 text-brand-600'
            : isLight
            ? 'bg-transparent border-[#E2E8F0] text-[#334155]/50 hover:text-[#334155]/80 hover:border-[#CBD5E1]'
            : 'bg-transparent border-white/10 text-[#CBD5E1]/40 hover:text-[#CBD5E1]/70 hover:border-white/15'
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
            ? 'bg-white border-[#E2E8F0] shadow-[#0F172A]/12'
            : 'bg-[#0F172A] border-white/10 shadow-black/40'
        }`}>
          <div className={`px-3 py-2.5 border-b flex items-center justify-between ${
            isLight ? 'border-[#eef4f8]' : 'border-white/5'
          }`}>
            <span className={`text-[10px] font-semibold uppercase tracking-widest ${
              isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/35'
            }`}>Filter by document</span>
            {selectedDocIds.length > 0 && (
              <button
                onClick={() => onSelectionChange([])}
                className={`text-xs transition-colors flex items-center gap-1 ${
                  isLight
                    ? 'text-[#334155]/40 hover:text-[#334155]/70'
                    : 'text-[#CBD5E1]/30 hover:text-[#CBD5E1]/60'
                }`}
              >
                <X size={10} />
                Clear all
              </button>
            )}
          </div>

          <div className="max-h-56 overflow-y-auto">
            {loading ? (
              <div className={`px-3 py-5 text-xs text-center ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>Loading documents...</div>
            ) : docs.length === 0 ? (
              <div className={`px-3 py-5 text-xs text-center ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>No documents in knowledge base</div>
            ) : (
              docs.map(doc => {
                const selected = selectedDocIds.includes(doc.id);
                return (
                  <button
                    key={doc.id}
                    onClick={() => toggle(doc.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                      selected
                        ? isLight ? 'bg-brand-600/08' : 'bg-brand-600/12'
                        : isLight ? 'hover:bg-[#f5f9fc]' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    <div className={`flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                      selected
                        ? 'bg-brand-600 border-brand-600'
                        : isLight ? 'border-[#CBD5E1] bg-transparent' : 'border-white/20 bg-transparent'
                    }`}>
                      {selected && <Check size={9} className="text-white" />}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-sm truncate leading-tight font-medium ${isLight ? 'text-[#334155]' : 'text-[#CBD5E1]'}`}>{doc.title || 'Untitled'}</p>
                      {doc.source && (
                        <p className={`text-xs truncate mt-0.5 ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>{doc.source}</p>
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

interface ChatSuggestion {
  icon: LucideIcon;
  text: string;
}

interface DashboardChatProps {
  messages: ExtendedMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ExtendedMessage[]>>;
  // Optional in protocol-scoped mode (Ask), where the server derives scope from
  // protocolId and the document selector is hidden. Required for Audit Mode.
  selectedDocIds?: string[];
  setSelectedDocIds?: (ids: string[]) => void;
  // When set, retrieval is scoped server-side to this protocol's documents; the
  // document selector and its org-wide fetch are suppressed. Absent = Audit Mode.
  protocolId?: string;
  // When true, an in-flight stream is aborted on unmount. Ask sets this so
  // collapsing/switching stops generation; Audit leaves it false so a stream
  // completes in the background while the user is on another tab.
  abortOnUnmount?: boolean;
  // Optional: override the default empty-state suggestion chips. Used by
  // AskTab to inject protocol-specific prompts when scoped to a study.
  customSuggestions?: ChatSuggestion[];
  // Optional: override the empty-state title/subtitle for context-scoped use.
  emptyHeading?: string;
  emptySubtext?: string;
  // Optional: suppress the "Protocol Assistant" header strip. Used by AskTab
  // inside AskBubble, where the bubble already provides a "Protocol Assistant"
  // header — rendering this one too produces three stacked title rows.
  // Defaults to false so Audit Mode's call site is unchanged.
  hideHeader?: boolean;
}

export default function DashboardChat({
  messages,
  setMessages,
  selectedDocIds = [],
  setSelectedDocIds,
  protocolId,
  abortOnUnmount = false,
  customSuggestions,
  emptyHeading,
  emptySubtext,
  hideHeader = false,
}: DashboardChatProps) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [retrieving, setRetrieving] = useState(false);
  const [allDocs, setAllDocs] = useState<Document[]>([]);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const showEmpty = messages.length === 0;

  // Org-wide document list backs the selector + doc-scoped suggestions. In
  // protocol-scoped mode the selector is hidden and scope is server-enforced,
  // so skip the fetch entirely.
  useEffect(() => {
    if (protocolId) return;
    supabase
      .from('documents')
      .select('id, title, source')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => setAllDocs(data ?? []));
  }, [protocolId]);

  // Abort any in-flight stream on unmount when opted in (Ask). No-op for Audit.
  useEffect(() => {
    if (!abortOnUnmount) return;
    return () => abortRef.current?.abort();
  }, [abortOnUnmount]);

  // Only auto-scroll if the user is already near the bottom; otherwise surface a
  // "jump to latest" pill instead of yanking them down on every token.
  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    nearBottomRef.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    nearBottomRef.current = true;
    setShowScrollButton(false);
  };

  useEffect(() => {
    if (nearBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const selectedDocs = allDocs.filter(d => selectedDocIds.includes(d.id));
  const docSuggestions = getSuggestionsForDocs(selectedDocs);

  const handleSend = useCallback(async (text?: string, historyOverride?: ChatMessage[]) => {
    const content = (text ?? input).trim();
    if (!content || loading) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    const history: ChatMessage[] = historyOverride ?? messages
      .filter(m => !m.streaming && !m.error)
      .map(m => ({ role: m.role, content: m.content }));
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
    let assistantAdded = false;
    let finalRagStatus: RagStatus | undefined = undefined;
    let finalRagError = '';
    let collectedSources: SourceCitation[] = [];
    let failMessage: string | null = null;
    let stopped = false;
    let timedOut = false;

    // Abort if the assistant produces no first byte in time, so the UI never
    // hangs on the typing indicator when the server stalls before responding.
    const timeoutId = setTimeout(() => {
      if (firstToken) { timedOut = true; ac.abort(); }
    }, FIRST_BYTE_TIMEOUT_MS);

    try {
      const result = await streamDashboardChat({
        message: content,
        history,
        selectedDocIds: protocolId ? [] : selectedDocIds,
        protocolId: protocolId ?? null,
        onChunk: (token) => {
          if (firstToken) {
            firstToken = false;
            assistantAdded = true;
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
        onSources: (sources) => { collectedSources = sources; },
        signal: ac.signal,
      });
      finalRagStatus = result.ragStatus;
      finalRagError = result.ragError;
      if (result.sources.length > 0) collectedSources = result.sources;
      // Stream resolved without ever producing a token → surface as an error
      // instead of a silent no-op.
      if (firstToken) {
        failMessage = 'The assistant did not return a response. Please try again.';
      }
    } catch (err: unknown) {
      const e = err as { name?: string; message?: string };
      if (e.name === 'AbortError') {
        if (timedOut) failMessage = 'No response within 35 seconds — the request was stopped.';
        else stopped = true;
      } else {
        failMessage = e.message || 'Something went wrong. Please try again.';
      }
    } finally {
      clearTimeout(timeoutId);
      setRetrieving(false);
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (failMessage) {
          if (assistantAdded && last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, streaming: false, error: failMessage };
          } else {
            updated.push({ role: 'assistant', content: '', error: failMessage });
          }
        } else if (stopped) {
          if (assistantAdded && last?.role === 'assistant') {
            updated[updated.length - 1] = { ...last, streaming: false, ragStatus: 'stopped' };
          } else {
            updated.push({ role: 'assistant', content: '', error: 'Stopped before a response was received.' });
          }
        } else if (last?.role === 'assistant') {
          updated[updated.length - 1] = {
            ...last,
            streaming: false,
            ragStatus: finalRagStatus,
            ragError: finalRagError,
            sources: collectedSources.length > 0 ? collectedSources : undefined,
          };
        }
        return updated;
      });
      setLoading(false);
      abortRef.current = null;
      textareaRef.current?.focus();
    }
  }, [input, loading, messages, selectedDocIds, protocolId, setMessages]);

  // Retry a failed send: drop the failed assistant bubble and its user turn,
  // then re-ask with the history that preceded it.
  const handleRetry = useCallback((failedIdx: number) => {
    let userIdx = -1;
    for (let i = failedIdx; i >= 0; i--) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;
    const userContent = messages[userIdx].content;
    const priorHistory: ChatMessage[] = messages
      .slice(0, userIdx)
      .filter(m => !m.streaming && !m.error)
      .map(m => ({ role: m.role, content: m.content }));
    setMessages(prev => prev.slice(0, userIdx));
    handleSend(userContent, priorHistory);
  }, [messages, setMessages, handleSend]);

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
    : 'bg-brand-400';

  return (
    <div className={`flex flex-col h-full ${isLight ? 'bg-[#fafcfd]' : 'bg-[#0c1118]'}`}>

      {/* Header — hidden when consumed from AskBubble (which provides its own
          "Protocol Assistant" title). Defaults to visible for Audit Mode. */}
      {!hideHeader && (
        <div className={`flex-shrink-0 px-5 py-3.5 border-b ${
          isLight
            ? 'border-[#e2eaf0] bg-white'
            : 'border-white/[0.06] bg-[#11171d]'
        }`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-sm ${
              isLight
                ? 'bg-gradient-to-br from-[#dceaf0] to-[#c4d8e4]'
                : 'bg-gradient-to-br from-[#1e2e38] to-[#162026]'
            }`}>
              <BookOpen size={17} className="text-[#4a7aa8]" />
            </div>
            <div>
              <h2 className={`font-semibold text-sm leading-tight ${isLight ? 'text-[#1E293B]' : 'text-[#e0e8f0]'}`}>
                Protocol Assistant
              </h2>
              <p className={`text-[11px] leading-tight mt-0.5 ${isLight ? 'text-[#334155]/50' : 'text-[#94A3B8]'}`}>
                Clinical knowledge at your fingertips
              </p>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full transition-colors duration-500 ${statusColor} ${loading ? '' : 'animate-pulse'}`} />
              <span className={`text-[11px] font-medium transition-all duration-300 ${isLight ? 'text-[#334155]/50' : 'text-[#94A3B8]'}`}>
                {statusLabel}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto scroll-smooth relative">
        <div className="px-5 py-5 space-y-5">

          {showEmpty && (
            <div className="flex flex-col items-center justify-center min-h-[280px] text-center pt-4 pb-2">
              <div className="relative mb-5">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-md ${
                  isLight
                    ? 'bg-gradient-to-br from-[#dceaf0] to-[#bdd4e0]'
                    : 'bg-gradient-to-br from-[#1e2e38] to-[#162026]'
                }`}>
                  <Stethoscope size={28} className="text-[#4a7aa8]" />
                </div>
                <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shadow-sm">
                  <Sparkles size={10} className="text-white" />
                </div>
              </div>
              <h3 className={`font-bold text-lg mb-2 tracking-tight ${isLight ? 'text-[#1E293B]' : 'text-[#e0e8f0]'}`}>
                {emptyHeading ?? 'Clinical Protocol Assistant'}
              </h3>
              <p className={`text-sm max-w-[280px] leading-relaxed ${isLight ? 'text-[#334155]/55' : 'text-[#94A3B8]'}`}>
                {emptySubtext ??
                  'Ask me about care protocols, workflows, compliance requirements, or anything in your knowledge base.'}
              </p>

              {customSuggestions && customSuggestions.length > 0 ? (
                <div className="mt-6 w-full max-w-sm grid grid-cols-2 gap-2">
                  {customSuggestions.map(({ icon: Icon, text }, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(text)}
                      className={`text-left text-xs px-3 py-3 rounded-xl border transition-all duration-150 group ${
                        isLight
                          ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-brand-600/40 hover:bg-[#f4fbfd] hover:text-[#334155]'
                          : 'bg-[#0F172A] border-white/[0.07] text-[#94A3B8] hover:border-brand-600/30 hover:bg-[#192027] hover:text-[#b0c0cc]'
                      }`}
                    >
                      <Icon size={14} className="text-brand-600 mb-2 group-hover:scale-110 transition-transform" />
                      <span className="leading-snug">{text}</span>
                    </button>
                  ))}
                </div>
              ) : docSuggestions.length > 0 ? (
                <div className="mt-6 w-full max-w-sm space-y-2">
                  <p className={`text-[10px] font-semibold uppercase tracking-widest mb-3 ${isLight ? 'text-[#334155]/35' : 'text-[#94A3B8]/60'}`}>
                    Suggested for selected documents
                  </p>
                  {docSuggestions.slice(0, 4).map((prompt, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(prompt)}
                      className={`w-full text-left text-xs px-3.5 py-2.5 rounded-xl border transition-all duration-150 leading-relaxed group ${
                        isLight
                          ? 'bg-white border-[#E2E8F0] text-[#334155]/70 hover:border-brand-600/40 hover:bg-[#f0f8fb] hover:text-[#334155]'
                          : 'bg-[#0F172A] border-white/[0.07] text-[#a0b0c4] hover:border-brand-600/30 hover:bg-[#1a242a] hover:text-[#c0d0dc]'
                      }`}
                    >
                      <span className="flex items-start gap-2">
                        <span className="text-brand-600 mt-0.5 flex-shrink-0 group-hover:translate-x-0.5 transition-transform">›</span>
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
                          ? 'bg-white border-[#E2E8F0] text-[#334155]/65 hover:border-brand-600/40 hover:bg-[#f4fbfd] hover:text-[#334155]'
                          : 'bg-[#0F172A] border-white/[0.07] text-[#94A3B8] hover:border-brand-600/30 hover:bg-[#192027] hover:text-[#b0c0cc]'
                      }`}
                    >
                      <Icon size={14} className="text-brand-600 mb-2 group-hover:scale-110 transition-transform" />
                      <span className="leading-snug">{text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={i}
              msg={msg}
              isLight={isLight}
              onRetry={msg.error ? () => handleRetry(i) : undefined}
            />
          ))}

          {(retrieving || (loading && messages[messages.length - 1]?.role !== 'assistant')) && (
            <TypingIndicator retrieving={retrieving} isLight={isLight} />
          )}

          <div ref={bottomRef} />
        </div>

        {/* Jump to latest — shown only when the user has scrolled up */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            aria-label="Scroll to latest message"
            className={`sticky bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium shadow-lg transition-colors ${
              isLight
                ? 'bg-white border-[#E2E8F0] text-[#334155]/70 hover:text-[#334155]'
                : 'bg-[#171f25] border-white/10 text-[#CBD5E1]/70 hover:text-[#CBD5E1]'
            }`}
          >
            <ArrowDown size={12} />
            New messages
          </button>
        )}

        {/* Scroll fade */}
        <div className={`sticky bottom-0 left-0 right-0 h-6 pointer-events-none ${
          isLight
            ? 'bg-gradient-to-t from-[#fafcfd] to-transparent'
            : 'bg-gradient-to-t from-[#0c1118] to-transparent'
        }`} />
      </div>

      {/* Input area */}
      <div className={`flex-shrink-0 px-4 pb-4 pt-3 border-t ${
        isLight ? 'border-[#e2eaf0] bg-white' : 'border-white/[0.06] bg-[#11171d]'
      }`}>
        <div className={`rounded-2xl border transition-all duration-200 ${
          isLight
            ? 'bg-[#f5f9fc] border-[#d8e8f0] focus-within:border-brand-600/60 focus-within:shadow-[0_0_0_3px_rgb(var(--brand-600) / 0.08)]'
            : 'bg-[#0F172A] border-white/[0.08] focus-within:border-brand-600/40 focus-within:shadow-[0_0_0_3px_rgb(var(--brand-600) / 0.06)]'
        }`}>

          <div className="px-4 pt-3 pb-2">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              aria-label="Ask a question"
              placeholder="Ask about a protocol or workflow..."
              rows={1}
              className={`w-full bg-transparent text-sm resize-none focus:outline-none leading-relaxed ${
                isLight
                  ? 'text-[#1E293B] placeholder-[#334155]/30'
                  : 'text-[#E2E8F0] placeholder-[#4a5a6a]'
              }`}
              style={{ maxHeight: '120px' }}
            />
          </div>

          <div className={`flex items-center gap-2 px-3 pb-2.5 pt-1 border-t ${
            isLight ? 'border-[#E2E8F0]' : 'border-white/[0.06]'
          }`}>
            {/* Protocol-scoped mode (Ask) hides the selector — scope is fixed to
                the protocol and enforced server-side. Audit Mode keeps it. */}
            {!protocolId && (
              <>
                <DocumentSelector
                  selectedDocIds={selectedDocIds}
                  onSelectionChange={setSelectedDocIds ?? (() => {})}
                  isLight={isLight}
                />
                {selectedDocIds.length > 0 && (
                  <span className={`text-[11px] truncate max-w-[140px] ${isLight ? 'text-[#334155]/40' : 'text-[#94A3B8]/70'}`}>
                    Scoped to {selectedDocIds.length === 1 ? 'selected doc' : `${selectedDocIds.length} docs`}
                  </span>
                )}
              </>
            )}

            <div className="ml-auto flex items-center gap-2">
              <span className={`text-[10px] hidden sm:block ${isLight ? 'text-[#334155]/30' : 'text-[#4a5a6a]'}`}>
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
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 text-white hover:from-[#62a8c4] hover:to-[#456ea8] disabled:opacity-30 disabled:cursor-not-allowed transition-all text-xs font-medium shadow-sm"
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
