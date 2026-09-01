import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowRight, NotebookPen, Pencil, ThumbsUp, Trash2 } from 'lucide-react';
import {
  createVendorNote,
  deleteVendorNote,
  fetchVendorNotes,
  updateVendorNote,
} from '../../../../../lib/audit/vendorNotesApi';
import type { AuditNoteObject } from '../../../../../types/audit';

// =============================================================================
// VendorNotesPad — the vendor-audit fieldwork notes pad (fieldwork lane,
// slice 1), rendered as a section of Stage-6 AuditConductWorkspace. Mount
// with key={auditId}: all state here is audit-scoped and resets by remount.
//
// Copies the ISA pad's PATTERN (IsaConductWorkspace is a no-props 1,217-line
// file with structural ISA coupling — nothing extractable), not its code:
// capture with Enter-to-add, inline edit, two-tap delete, positive-observation
// toggle. No domain at capture — slice 2's engine proposes vendor_domain on
// candidates.
//
// Notes are working papers, never the observation record. Absence ≠ failure
// on the read (retry banner, never an empty pad over a failed read); a failed
// save keeps the auditor's text in the editor and says so.
// =============================================================================

// ISA constant mirrored; slice 2's engine truncates at the same cap, so the
// pad refuses what the engine would silently cut.
const MAX_NOTE_CHARS = 1_000;

function noteTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

interface Props {
  auditId: string;
  hasReached: boolean;
  isLight: boolean;
}

