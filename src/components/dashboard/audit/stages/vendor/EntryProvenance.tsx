import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import PiqcMark from '../../PiqcMark';
import { WORKSPACE_ENTRY_ORIGIN_LABELS } from '../../../../../lib/audit/labels';
import { formatProtocolRefWhere } from '../../../../../lib/audit/isaReportModel';
import { formatPassageWhere } from '../../../../../lib/audit/passageLocator';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import type { AuditNoteObject } from '../../../../../types/audit';

// =============================================================================
// EntryProvenance — the provenance surface of a Stage-6 observation
// (fieldwork lane, slice 3), mounted once per EntryRow between the
// observation text and the footer.
//
// Renders NOTHING for a hand-typed (AUDITOR) entry — those rows stay exactly
// as they were. For an accepted candidate it shows the origin pill
// ("PIQC-drafted" / "PIQC-drafted, edited" — the server's comparison, not a
// client claim) and a collapsed "Sources" disclosure with the chain the
// promote RPC recorded, PER EVIDENCE ITEM as the auditor reviewed it: the
// claim's text, then the note bodies it cites and the filed-evidence
// passages it came from (the shared locator, so a passage reads the same
// here as in the panel, the report, the docx) — then the verified protocol
// quote and the drafting engine. Collapsed by default: the observation text
// is the record's primary surface; the chain is for the reviewer who asks
// "from what?".
//
// A cited note reads "(note not loaded)" while the workspace's notes read is
// loading or failed, and "Note unavailable" only when the notes are known
// and it is genuinely gone. The vendor RPCs refuse to delete a consumed
// note, but the applied ISA delete RPC's guard gap (slice-1 ledger) can
// still soft-delete one — the claim text and passages on the record survive
// that.
// =============================================================================

type NotesStatus = 'loading' | 'ready' | 'failed';

interface Props {
  entry: MockWorkspaceEntry;
  notesById: Map<string, AuditNoteObject>;
  notesStatus: NotesStatus;
  isLight: boolean;
}

export default function EntryProvenance({ entry, notesById, notesStatus, isLight }: Props) {
  const [open, setOpen] = useState(false);
  if (entry.origin === 'AUDITOR') return null;

  // The summary counts CLAIMS (one block each below) and DISTINCT sources;
  // the chain lists a source under every claim that cites it, so the two
  // numbers are different things and both are named.
  const claimCount = entry.evidence_refs.length;
  const noteCount = entry.source_note_ids.length;
  const passageCount = new Set(
    entry.evidence_refs.flatMap((e) => e.source_passages.map((p) => p.chunk_id)),
  ).size;
  const summary = [
    claimCount > 0 ? `${claimCount} ${claimCount === 1 ? 'claim' : 'claims'}` : null,
    noteCount > 0 ? `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}` : null,
    passageCount > 0 ? `${passageCount} filed ${passageCount === 1 ? 'passage' : 'passages'}` : null,
    entry.protocol_ref ? 'protocol quote' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const missingNoteCopy = notesStatus === 'ready' ? 'Note unavailable' : '(note not loaded)';

  const brandText = isLight ? 'text-brand-600' : 'text-brand-300';
  const pill = isLight
    ? 'bg-brand-50 border-brand-200 text-brand-700'
    : 'bg-brand-500/15 border-brand-500/30 text-brand-300';
  const detailBox = isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.02] border-white/10';
  const itemBox = isLight ? 'border-slate-200' : 'border-white/10';
  const quoteBorder = isLight ? 'border-slate-300' : 'border-white/15';

  return (
    <div data-testid={`entry-provenance-${entry.id}`} className="mt-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          data-testid={`entry-origin-pill-${entry.id}`}
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${pill}`}
        >
          <PiqcMark size={10} />
          {WORKSPACE_ENTRY_ORIGIN_LABELS[entry.origin]}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid={`entry-provenance-toggle-${entry.id}`}
          className={`inline-flex items-center gap-1 ${brandText} hover:underline`}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Sources{summary ? ` · ${summary}` : ''}
        </button>
      </div>

      {open && (
        <div
          data-testid={`entry-provenance-detail-${entry.id}`}
          className={`mt-2 rounded-md border px-3 py-2 space-y-2 ${detailBox}`}
        >
          {entry.evidence_refs.map((ev, i) => (
            <div key={i} className={`rounded-md border px-2.5 py-1.5 ${itemBox}`}>
              <p className="text-fg-body">{ev.text}</p>
              {ev.source_note_ids.map((id) => {
                const n = notesById.get(id);
                return (
                  <p
                    key={id}
                    className={`text-fg-muted mt-1 pl-2 border-l-2 ${quoteBorder} whitespace-pre-wrap`}
                  >
                    <span className="font-medium">Your note:</span> {n ? n.body : missingNoteCopy}
                  </p>
                );
              })}
              {ev.source_passages.map((p) => {
                const where = formatPassageWhere(p);
                return (
                  <p
                    key={p.chunk_id}
                    className={`flex items-center gap-1 text-fg-muted mt-1 pl-2 border-l-2 ${quoteBorder}`}
                  >
                    <FileText size={10} />
                    Filed evidence{where ? ` · ${where}` : ''}
                  </p>
                );
              })}
            </div>
          ))}

          {entry.protocol_ref && (
            <div>
              <p className={`flex items-center gap-1 font-medium ${brandText}`}>
                <BookOpen size={11} />
                Protocol requirement · {formatProtocolRefWhere(entry.protocol_ref)}
              </p>
              <p className="text-fg-sub italic mt-0.5">“{entry.protocol_ref.quote}”</p>
            </div>
          )}

          {/* Origin is decided at acceptance and does not flip on later
              entry-form edits (partner-return item) — so the claim is
              scoped to that moment and points at History for the rest. */}
          {entry.drafting_engine && (
            <p className="text-fg-muted" data-testid={`entry-provenance-engine-${entry.id}`}>
              Drafted by {entry.drafting_engine.model} ({entry.drafting_engine.function}); accepted{' '}
              {entry.origin === 'PIQC_EDITED' ? 'with edits' : 'as proposed'} by the auditor. Changes
              since acceptance are in History.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
