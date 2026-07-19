import { useEffect, useRef, useState } from 'react';
import { NotebookPen, Pencil, ThumbsUp, Trash2, X as XIcon } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import { ISA_DOMAIN_LABELS } from '../../../../../lib/audit/labels';
import {
  createIsaNote,
  deleteIsaNote,
  fetchIsaNotes,
  updateIsaNote,
} from '../../../../../lib/audit/isaNotesApi';
import type { AuditNoteObject, IsaDomain } from '../../../../../types/audit';

// =============================================================================
// IsaConductWorkspace — ISA_CONDUCT stage center pane: the notes pad.
//
// Fast freeform capture during the site visit — optimized for typing while
// someone is talking: Enter appends, nothing is required beyond the text.
// Notes are working papers (editable, soft-deletable), NOT findings; the S2
// finding writer reads this pad and proposes draft findings the auditor
// reviews. Domain tag and positive marker are optional enrichments that feed
// the coverage strip and the report's positive-observations section later in
// the arc.
//
// PHI rule (S1 hard requirement): the pad instructs subject numbers only —
// no participant names, initials, or DOBs. Note bodies will be sent to an
// LLM in S2; the guidance keeps identifiers out at the source.
// =============================================================================

const DOMAIN_OPTIONS = Object.entries(ISA_DOMAIN_LABELS) as [IsaDomain, string][];

