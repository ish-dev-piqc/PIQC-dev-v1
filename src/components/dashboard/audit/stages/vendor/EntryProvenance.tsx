import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FileText } from 'lucide-react';
import PiqcMark from '../../PiqcMark';
import { WORKSPACE_ENTRY_ORIGIN_LABELS } from '../../../../../lib/audit/labels';
import { formatProtocolRefWhere } from '../../../../../lib/audit/isaReportModel';
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
// promote RPC recorded: the consumed notes' bodies, the filed-evidence
// passages' locators (the shared formatter, so the same citation reads the
// same everywhere), the verified protocol quote, and the drafting engine.
// Collapsed by default: the observation text is the record's primary
// surface; the chain is there for the reviewer who asks "from what?".
// =============================================================================

interface Props {
  entry: MockWorkspaceEntry;
  /** The workspace's notes read — a consumed note that is not in it renders
   *  as unavailable (reachable only while the read is loading or failed:
   *  a consumed note cannot be deleted). */
  notesById: Map<string, AuditNoteObject>;
  isLight: boolean;
}

// Second copy of VendorCandidatePanel's 3-line helper: the shared locator
// formatter falls back to the word "Protocol", which a filed document is
// not. Consolidate at the third caller.
function passageWhere(p: {
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}): string {
  const where = formatProtocolRefWhere({ chunk_id: null, document_id: null, quote: '', ...p });
  return where === 'Protocol' ? '' : where;
}

export default function EntryProvenance({ entry, notesById, isLight }: Props) {
  const [open, setOpen] = useState(false);
  if (entry.origin === 'AUDITOR') return null;

  // One passage may be cited by several evidence items — list it once.
  const passages = [
    ...new Map(
      entry.evidence_refs.flatMap((e) => e.source_passages).map((p) => [p.chunk_id, p]),
    ).values(),
  ];
  const noteCount = entry.source_note_ids.length;
  const summary = [
    noteCount > 0 ? `${noteCount} ${noteCount === 1 ? 'note' : 'notes'}` : null,
    passages.length > 0 ? `${passages.length} filed ${passages.length === 1 ? 'passage' : 'passages'}` : null,
    entry.protocol_ref ? 'protocol quote' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const brandText = isLight ? 'text-brand-600' : 'text-brand-300';
  const pill = isLight
    ? 'bg-brand-50 border-brand-200 text-brand-700'
    : 'bg-brand-500/15 border-brand-500/30 text-brand-300';
  const detailBox = isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.02] border-white/10';
  const quoteBorder = isLight ? 'border-slate-300' : 'border-white/15';

  return (
    <div data-testid={`entry-provenance-${entry.id}`} className="mt-2 text-[11px]">
      <div className="flex items-center gap-2 flex-wrap">
        <span
          data-testid="entry-origin-pill"
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${pill}`}
        >
          <PiqcMark size={10} />
          {WORKSPACE_ENTRY_ORIGIN_LABELS[entry.origin]}
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          data-testid="entry-provenance-toggle"
          className={`inline-flex items-center gap-1 ${brandText} hover:underline`}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Sources{summary ? ` · ${summary}` : ''}
        </button>
      </div>

      {open && (
        <div
          data-testid="entry-provenance-detail"
          className={`mt-2 rounded-md border px-3 py-2 space-y-2 ${detailBox}`}
        >
          {noteCount > 0 && (
            <div>
              <p className="text-fg-sub font-medium">
                From {noteCount} fieldwork {noteCount === 1 ? 'note' : 'notes'}
              </p>
              <ul className="mt-1 space-y-1">
                {entry.source_note_ids.map((id) => {
                  const n = notesById.get(id);
                  return (
                    <li
                      key={id}
                      className={`text-fg-muted pl-2 border-l-2 ${quoteBorder} whitespace-pre-wrap`}
                    >
                      {n ? n.body : 'Note unavailable'}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {passages.length > 0 && (
            <div>
              <p className="text-fg-sub font-medium">
                From {passages.length} filed-evidence {passages.length === 1 ? 'passage' : 'passages'}
              </p>
              <ul className="mt-1 space-y-1">
                {passages.map((p) => {
                  const where = passageWhere(p);
                  return (
                    <li
                      key={p.chunk_id}
                      className={`flex items-center gap-1 text-fg-muted pl-2 border-l-2 ${quoteBorder}`}
                    >
                      <FileText size={10} />
                      Filed evidence{where ? ` · ${where}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {entry.protocol_ref && (
            <div>
              <p className={`flex items-center gap-1 font-medium ${brandText}`}>
                <BookOpen size={11} />
                Protocol requirement · {formatProtocolRefWhere(entry.protocol_ref)}
              </p>
              <p className="text-fg-sub italic mt-0.5">“{entry.protocol_ref.quote}”</p>
            </div>
          )}

          {entry.drafting_engine && (
            <p className="text-fg-muted" data-testid="entry-provenance-engine">
              Drafted by {entry.drafting_engine.model} ({entry.drafting_engine.function}); accepted{' '}
              {entry.origin === 'PIQC_EDITED' ? 'with edits' : 'verbatim'} by the auditor.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
