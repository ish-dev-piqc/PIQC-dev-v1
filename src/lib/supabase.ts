import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const persistentStorage =
  typeof window !== 'undefined'
    ? window.localStorage
    : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: persistentStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// 'stopped' is assigned client-side when a stream is aborted (user Stop, panel
// collapse, protocol switch). The server never sends it.
export type RagStatus = 'found' | 'not_found' | 'error' | 'stopped';

export interface SourceCitation {
  n: number;
  document_id: string;
  document_title: string;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  chunk_preview: string;
}

// The chat message shape the UI actually renders. Lives here (not in a
// component) so the site lib and the shared DashboardChat engine share one
// definition. `error` marks a failed send on an assistant bubble to drive Retry
// and is never persisted; `streaming` is transient too.
export interface ExtendedMessage extends ChatMessage {
  streaming?: boolean;
  ragStatus?: RagStatus;
  ragError?: string;
  sources?: SourceCitation[];
  error?: string;
}

export interface StreamDashboardChatResult {
  ragStatus: RagStatus;
  ragError: string;
  sources: SourceCitation[];
}

export interface StreamDashboardChatOptions {
  message: string;
  history: ChatMessage[];
  selectedDocIds: string[];
  /** When set, the server scopes retrieval to this protocol's documents. */
  protocolId?: string | null;
  onChunk: (token: string) => void;
  onSources?: (sources: SourceCitation[]) => void;
  signal?: AbortSignal;
}

async function getAuthToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? supabaseAnonKey;
}

export async function streamDashboardChat(
  opts: StreamDashboardChatOptions
): Promise<StreamDashboardChatResult> {
  const { message, history, selectedDocIds, protocolId, onChunk, onSources, signal } = opts;
  const token = await getAuthToken();
  const response = await fetch(`${supabaseUrl}/functions/v1/dashboard-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      history,
      selectedDocIds,
      ...(protocolId ? { protocolId } : {}),
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = '';
    try {
      const body = await response.clone().json();
      detail = body?.error || body?.detail || '';
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new Error(detail || 'Failed to reach chat service');
  }

  const ragStatus = (response.headers.get('X-Rag-Status') ?? 'not_found') as RagStatus;
  const ragError = response.headers.get('X-Rag-Error') ?? '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sources: SourceCitation[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return { ragStatus, ragError, sources };
      try {
        const parsed = JSON.parse(payload);
        if (parsed?.type === 'sources' && Array.isArray(parsed.sources)) {
          sources = parsed.sources as SourceCitation[];
          onSources?.(sources);
          continue;
        }
        const token = parsed?.choices?.[0]?.delta?.content;
        if (typeof token === 'string') onChunk(token);
      } catch {
        // skip malformed lines
      }
    }
  }

  return { ragStatus, ragError, sources };
}

export async function streamChatFunction(
  message: string,
  history: ChatMessage[],
  onChunk: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, history }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error('Failed to reach chat service');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const parsed = JSON.parse(payload);
        const token = parsed?.choices?.[0]?.delta?.content;
        if (typeof token === 'string') onChunk(token);
      } catch {
        // skip malformed lines
      }
    }
  }
}