function noteTimestamp(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { day: '2-digit', month: 'short' })} ${time}`;
}

export default function IsaConductWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  const [notes, setNotes] = useState<AuditNoteObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Capture form
  const [body, setBody] = useState('');
  const [domain, setDomain] = useState<IsaDomain | ''>('');
  const [positive, setPositive] = useState(false);
  const [saving, setSaving] = useState(false);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  // Inline edit + two-tap delete
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editDomain, setEditDomain] = useState<IsaDomain | ''>('');
  const [editPositive, setEditPositive] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const auditId = activeAudit?.id;

  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    setLoading(true);
    fetchIsaNotes(auditId).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setNotes(res.data);
        setError(null);
      } else {
        setError('Notes could not be loaded. Retry by reopening the stage.');
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId]);

  if (!activeAudit) return null;

  const cardBase = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-white/[0.02] border-white/10';
  const rowBorder = isLight ? 'border-[#EEF2F6]' : 'border-white/5';
  const inputBase = isLight
    ? 'bg-white border-[#E2E8F0] focus:border-brand-600/50'
    : 'bg-white/[0.03] border-white/10 focus:border-brand-300/50';
  const chipBase = isLight
    ? 'bg-brand-600/[0.07] text-brand-700 border-brand-600/20'
    : 'bg-brand-300/[0.08] text-brand-300 border-brand-300/20';

  const submitNote = async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const res = await createIsaNote(activeAudit.id, {
      body: trimmed,
      isaDomain: domain || null,
      isPositive: positive,
    });
    setSaving(false);
    if (res.ok) {
      setNotes((prev) => [res.data, ...prev]);
      setBody('');
      setPositive(false);
      // Domain tag is sticky on purpose: auditors review one binder at a
      // time, so consecutive notes usually share a domain.
      setError(null);
      captureRef.current?.focus();
    } else {
      setError('The note was not saved. Copy your text and retry.');
    }
  };

  const startEdit = (n: AuditNoteObject) => {
    setEditingId(n.id);
    setEditBody(n.body);
    setEditDomain(n.isa_domain ?? '');
    setEditPositive(n.is_positive);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmed = editBody.trim();
    if (!trimmed) return;
    const res = await updateIsaNote(editingId, {
      body: trimmed,
      ...(editDomain ? { isaDomain: editDomain } : { clearIsaDomain: true }),
      isPositive: editPositive,
    });
    if (res.ok) {
      setNotes((prev) => prev.map((n) => (n.id === editingId ? res.data : n)));
      setEditingId(null);
      setError(null);
    } else {
      setError('The edit was not saved. Retry.');
    }
  };

  const removeNote = async (noteId: string) => {
    const res = await deleteIsaNote(noteId);
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== noteId));
      setError(null);
    } else {
      setError('The note was not deleted. Retry.');
    }
    setConfirmDeleteId(null);
  };

  return (
    // Container + type scale match the other stage workspaces (p-6 max-w-4xl,
    // text-xl heading) so the pipelines read as siblings in the same shell.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
          Stage 5 · Audit conduct
        </p>
        <h2 className="text-fg-heading text-xl font-semibold mt-1">Fieldwork notes</h2>
        <p className="text-fg-sub text-sm mt-1.5 leading-relaxed max-w-2xl">
          Capture what you see as you see it — shorthand is fine. PIQC drafts findings
          from these notes at the end of the day; you review every draft before
          anything becomes a finding.
        </p>
      </div>

      {error && (
        <div
          className={`flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/10 border-red-500/25 text-red-300'
          }`}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="flex-shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss error"
          >
            <XIcon size={14} />
          </button>
        </div>
      )}

      {/* Capture */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
          <NotebookPen size={15} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
          <h3 className="text-fg-heading text-sm font-semibold">New note</h3>
        </div>
        <div className="p-4 space-y-3">
          <textarea
            ref={captureRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submitNote();
              }
            }}
            rows={3}
            placeholder="e.g. Subj 003 ICF v2 signed 04 Mar but v3 was IRB-approved 20 Feb…"
            className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body placeholder:text-fg-muted outline-none resize-y ${inputBase}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value as IsaDomain | '')}
              className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
              aria-label="Observation domain"
            >
              <option value="">No domain tag</option>
              {DOMAIN_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPositive((p) => !p)}
              aria-pressed={positive}
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                positive ? chipBase : `text-fg-muted ${inputBase}`
              }`}
            >
              <ThumbsUp size={12} />
              Positive observation
            </button>
            <button
              type="button"
              onClick={() => void submitNote()}
              disabled={!body.trim() || saving}
              className={`ml-auto rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                isLight
                  ? 'bg-brand-600 text-white hover:bg-brand-700'
                  : 'bg-brand-300/20 text-brand-300 hover:bg-brand-300/30'
              }`}
            >
              {saving ? 'Adding…' : 'Add note'}
            </button>
          </div>
          <p className="text-fg-muted text-xs">
            Enter adds · Shift+Enter for a new line ·{' '}
            <span className="font-medium">
              Subject numbers only — no names, initials, or dates of birth.
            </span>
          </p>
        </div>
      </section>

      {/* Notes list */}
      <section className={`rounded-lg border ${cardBase}`}>
        <div className={`flex items-center justify-between px-4 py-3 border-b ${rowBorder}`}>
          <h3 className="text-fg-heading text-sm font-semibold">Notes</h3>
          <span className="text-fg-muted text-xs">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </span>
        </div>

        {loading ? (
          <p className="text-fg-muted text-sm px-4 py-6">Loading notes…</p>
        ) : notes.length === 0 ? (
          <p className="text-fg-sub text-sm px-4 py-6">
            No notes yet. The first one takes five seconds — everything else in this
            arc builds from them.
          </p>
        ) : (
          <ul>
            {notes.map((n) => (
              <li key={n.id} className={`px-4 py-3 border-t ${rowBorder} first:border-t-0`}>
                {editingId === n.id ? (
                  <div className="space-y-2">
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y ${inputBase}`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={editDomain}
                        onChange={(e) => setEditDomain(e.target.value as IsaDomain | '')}
                        className={`rounded-md border px-2 py-1.5 text-xs text-fg-body outline-none ${inputBase}`}
                        aria-label="Observation domain"
                      >
                        <option value="">No domain tag</option>
                        {DOMAIN_OPTIONS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setEditPositive((p) => !p)}
                        aria-pressed={editPositive}
                        className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs ${
                          editPositive ? chipBase : `text-fg-muted ${inputBase}`
                        }`}
                      >
                        <ThumbsUp size={12} />
                        Positive
                      </button>
                      <div className="ml-auto flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="text-fg-muted text-xs hover:text-fg-body"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={!editBody.trim()}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${
                            isLight
                              ? 'bg-brand-600 text-white hover:bg-brand-700'
                              : 'bg-brand-300/20 text-brand-300 hover:bg-brand-300/30'
                          }`}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="group">
                    <p className="text-fg-body text-sm whitespace-pre-wrap">{n.body}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-fg-muted text-xs">{noteTimestamp(n.created_at)}</span>
                      {n.isa_domain && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}>
                          {ISA_DOMAIN_LABELS[n.isa_domain]}
                        </span>
                      )}
                      {n.is_positive && (
                        <span
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${
                            isLight
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25'
                          }`}
                        >
                          <ThumbsUp size={10} />
                          Positive
                        </span>
                      )}
                      <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {confirmDeleteId === n.id ? (
                          <>
                            <span className="text-fg-muted text-xs">Delete?</span>
                            <button
                              type="button"
                              onClick={() => void removeNote(n.id)}
                              className={`rounded px-2 py-0.5 text-xs font-semibold ${
                                isLight
                                  ? 'bg-red-600 text-white hover:bg-red-700'
                                  : 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                              }`}
                            >
                              Yes
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-fg-muted text-xs hover:text-fg-body px-1"
                            >
                              No
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(n)}
                              className="text-fg-muted hover:text-fg-body p-1"
                              aria-label="Edit note"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(n.id)}
                              className="text-fg-muted hover:text-fg-body p-1"
                              aria-label="Delete note"
                            >
                              <Trash2 size={13} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
