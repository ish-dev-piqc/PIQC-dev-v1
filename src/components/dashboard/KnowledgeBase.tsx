import { useState, useCallback, useRef, useEffect } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader, Trash2, RefreshCw, FilePlus } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../context/ThemeContext';

interface Document {
  id: string;
  title: string;
  source: string;
  created_at: string;
  chunk_count?: number;
  status?: string;
  error_message?: string | null;
}

interface UploadState {
  status: 'idle' | 'uploading' | 'success' | 'error';
  message: string;
  chunks?: number;
}

type UploadMode = 'pdf' | 'text';

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

function UploadForm({ onSuccess, isLight }: { onSuccess: () => void; isLight: boolean }) {
  const [mode, setMode] = useState<UploadMode>('pdf');
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [content, setContent] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [state, setState] = useState<UploadState>({ status: 'idle', message: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

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

    if (mode === 'pdf' && !pdfFile) return;
    if (mode === 'text' && !content.trim()) return;

    setState({ status: 'uploading', message: mode === 'pdf' ? 'Parsing PDF with Reducto...' : 'Chunking and embedding document...' });

    try {
      let body: Record<string, string>;

      if (mode === 'pdf' && pdfFile) {
        setState({ status: 'uploading', message: 'Uploading PDF to Reducto for parsing...' });
        const pdf_base64 = await fileToBase64(pdfFile);
        setState({ status: 'uploading', message: 'Extracting text and embedding chunks...' });
        body = {
          title: title.trim() || pdfFile.name.replace(/\.pdf$/i, ''),
          source: source.trim() || 'PDF Upload',
          pdf_base64,
        };
      } else {
        body = {
          title: title.trim() || 'Untitled Document',
          source: source.trim() || 'Manual upload',
          content: content.trim(),
        };
      }

      const res = await fetch(`${supabaseUrl}/functions/v1/ingest`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Upload failed');

      setState({
        status: 'success',
        message: `Document ingested successfully`,
        chunks: data.chunks_created,
      });
      setTitle('');
      setSource('');
      setContent('');
      setPdfFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setState({ status: 'error', message: msg });
    }
  }, [mode, pdfFile, content, title, source, supabaseUrl, supabaseAnonKey, onSuccess]);

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const estimatedChunks = Math.ceil(Math.max(0, wordCount - 50) / 350) + (wordCount > 0 ? 1 : 0);
  const canSubmit = (mode === 'pdf' && pdfFile != null) || (mode === 'text' && content.trim().length > 0);

  const inputClass = isLight
    ? 'bg-white border-[#e2e8ee] text-[#1a1f28] placeholder-[#374152]/30 focus:border-[#4a6fa5]/50'
    : 'bg-[#0d1118] border-white/8 text-white placeholder-[#3c3c3c] focus:border-[#4a6fa5]/40';

  const labelClass = isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/40';

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className={`flex gap-1 p-1 rounded-xl border w-fit ${
        isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/8'
      }`}>
        <button
          type="button"
          onClick={() => setMode('pdf')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'pdf'
              ? 'bg-[#4a6fa5] text-white shadow-lg shadow-[#4a6fa5]/20'
              : isLight ? 'text-[#374152]/50 hover:text-[#374152]/80' : 'text-[#d2d7e0]/40 hover:text-[#d2d7e0]/70'
          }`}
        >
          <FilePlus size={14} />
          PDF Upload
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'text'
              ? 'bg-[#4a6fa5] text-white shadow-lg shadow-[#4a6fa5]/20'
              : isLight ? 'text-[#374152]/50 hover:text-[#374152]/80' : 'text-[#d2d7e0]/40 hover:text-[#d2d7e0]/70'
          }`}
        >
          <FileText size={14} />
          Paste Text
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={`block text-xs mb-1.5 font-medium uppercase tracking-wider ${labelClass}`}>
            Document Title
          </label>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={mode === 'pdf' ? 'Auto-filled from filename' : 'e.g. Sepsis Protocol v2.1'}
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors ${inputClass}`}
          />
        </div>
        <div>
          <label className={`block text-xs mb-1.5 font-medium uppercase tracking-wider ${labelClass}`}>
            Source / Category
          </label>
          <input
            type="text"
            value={source}
            onChange={e => setSource(e.target.value)}
            placeholder="e.g. Clinical Guidelines, Policy Manual"
            className={`w-full border rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-colors ${inputClass}`}
          />
        </div>
      </div>

      {mode === 'pdf' ? (
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
                ? 'border-[#4a6fa5]/60 bg-[#4a6fa5]/5'
                : pdfFile
                ? 'border-blue-500/40 bg-blue-500/5'
                : isLight
                ? 'border-[#d0d8e0] bg-[#f5f7fa] hover:border-[#b0bcc8] hover:bg-[#f0f4f8]'
                : 'border-white/10 bg-[#0d1118] hover:border-white/20 hover:bg-white/[0.02]'
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
                <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <FileText size={18} className="text-blue-400" />
                </div>
                <p className="text-blue-600 text-sm font-medium">{pdfFile.name}</p>
                <p className={`text-xs ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/25'}`}>{(pdfFile.size / 1024 / 1024).toFixed(2)} MB</p>
                <p className={`text-xs ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/25'}`}>Click to change file</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="w-10 h-10 rounded-xl bg-[#4a6fa5]/10 border border-[#4a6fa5]/20 flex items-center justify-center">
                  <Upload size={18} className="text-[#6e8fb5]" />
                </div>
                <p className={`text-sm font-medium ${isLight ? 'text-[#374152]/80' : 'text-[#d2d7e0]/70'}`}>Drop PDF here or click to browse</p>
                <p className={`text-xs ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/25'}`}>Parsed with Reducto — tables, headers, and structure preserved</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className={`block text-xs font-medium uppercase tracking-wider ${labelClass}`}>
              Document Content
            </label>
            {wordCount > 0 && (
              <span className={`text-xs ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/25'}`}>
                ~{wordCount.toLocaleString()} words &middot; ~{estimatedChunks} chunks
              </span>
            )}
          </div>
          <textarea
            value={content}
            onChange={e => setContent(e.target.value)}
            placeholder="Paste the full document text here. Protocols, guidelines, policy documents, FAQs — anything the AI should know about."
            rows={10}
            className={`w-full border rounded-xl px-4 py-3 text-sm focus:outline-none transition-colors resize-none leading-relaxed ${inputClass}`}
          />
        </div>
      )}

      {state.status !== 'idle' && (
        <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm border ${
          state.status === 'success'
            ? 'bg-blue-400/5 border-blue-400/20 text-blue-600'
            : state.status === 'error'
            ? 'bg-red-400/5 border-red-400/20 text-red-500'
            : 'bg-[#4a6fa5]/5 border-[#4a6fa5]/20 text-[#6e8fb5]'
        }`}>
          {state.status === 'uploading' && <Loader size={16} className="animate-spin flex-shrink-0 mt-0.5" />}
          {state.status === 'success' && <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />}
          {state.status === 'error' && <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />}
          <span>
            {state.message}
            {state.status === 'success' && state.chunks !== undefined && (
              <span className="text-blue-500 ml-1">({state.chunks} chunks embedded)</span>
            )}
          </span>
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={!canSubmit || state.status === 'uploading'}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#4a6fa5] hover:bg-[#5b82b8] disabled:opacity-30 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
        >
          {state.status === 'uploading' ? (
            <Loader size={15} className="animate-spin" />
          ) : (
            <Upload size={15} />
          )}
          {state.status === 'uploading' ? 'Ingesting...' : 'Ingest Document'}
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
      .select('id, title, source, created_at, status, error_message')
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
    await supabase.from('documents').delete().eq('id', id);
    setDocs(prev => prev.filter(d => d.id !== id));
    setDeleting(null);
  }, []);

  useEffect(() => { load(); }, [load, refreshKey]);

  return (
    <div key={refreshKey}>
      <div className="flex items-center justify-between mb-3">
        <h4 className={`text-sm font-medium ${isLight ? 'text-[#374152]/60' : 'text-[#d2d7e0]/50'}`}>
          Knowledge Base ({docs.length} {docs.length === 1 ? 'document' : 'documents'})
        </h4>
        <button
          onClick={load}
          className={`flex items-center gap-1.5 text-xs transition-colors ${
            isLight ? 'text-[#374152]/40 hover:text-[#374152]/70' : 'text-[#d2d7e0]/30 hover:text-[#d2d7e0]/60'
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
              isLight ? 'bg-[#f0f4f8] border-[#e2e8ee]' : 'bg-white/[0.02] border-white/5'
            }`} />
          ))}
        </div>
      ) : docs.length === 0 ? (
        <p className={`text-sm py-4 text-center ${isLight ? 'text-[#374152]/35' : 'text-[#d2d7e0]/25'}`}>No documents ingested yet.</p>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => (
            <div
              key={doc.id}
              className={`flex items-center justify-between gap-3 border rounded-xl px-4 py-3 group transition-colors ${
                isLight
                  ? 'bg-[#f5f7fa] border-[#e2e8ee] hover:bg-[#f0f4f8]'
                  : 'bg-[#0d1118] border-white/5'
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#4a6fa5]/10 border border-[#4a6fa5]/20 flex items-center justify-center flex-shrink-0">
                  <FileText size={14} className="text-[#6e8fb5]" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className={`text-sm font-medium truncate ${isLight ? 'text-[#1a1f28]/90' : 'text-[#d2d7e0]/80'}`}>{doc.title || 'Untitled'}</p>
                    {doc.status === 'pending' && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-400/15 text-amber-500">ingesting</span>
                    )}
                    {doc.status === 'failed' && (
                      <span className="flex-shrink-0 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400" title={doc.error_message ?? ''}>failed</span>
                    )}
                  </div>
                  <p className={`text-xs truncate ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/30'}`}>
                    {doc.source || 'No source'}
                    {doc.chunk_count !== undefined && doc.status !== 'failed' && (
                      <span className={`ml-2 ${isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/20'}`}>&middot; {doc.chunk_count} chunks</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className={`text-xs hidden sm:block ${isLight ? 'text-[#374152]/30' : 'text-[#d2d7e0]/20'}`}>
                  {new Date(doc.created_at).toLocaleDateString()}
                </span>
                <button
                  onClick={() => handleDelete(doc.id)}
                  disabled={deleting === doc.id}
                  className={`opacity-0 group-hover:opacity-100 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-all ${
                    isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/30'
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
        <h2 className={`font-semibold text-lg mb-1 ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>Knowledge Base</h2>
        <p className={`text-sm ${isLight ? 'text-[#374152]/50' : 'text-[#d2d7e0]/40'}`}>
          Upload PDF protocols or paste text to ground the Protocol Assistant in your organization's content.
          Each document is parsed, chunked, embedded, and retrieved automatically during chat.
        </p>
      </div>

      <div className={`border rounded-2xl p-6 ${
        isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#161d25] border-white/5'
      }`}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-8 h-8 rounded-lg bg-[#4a6fa5]/15 border border-[#4a6fa5]/25 flex items-center justify-center">
            <Upload size={15} className="text-[#6e8fb5]" />
          </div>
          <div>
            <h3 className={`font-medium text-sm ${isLight ? 'text-[#1a1f28]' : 'text-white'}`}>Add Document</h3>
            <p className={`text-xs ${isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/30'}`}>Upload a PDF or paste text to embed into the knowledge base</p>
          </div>
        </div>
        <UploadForm onSuccess={() => setRefreshKey(k => k + 1)} isLight={isLight} />
      </div>

      <DocumentList refreshKey={refreshKey} isLight={isLight} />
    </div>
  );
}
