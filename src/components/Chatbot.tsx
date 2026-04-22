import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageCircle, X, Send, Stethoscope, CircleUser as UserCircle } from 'lucide-react';
import { streamChatFunction, ChatMessage } from '../lib/supabase';
import { useTheme } from '../context/ThemeContext';

const GREETING: ChatMessage = {
  role: 'assistant',
  content: "Hi there! I'm your PIQClinical care guide. I know healthcare can feel overwhelming at times, so I'm here to make things a little easier. Whether you have questions about our platform, clinical workflows, or just want to understand how we can support your team — I'm all yours. How can I help you today?",
};

function AssistantAvatar({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'md' ? 'w-8 h-8' : 'w-7 h-7';
  const icon = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  return (
    <div className={`${dim} rounded-full bg-gradient-to-br from-[#6e8fb5] to-[#4a6fa5] flex items-center justify-center flex-shrink-0 shadow-md`}>
      <Stethoscope className={`${icon} text-white`} strokeWidth={2} />
    </div>
  );
}

function UserAvatar({ isLight }: { isLight: boolean }) {
  return (
    <div className={`w-7 h-7 rounded-full border flex items-center justify-center flex-shrink-0 ${
      isLight
        ? 'bg-gradient-to-br from-[#e8eef4] to-[#d8e4ee] border-[#c8d8e4]'
        : 'bg-gradient-to-br from-[#3c3c3c] to-[#2a2a2a] border-white/10'
    }`}>
      <UserCircle className={`w-5 h-5 ${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/60'}`} strokeWidth={1.5} />
    </div>
  );
}

function TypingIndicator({ isLight }: { isLight: boolean }) {
  return (
    <div className="flex items-end gap-2.5">
      <AssistantAvatar />
      <div className={`rounded-2xl rounded-bl-sm px-4 py-3 border ${
        isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#161d25] border-white/[0.07]'
      }`}>
        <div className="flex gap-1 items-center h-4">
          <span className="w-1.5 h-1.5 rounded-full bg-[#6e8fb5]/60 animate-bounce [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#6e8fb5]/60 animate-bounce [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-[#6e8fb5]/60 animate-bounce [animation-delay:300ms]" />
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
            ? 'bg-[#4a6fa5] text-white rounded-2xl rounded-br-sm'
            : isLight
            ? 'bg-[#f5f7fa] border border-[#e2e8ee] text-[#374152]/90 rounded-2xl rounded-bl-sm'
            : 'bg-[#161d25] border border-white/[0.07] text-[#d2d7e0]/90 rounded-2xl rounded-bl-sm'
        }`}
      >
        {message.content.split('\n').map((line, i, arr) => (
          <span key={i}>
            {renderContent(line)}
            {i < arr.length - 1 && <br />}
          </span>
        ))}
        {streaming && (
          <span className="inline-block w-0.5 h-3.5 bg-[#6e8fb5]/60 ml-0.5 align-middle animate-pulse" />
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
              ? 'border-[#e2e8ee] bg-white shadow-[#1a1f28]/10'
              : 'border-white/[0.08] bg-[#0d1118]'
          }`}>
            <div className={`flex items-center gap-3 px-4 py-3.5 border-b flex-shrink-0 ${
              isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#131a22] border-white/[0.07]'
            }`}>
              <AssistantAvatar size="md" />
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-semibold leading-none ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>PIQClinical Assistant</p>
                <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  Online
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className={`p-1.5 rounded-lg transition-colors ${
                  isLight
                    ? 'text-[#374152]/50 hover:text-[#1a1f28] hover:bg-[#1a1f28]/[0.06]'
                    : 'text-[#d2d7e0]/50 hover:text-white hover:bg-white/[0.07]'
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
              isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#131a22] border-white/[0.07]'
            }`}>
              <div className={`flex items-end gap-2 border rounded-xl px-3 py-2 transition-colors ${
                isLight
                  ? 'bg-white border-[#e2e8ee] focus-within:border-[#4a6fa5]/50'
                  : 'bg-[#161d25] border-white/[0.08] focus-within:border-[#4a6fa5]/50'
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
                    isLight ? 'text-[#1a1f28] placeholder-[#374152]/30' : 'text-white placeholder-[#3c3c3c]'
                  }`}
                  style={{ maxHeight: '140px' }}
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || loading}
                  className="p-1.5 rounded-lg bg-[#4a6fa5] text-white hover:bg-[#5b82b8] disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0 mb-0.5"
                  aria-label="Send message"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className={`text-[10px] text-center mt-2 ${isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/25'}`}>
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
                ? 'bg-[#f0f4f8] border border-[#d8e4ee] text-[#374152]/60 hover:text-[#1a1f28]'
                : 'bg-[#161d25] border border-white/[0.1] text-[#d2d7e0]/70 hover:text-white'
              : 'bg-[#4a6fa5] hover:bg-[#5b82b8] text-white shadow-[#4a6fa5]/30'
          }`}
          aria-label={open ? 'Close chat' : 'Open chat'}
        >
          {open ? <X className="w-5 h-5" /> : <MessageCircle className="w-6 h-6" />}
        </button>
      </div>
    </>
  );
}