export default function VendorNotesPad({ auditId, hasReached, isLight }: Props) {
  const [notes, setNotes] = useState<AuditNoteObject[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const [body, setBody] = useState('');
  const [positive, setPositive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const captureRef = useRef<HTMLTextAreaElement>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');
  const [editPositive, setEditPositive] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchVendorNotes(auditId).then((res) => {
      if (cancelled) return;
      setLoading(false);
      setLoadFailed(!res.ok);
      if (res.ok) setNotes(res.data);
    });
    return () => {
      cancelled = true;
    };
  }, [auditId, reloadNonce]);

  const submitNote = async () => {
    const trimmed = body.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    const res = await createVendorNote(auditId, { body: trimmed, isPositive: positive });
    setSaving(false);
    if (res.ok) {
      setNotes((prev) => [res.data, ...prev]);
      setBody('');
      setPositive(false);
      setSaveError(null);
      captureRef.current?.focus();
    } else {
      // Text stays in the editor — the banner says so.
      setSaveError(res.error);
    }
  };

  const startEdit = (n: AuditNoteObject) => {
    setEditingId(n.id);
    setEditBody(n.body);
    setEditPositive(n.is_positive);
    setEditError(null);
    setConfirmDeleteId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const trimmed = editBody.trim();
    if (!trimmed) return;
    const res = await updateVendorNote(editingId, { body: trimmed, isPositive: editPositive });
    if (res.ok) {
      setNotes((prev) => prev.map((n) => (n.id === res.data.id ? res.data : n)));
      setEditingId(null);
      setEditError(null);
    } else {
      setEditError(res.error);
    }
  };

  const removeNote = async (id: string) => {
    const res = await deleteVendorNote(id);
    setConfirmDeleteId(null);
    if (res.ok) {
      setNotes((prev) => prev.filter((n) => n.id !== id));
      setDeleteError(null);
    } else {
      setDeleteError(res.error);
    }
  };

  // ---------------------------------------------------------------------------
  // Theme tokens — repo palette (slate surfaces, brand accents), text via fg-*.
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-white/5';
  const rowBorder = isLight ? 'border-slate-200' : 'border-white/5';
  const inputBase = isLight
    ? 'bg-white border-slate-300 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'bg-slate-900 border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const primaryBtn = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const chipBase = isLight
    ? 'bg-brand-50 border-brand-200 text-brand-700'
    : 'bg-brand-500/15 border-brand-500/30 text-brand-300';
  const positiveChip = isLight
    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
    : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-300';
  const redBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';
  const dangerBtn = isLight
    ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-red-500/20 text-red-300 hover:bg-red-500/30';

  return (
    <section data-testid="vendor-notes-pad" className={`${cardBg} border rounded-xl`}>
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
        <NotebookPen size={15} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
        <h3 className="text-fg-heading text-sm font-semibold">Fieldwork notes</h3>
        <span className="text-fg-muted text-xs">
          {notes.length === 1 ? '1 note' : `${notes.length} notes`}
        </span>
        <span className="text-fg-muted text-xs ml-auto">
          Working papers — never the observation record
        </span>
      </div>

      {/* Capture — pure mutation surface, hidden entirely in preview. */}
      {hasReached && (
        <div data-testid="vendor-notes-capture" className={`p-4 space-y-3 border-b ${rowBorder}`}>
          {saveError && (
            <div
              role="alert"
              data-testid="vendor-notes-save-error"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
            >
              <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
              <p>
                The note was not saved — your text is still below. Retry, or copy it out.
                <span className="block opacity-80 mt-0.5">({saveError})</span>
              </p>
            </div>
          )}
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
            maxLength={MAX_NOTE_CHARS}
            placeholder="e.g. Validation SOP-014 rev 3 unsigned; rev 2 still in use at the bench…"
            aria-label="New fieldwork note"
            data-testid="vendor-notes-input"
            className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body placeholder:text-fg-muted outline-none resize-y transition-colors ${inputBase}`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setPositive((p) => !p)}
              aria-pressed={positive}
              data-testid="vendor-notes-positive"
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                positive ? chipBase : `text-fg-muted ${inputBase}`
              }`}
            >
              <ThumbsUp size={12} />
              Positive observation
            </button>
            <span className="text-fg-muted text-[11px]">
              {body.length}/{MAX_NOTE_CHARS}
            </span>
            <button
              type="button"
              onClick={() => void submitNote()}
              disabled={!body.trim() || saving}
              data-testid="vendor-notes-add"
              className={`ml-auto rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${primaryBtn}`}
            >
              {saving ? 'Adding…' : 'Add note'}
            </button>
          </div>
          <p className="text-fg-muted text-xs">
            Enter adds · Shift+Enter for a new line ·{' '}
            <span className="font-medium">
              No participant identifiers or personnel names — note text is sent to PIQC when
              drafting observations.
            </span>
          </p>
        </div>
      )}

      {deleteError && (
        <div
          role="alert"
          data-testid="vendor-notes-delete-error"
          className={`mx-4 mt-3 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
        >
          {deleteError}
        </div>
      )}

      {loading ? (
        <p className="text-fg-muted text-sm px-4 py-6">Loading notes…</p>
      ) : loadFailed ? (
        // Honest load failure — absence ≠ failure, so no empty pad over a
        // failed read.
        <div
          role="alert"
          data-testid="vendor-notes-load-error"
          className={`flex items-start gap-2 m-4 px-3 py-2 rounded-md border ${redBox}`}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed flex-1">
            Notes could not be loaded — they may exist. Retry before adding more.
          </p>
          <button
            type="button"
            onClick={() => setReloadNonce((n) => n + 1)}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-colors text-fg-body ${inputBase}`}
          >
            Retry
          </button>
        </div>
      ) : notes.length === 0 ? (
        <p className="text-fg-sub text-sm px-4 py-6">
          No notes yet. Jot what you observe as you go — the drafting step reads these.
        </p>
      ) : (
        <ul>
          {notes.map((n) => {
            const promoted = n.promoted_entry_id !== null || n.promoted_finding_id !== null;
            return (
              <li
                key={n.id}
                data-testid={`vendor-note-${n.id}`}
                className={`px-4 py-3 border-t ${rowBorder} first:border-t-0`}
              >
                {editingId === n.id ? (
                  <div className="space-y-2">
                    {editError && (
                      <div role="alert" className={`px-3 py-2 rounded-md border text-xs ${redBox}`}>
                        Edit not saved — {editError}
                      </div>
                    )}
                    <textarea
                      value={editBody}
                      onChange={(e) => setEditBody(e.target.value)}
                      rows={3}
                      maxLength={MAX_NOTE_CHARS}
                      aria-label="Edit fieldwork note"
                      data-testid={`vendor-note-edit-input-${n.id}`}
                      className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y ${inputBase}`}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditPositive((p) => !p)}
                        aria-pressed={editPositive}
                        data-testid={`vendor-note-edit-positive-${n.id}`}
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
                          data-testid={`vendor-note-save-${n.id}`}
                          className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
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
                      {n.is_positive && (
                        <span
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${positiveChip}`}
                        >
                          <ThumbsUp size={10} />
                          Positive
                        </span>
                      )}
                      {promoted && (
                        <span
                          data-testid={`vendor-note-promoted-${n.id}`}
                          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${chipBase}`}
                          title="Cited by an accepted observation — it cannot be deleted"
                        >
                          <ArrowRight size={10} />
                          Observation
                        </span>
                      )}
                      {hasReached && (
                        <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          {confirmDeleteId === n.id ? (
                            <>
                              <span className="text-fg-muted text-xs">Delete?</span>
                              <button
                                type="button"
                                onClick={() => void removeNote(n.id)}
                                data-testid={`vendor-note-delete-confirm-${n.id}`}
                                className={`rounded px-2 py-0.5 text-xs font-semibold ${dangerBtn}`}
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
                                aria-label="Edit note"
                                data-testid={`vendor-note-edit-${n.id}`}
                                className="text-fg-muted hover:text-fg-body p-1"
                              >
                                <Pencil size={12} />
                              </button>
                              {/* Delete hidden for promoted notes — the server
                                  refuses it too; hiding avoids a dead click. */}
                              {!promoted && (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(n.id)}
                                  aria-label="Delete note"
                                  data-testid={`vendor-note-delete-${n.id}`}
                                  className="text-fg-muted hover:text-fg-body p-1"
                                >
                                  <Trash2 size={12} />
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
