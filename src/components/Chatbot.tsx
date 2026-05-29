import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Stethoscope, CircleUser as UserCircle } from 'lucide-react';
import { streamChatFunction, ChatMessage } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';

const GREETING: ChatMessage = {
  role: 'assistant',
  content: "Hi — I'm the PIQClinical assistant. I can walk you through how the platform works, what Site Mode and Audit Mode do, how pricing fits, or anything else about PIQClinical. What would you like to know?",
};

function AssistantAvatar({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-8 h-8' : 'w-7 h-7';
  const icon = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-[#74B4DC] to-[#017BC8] flex items-center justify-center flex-shrink-0 shadow-md`}>
      <Stethoscope className={`${icon} text-white`} strokeWidth={2} />
    </div>
  );
}

function UserAvatar({ isLight }: { isLight: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 ${
      isLight
        ? 'bg-gradient-to-br from-[#e8eef4] to-[#E2E8F0] border-[#CBD5E1]'
        : 'bg-gradient-to-br from-[#334155] to-[#2a2a2a] border-white/10'
    }`}>
      <UserCircle className={`w-5 h-5 ${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/60'}`} strokeWidth={1.5} />
    </div>
  );
}

function TypingIndicator({ isLight }: { isLight: boolean }) {
  return (
    <div className="flex items-end gap-2.5">
      <AssistantAvatar />
      <div className={`rounded-2xl rounded-bl-sm px-4 py-3 border ${
        isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#0F172A] border-white/[0.07]'
      }`}>
        <div className="flex gap-1 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[#74B4DC]/60 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#74B4DC]/60 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#74B4DC]/60 animate-bounce [animation-delay:300ms]" />
        </div>
      </div>
    </div>
  );
}

interface BubbleProps {
  message: ChatMessage;
  streaming?: boolean;
  isLight: boolean;
}

function renderContent(text: string) {
  const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={i} className="italic">{part.slice(1, -1)}</em>;
    }
    return <span key={i}>{part}</span>;
  });
}

function MessageBubble({ message, streaming, isLight }: BubbleProps) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex items-end gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}>
      {!isUser && <AssistantAvatar />}
      {isUser && <UserAvatar isLight={isLight} />}
      <div
        className={`max-w-[78%] px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-[#017BC8] text-white rounded-2xl rounded-br-sm'
            : isLight
            ? 'bg-[#F8FAFC] border border-[#E2E8F0] text-[#334155]/90 rounded-2xl rounded-bl-sm'
            : 'bg-[#0F172A] border border-white/[0.07] text-[#CBD5E1]/90 rounded-2xl rounded-bl-sm'
        }`}
      >
        {message.content.split('\n').map((line, i, arr) => (
          <span key={i}>
            {renderContent(line)}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
        {streaming && (
          <span className="inline-block w-0.5 h-3.5 bg-[#74B4DC]/60 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

export default function Chatbot() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING]);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  function playNotification() {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.22);
    } catch {
      // audio not available
    }
  }

  useEffect(() => {
    if (open) {
      setTimeout(() => textareaRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, loading]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const historyForRequest = [...messages].filter(
      (m) => m.role === 'user' || m.role === 'assistant'
    );

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError(null);
    setLoading(true);
    setStreamingContent('');

    abortRef.current = new AbortController();

    try {
      let accumulated = '';

      await streamChatFunction(
        text,
        historyForRequest,
        (token) => {
          accumulated += token;
          setStreamingContent(accumulated);
        },
        abortRef.current.signal
      );

      const assistantMsg: ChatMessage = { role: 'assistant', content: accumulated || 'Sorry, I could not generate a response.' };
      setMessages((prev) => [...prev, assistantMsg]);
      playNotification();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setStreamingContent(null);
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  return (
    <>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {open && (
          <div className={`w-[360px] sm:w-[400px] h-[520px] flex flex-col rounded-2xl shadow-2xl border overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200 ${
            isLight
              ? 'border-[#E2E8F0] bg-white shadow-[#0F172A]/10'
              : 'border-white/[0.08] bg-[#020617]'
          }`}>
            <div className={`flex items-center gap-3 px-4 py-3.5 border-b flex-shrink-0 ${
              isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#0F172A] border-white/[0.07]'
            }`}>
              <AssistantAvatar size="md" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold leading-none ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>PIQClinical Assistant</p>
                <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  Online
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className={`p-1.5 rounded-lg transition-colors ${
                  isLight
                    ? 'text-[#334155]/50 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.06]'
                    : 'text-[#CBD5E1]/50 hover:text-white hover:bg-white/[0.07]'
                }`}
                aria-label="Close chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scrollbar-thin">
              {messages.map((msg, i) => (
                <MessageBubble key={i} message={msg} isLight={isLight} />
              ))}
              {streamingContent !== null && streamingContent === '' && loading && (
                <TypingIndicator isLight={isLight} />
              )}
              {streamingContent !== null && streamingContent !== '' && (
                <MessageBubble
                  message={{ role: 'assistant', content: streamingContent }}
                  streaming
                  isLight={isLight}
                />
              )}
              {error && (
                <p className="text-xs text-red-400 text-center px-2">{error}</p>
              )}
              <div ref={bottomRef} />
            </div>

            <div className={`px-4 py-3 border-t flex-shrink-0 ${
              isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#0F172A] border-white/[0.07]'
            }`}>
              <div className={`flex items-end gap-2 border rounded-xl px-3 py-2 transition-colors ${
                isLight
                  ? 'bg-white border-[#E2E8F0] focus-within:border-[#017BC8]/50'
                  : 'bg-[#0F172A] border-white/[0.08] focus-within:border-[#017BC8]/50'
              }`}>
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={loading}
                  placeholder="Ask about PIQClinical…"
                  rows={1}
                  className={`flex-1 bg-transparent text-sm outline-none resize-none overflow-y-auto disabled:opacity-50 leading-relaxed py-0.5 ${
                    isLight ? 'text-[#0F172A] placeholder-[#334155]/30' : 'text-white placeholder-[#334155]'
                  }`}
                  style={{ maxHeight: '140px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="p-1.5 rounded-lg bg-[#017BC8] text-white hover:bg-[#1595D1] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 mb-0.5"
                  aria-label="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className={`text-[10px] text-center mt-2 ${isLight ? 'text-[#334155]/30' : 'text-[#CBD5E1]/25'}`}>
                Enter to send · Shift+Enter for new line
              </p>
            </div>
          </div>
        )}

        <button
          onClick={() => setOpen((v) => !v)}
          className={`w-14 h-14 rounded-full shadow-lg flex items-center justify-center transition-all duration-200 ${
            open
              ? isLight
                ? 'bg-[#F2F2F2] border border-[#E2E8F0] text-[#334155]/60 hover:text-[#0F172A]'
                : 'bg-[#0F172A] border border-white/[0.1] text-[#CBD5E1]/70 hover:text-white'
              : 'bg-[#017BC8] hover:bg-[#1595D1] text-white shadow-[#017BC8]/30'
          }`}
          aria-label={open ? 'Close chat' : 'Open chat'}
        >
          {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>
    </>
  );
}
