import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';

interface Document {
  id: string;
  title: string;
  filename: string | null;
  created_at: string;
  chunk_count?: number;
  status?: string;
  error_message?: string | null;
}

interface UploadState {
  // 'parsing' = ingest returned 202 (PDF in async Reducto pipeline). The
  // UploadForm polls /ingest-status every POLL_INTERVAL_MS while in this
  // state until Reducto reports done or failed. The documents realtime
  // channel in SiteDataContext also catches the eventual status flip; the
  // polling is the active driver that calls processIngestCompletion when
  // Reducto reports completion.
  status: 'idle' | 'uploading' | 'parsing' | 'success' | 'error';
  message: string;
  chunks?: number;
  // Set while in 'parsing' so the poll loop knows what to check.
  pendingDocumentId?: string;
}

// Polling cadence: ~30 polls over a typical 5-minute parse window. Each poll
// is cheap (Reducto job-status call is sub-second) until the parse actually
// completes, at which point the SAME function call runs the heavy
// completion pipeline (~60–120s). One slow tick rather than many.
const POLL_INTERVAL_MS = 10_000;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Shape of the JSON the ingest edge function returns. Three terminal-ish
// shapes the frontend cares about:
//
//   200 + status='ready'                — text upload finished synchronously,
//                                          or PDF deduped to an existing ready doc
//   200 + status='ready' + deduped=true — re-upload of an already-completed PDF
//   202 + status='pending'              — PDF kicked off async; client waits
//                                          for realtime on documents to flip
//                                          status to 'ready' or 'failed'
//
// chunks_created is only present on the sync text path.
export interface IngestResponse {
  success: true;
  document_id: string;
  protocol_id?: string | null;
  chunks_created?: number;
  status?: 'pending' | 'ready' | 'failed';
  deduped?: boolean;
}

