import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

const tabScopedStorage =
  typeof window !== 'undefined'
    ? window.sessionStorage
    : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      };

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: tabScopedStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type RagStatus = 'found' | 'not_found' | 'error';

export interface SourceCitation {
  n: number;
  document_id: string;
  document_title: string;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  chunk_preview: string;
}

export interface StreamDashboardChatResult {
  ragStatus: RagStatus;
  ragError: string;
  sources: SourceCitation[];
}

export async function streamDashboardChat(
  message: string,
  history: ChatMessage[],
  selectedDocIds: string[],
  onChunk: (token: string) => void,
  onSources?: (sources: SourceCitation[]) => void,
  signal?: AbortSignal
): Promise<StreamDashboardChatResult> {
  const response = await fetch(`${supabaseUrl}/functions/v1/dashboard-chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${supabaseAnonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, history, selectedDocIds }),
    signal,
  });

  if (!response.ok || !response.body) {
    let detail = '';
    try {
      const body = await response.clone().json();
      detail = body?.detail || body?.error || '';
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