export function UploadForm({
  onSuccess,
  isLight,
}: {
  onSuccess: (data: IngestResponse) => void;
  isLight: boolean;
}) {
  const [title, setTitle] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<UploadState>({ status: 'idle', message: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Protocol linkage is handled entirely by the ingest auto-tag trigger, which
  // reads protocol_number from Reducto's extracted fields and matches it to a
  // protocol. No manual picker — protocol PDFs self-link on parse.

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

  // Keep the latest onSuccess without re-running the poll effect when the parent
  // re-renders with a new callback identity (which would restart polling).
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file?.type === 'application/pdf') {
      setPdfFile(file);
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    }
  }, [title]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setPdfFile(file);
      if (!title) setTitle(file.name.replace(/\.pdf$/i, ''));
    }
  }, [title]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    if (!pdfFile) return;

    setState({ status: 'uploading', message: 'Uploading PDF to Reducto for parsing...' });

    try {
      const pdf_base64 = await fileToBase64(pdfFile);
      setState({ status: 'uploading', message: 'Extracting text and embedding chunks...' });
      const body = {
        title: title.trim() || pdfFile.name.replace(/\.pdf$/i, ''),
        filename: pdfFile.name,
        pdf_base64,
      };

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token ?? supabaseAnonKey;

      const res = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');

      const typed = data as IngestResponse;

      // PDF path: 202 with status='pending' means Reducto's processing
      // asynchronously. Switch to the parsing state, hand the document_id
      // off to the poll loop (useEffect below), and notify the parent so
      // ProtocolOnboarding etc. can wire up their realtime listeners.
      if (res.status === 202 || typed.status === 'pending') {
        // Do NOT notify the parent yet. Some consumers (ProtocolUploadModal)
        // close on onSuccess — closing unmounts this form and kills the poll
        // loop below before the parse finalizes, stranding the doc at 'pending'.
        // We fire onSuccess only once the poll reports 'ready' (see below).
        setState({
          status: 'parsing',
          message: 'Parsing your protocol — usually 30–180 seconds. Keep this open; we\'ll confirm when it\'s ready.',
          pendingDocumentId: typed.document_id,
        });
        return;
      }

      setState({
        status: 'success',
        message: typed.deduped
          ? 'Already uploaded — opening your dashboard.'
          : 'Document ingested successfully',
        chunks: typed.chunks_created,
      });
      setTitle('');
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess(typed);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setState({ status: 'error', message: msg });
    }
  }, [pdfFile, title, supabaseUrl, supabaseAnonKey, onSuccess]);

  // Polling loop while the parse is in flight. Each tick hits /ingest-status
  // which asks Reducto if the job is done and, if so, runs the completion
  // pipeline. State flips out of 'parsing' when the tick reports terminal
  // status (ready/failed). The documents realtime channel in SiteDataContext
  // is a parallel notifier — the UI listens to both, whichever resolves first.
  const pendingDocId = state.status === 'parsing' ? state.pendingDocumentId : null;
  useEffect(() => {
    if (!pendingDocId) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token ?? supabaseAnonKey;
        const res = await fetch(`${supabaseUrl}/functions/v1/ingest-status`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ document_id: pendingDocId }),
        });
        if (cancelled) return;
        const data = await res.json().catch(() => null);
        if (!res.ok || !data) return; // keep polling on transient errors

        if (data.status === 'ready') {
          setState({
            status: 'success',
            message: 'Protocol parsed and ready.',
          });
          // Notify the parent now that the parse is genuinely done — this is
          // where consumers (list refresh, modal close, onboarding routing)
          // should react, not at parse-start.
          onSuccessRef.current({
            success: true,
            document_id: pendingDocId,
            protocol_id: data.protocol_id ?? null,
            status: 'ready',
          });
        } else if (data.status === 'failed') {
          setState({
            status: 'error',
            message: data.error_message ?? 'Parse failed. Please try again.',
          });
        }
        // status === 'pending' → keep polling on the next interval tick
      } catch {
        // network blip — silent, next tick retries
      }
    };

    // Fire immediately, then on interval. The first tick is usually too
    // early to be ready (Reducto parse takes ~30-90s for a normal protocol)
    // but it's cheap and confirms the document_id is valid.
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [pendingDocId, supabaseUrl, supabaseAnonKey]);

  const canSubmit = pdfFile != null;

  const inputClass = isLight
    ? 'bg-white border-[#E2E8F0] text-[#0F172A] placeholder-[#334155]/30 focus:border-brand-600/50'
    : 'bg-[#020617] border-white/8 text-white placeholder-[#334155] focus:border-brand-600/40';

  const labelClass = isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/40';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className={`block text-xs mb-1.5 font-medium uppercase tracking-wider ${labelClass}`}>
          Document Title
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Auto-filled from filename"
          className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors ${inputClass}`}
        />
      </div>

      <div>
        <label className={`block text-xs mb-1.5 font-medium uppercase tracking-wider ${labelClass}`}>
          PDF File
        </label>
        <div
          onDrop={handleDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`relative cursor-pointer border-2 border-dashed rounded-xl p-8 text-center transition-all ${
            dragOver
              ? 'border-brand-600/60 bg-brand-600/5'
              : pdfFile
              ? 'border-brand-500/40 bg-brand-500/5'
              : isLight
              ? 'border-[#d0d8e0] bg-[#F8FAFC] hover:border-[#b0bcc8] hover:bg-[#F2F2F2]'
              : 'border-white/10 bg-[#020617] hover:border-white/20 hover:bg-white/[0.02]'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          {pdfFile ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center">
                <FileText size={18} className="text-brand-400" />
              </div>
              <p className="text-brand-600 text-sm font-medium">{pdfFile.name}</p>
              <p className={`text-xs ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/25'}`}>{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
              <p className={`text-xs ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/25'}`}>Click to change file</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-brand-600/10 border border-brand-600/20 flex items-center justify-center">
                <Upload size={18} className="text-brand-300" />
              </div>
              <p className={`text-sm font-medium ${isLight ? 'text-[#334155]/80' : 'text-[#CBD5E1]/70'}`}>Drop PDF here or click to browse</p>
              <p className={`text-xs ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/25'}`}>Parsed with Reducto — tables, headers, and structure preserved</p>
            </div>
          )}
        </div>
      </div>

      {state.status !== 'idle' && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
          state.status === 'success'
            ? 'bg-brand-400/5 border-brand-400/20 text-brand-600'
            : state.status === 'error'
            ? 'bg-red-400/5 border-red-400/20 text-red-500'
            : 'bg-brand-600/5 border-brand-600/20 text-brand-300'
        }`}>
          {(state.status === 'uploading' || state.status === 'parsing') && <Loader size={16} className="animate-spin flex-shrink-0 mt-0.5" />}
          {state.status === 'success' && <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />}
          {state.status === 'error' && <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
          <span>
            {state.message}
            {state.status === 'success' && state.chunks !== undefined && (
              <span className="text-brand-500 ml-1">({state.chunks} chunks embedded)</span>
            )}
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit || state.status === 'uploading' || state.status === 'parsing'}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {(state.status === 'uploading' || state.status === 'parsing') ? (
            <Loader size={15} className="animate-spin" />
          ) : (
            <Upload size={15} />
          )}
          {state.status === 'uploading' ? 'Ingesting...' : state.status === 'parsing' ? 'Parsing...' : 'Ingest Document'}
        </button>
      </div>
    </form>
  );
}

function DocumentList({ refreshKey, isLight }: { refreshKey: number; isLight: boolean }) {
  const [docs, setDocs] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: docData } = await supabase
      .from('documents')
      .select('id, title, filename, created_at, status, error_message')
      .order('created_at', { ascending: false })
      .limit(50);

    if (docData && docData.length > 0) {
      const { data: chunkData } = await supabase
        .from('chunks')
        .select('document_id')
        .in('document_id', docData.map(d => d.id));

      const counts: Record<string, number> = {};
      (chunkData ?? []).forEach(c => {
        counts[c.document_id] = (counts[c.document_id] ?? 0) + 1;
      });

      setDocs(docData.map(d => ({ ...d, chunk_count: counts[d.id] ?? 0 })));
    } else {
      setDocs([]);
    }
    setLoading(false);
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    setDeleting(id);
    try {
      const { error } = await supabase.from('documents').delete().eq('id', id);
      if (error) throw error;
      setDocs(prev => prev.filter(d => d.id !== id));
    } catch (err) {
      console.error('Delete failed:', err);
      alert('Failed to delete document');
    } finally {
      setDeleting(null);
    }
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div key={refreshKey}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`text-sm font-medium ${isLight ? 'text-[#334155]/60' : 'text-[#CBD5E1]/50'}`}>
          Knowledge Base ({docs.length} {docs.length === 1 ? 'document' : 'documents'})
        </h4>
        <button
          onClick={load}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            isLight ? 'text-[#334155]/40 hover:text-[#334155]/70' : 'text-[#CBD5E1]/30 hover:text-[#CBD5E1]/60'
          }`}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2].map(i => (
            <div key={i} className={`h-14 rounded-xl border animate-pulse ${
              isLight ? 'bg-[#F2F2F2] border-[#E2E8F0]' : 'bg-white/[0.02] border-white/5'
            }`} />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <p className={`text-sm py-4 text-center ${isLight ? 'text-[#334155]/35' : 'text-[#CBD5E1]/25'}`}>No documents ingested yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div
              key={doc.id}
              className={`flex items-center justify-between gap-3 border rounded-xl px-4 py-3 group transition-colors ${
                isLight
                  ? 'bg-[#F8FAFC] border-[#E2E8F0] hover:bg-[#F2F2F2]'
                  : 'bg-[#020617] border-white/5'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-brand-600/10 border border-brand-600/20 flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-brand-300" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-medium truncate ${isLight ? 'text-[#0F172A]/90' : 'text-[#CBD5E1]/80'}`}>{doc.title || 'Untitled'}</p>
                    {doc.status === 'pending' && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-500">ingesting</span>
                    )}
                    {doc.status === 'failed' && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400" title={doc.error_message ?? ''}>failed</span>
                    )}
                  </div>
                  <p className={`text-xs truncate ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>
                    {doc.filename || 'No file'}
                    {doc.chunk_count !== undefined && doc.status !== 'failed' && (
                      <span className={`ml-2 ${isLight ? 'text-[#334155]/30' : 'text-[#CBD5E1]/20'}`}>&middot; {doc.chunk_count} chunks</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-xs hidden sm:block ${isLight ? 'text-[#334155]/30' : 'text-[#CBD5E1]/20'}`}>
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDelete(doc.id)}
                  disabled={deleting === doc.id}
                  className={`opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-all ${
                    isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'
                  }`}
                >
                  {deleting === doc.id
                    ? <Loader size={13} className="animate-spin" />
                    : <Trash2 size={13} />
                  }
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function KnowledgeBase() {
  const [refreshKey, setRefreshKey] = useState(0);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div className="p-6 space-y-8 overflow-y-auto h-full">
      <div>
        <h2 className={`font-semibold text-lg mb-1 ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>Knowledge Base</h2>
        <p className={`text-sm ${isLight ? 'text-[#334155]/50' : 'text-[#CBD5E1]/40'}`}>
          Upload PDF protocols to ground the Protocol Assistant in your organization's content.
          Each document is parsed, chunked, embedded, and retrieved automatically during chat.
        </p>
      </div>

      <div className={`border rounded-2xl p-6 ${
        isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
      }`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-brand-600/15 border border-brand-600/25 flex items-center justify-center">
            <Upload size={15} className="text-brand-300" />
          </div>
          <div>
            <h3 className={`font-medium text-sm ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>Add Document</h3>
            <p className={`text-xs ${isLight ? 'text-[#334155]/40' : 'text-[#CBD5E1]/30'}`}>Upload a PDF or paste text to embed into the knowledge base</p>
          </div>
        </div>
        <UploadForm onSuccess={() => setRefreshKey(k => k + 1)} isLight={isLight} />
      </div>

      <DocumentList refreshKey={refreshKey} isLight={isLight} />
    </div>
  );
}
