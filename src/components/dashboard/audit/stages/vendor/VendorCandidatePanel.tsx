import { useEffect, useState } from 'react';
import { AlertTriangle, BookOpen, FileText, Sparkles, X as XIcon } from 'lucide-react';
import {
  readCandidateStash,
  requestObservationCandidates,
  writeCandidateStash,
  type ObservationCandidate,
  type StashedCandidate,
} from '../../../../../lib/audit/observationDraftApi';
import { promoteWorkspaceCandidate } from '../../../../../lib/audit/workspaceEntriesApi';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import { PROVISIONAL_CLASSIFICATION_LABELS } from '../../../../../lib/audit/labels';
import type { AuditNoteObject, ProvisionalClassification } from '../../../../../types/audit';

// =============================================================================
// VendorCandidatePanel — PIQC-drafted candidate observations for a vendor
// audit (fieldwork lane, slice 2), rendered as a section of Stage-6
// AuditConductWorkspace between the observation record and the stage
// transition. Mount with key={auditId}.
//
// The latch: PIQC proposes, the auditor accepts / edits / rejects. Nothing is
// recorded until Accept, and Accept is the ONLY path from a candidate into
// audit_workspace_entry_objects (promoteWorkspaceCandidate → one RPC, one
// transaction, one delta with the evidence chain). A candidate carries no
// severity or classification — the auditor picks the classification here,
// defaulting to NOT_YET_CLASSIFIED, which keeps the entry out of report
// bodies and blocks Stage-8 sign-off until it is classified.
//
// Candidates are stashed in localStorage (observationDraftApi) so a reload
// does not lose an evening of review to a nondeterministic re-run; stashed
// candidates whose cited notes are gone or already promoted are pruned once
// the notes are known (an Accept on them would rightly fail the DB gate).
//
// Honesty: every evidence line renders side by side with the note it cites
// (verifying against your own words IS the review act) or the filed
// document it came from; withheld / stripped counts are disclosed; a failed
// Generate keeps the cards already on screen; a failed Accept reports on its
// card and keeps the candidate.
// =============================================================================

interface Props {
  auditId: string;
  hasReached: boolean;
  isLight: boolean;
  /** null while the notes read is unknown (loading or failed) — the prune waits. */
  notes: AuditNoteObject[] | null;
  onPromoted: (entry: MockWorkspaceEntry, consumedNoteIds: string[]) => void;
}

const CLASSIFICATION_OPTIONS = Object.keys(
  PROVISIONAL_CLASSIFICATION_LABELS,
) as ProvisionalClassification[];

function citedNoteIds(c: ObservationCandidate): string[] {
  return [...new Set(c.evidence.flatMap((e) => e.source_note_ids))];
}

function passageWhere(p: {
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}): string {
  const parts = [
    p.section_heading ? `§ ${p.section_heading}` : null,
    p.page_start !== null
      ? `p. ${p.page_start}${p.page_end !== null && p.page_end !== p.page_start ? `–${p.page_end}` : ''}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : 'filed document';
}

export default function VendorCandidatePanel({
  auditId,
  hasReached,
  isLight,
  notes,
  onPromoted,
}: Props) {
  // Keyed by auditId at the mount, so the initializer runs once per audit.
  const [stash] = useState(() => readCandidateStash(auditId));
  const [candidates, setCandidates] = useState<StashedCandidate[]>(stash?.candidates ?? []);
  const [withheldCount, setWithheldCount] = useState(stash?.withheld_count ?? 0);
  const [strippedProtoCount, setStrippedProtoCount] = useState(
    stash?.stripped_protocol_ref_count ?? 0,
  );
  const [classificationByKey, setClassificationByKey] = useState<
    Record<string, ProvisionalClassification>
  >({});
  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<{ key: string; message: string } | null>(null);

  const persist = (
    next: StashedCandidate[],
    withheld = withheldCount,
    strippedProto = strippedProtoCount,
  ) => {
    setCandidates(next);
    writeCandidateStash(auditId, {
      candidates: next,
      withheld_count: withheld,
      stripped_protocol_ref_count: strippedProto,
    });
  };

  // Prune stashed candidates whose cited notes are gone or promoted.
  // Evidence-only candidates cite no notes and always survive.
  useEffect(() => {
    if (notes === null || candidates.length === 0) return;
    const citable = new Set(
      notes.filter((n) => n.promoted_entry_id === null && n.promoted_finding_id === null).map((n) => n.id),
    );
    const still = candidates.filter((c) => citedNoteIds(c).every((id) => citable.has(id)));
    if (still.length !== candidates.length) persist(still);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes]);

  const runDrafting = async () => {
    if (drafting) return;
    setDrafting(true);
    setDraftNote(null);
    const res = await requestObservationCandidates(auditId);
    setDrafting(false);
    if (!res.ok) {
      // Cards already on screen stay — the failure is about this run only.
      setDraftNote(res.error);
      return;
    }
    const stamp = Date.now();
    const next: StashedCandidate[] = res.data.candidates.map((c, i) => ({
      ...c,
      key: `${stamp}-${i}`,
      dirty: false,
    }));
    setWithheldCount(res.data.withheld_count);
    setStrippedProtoCount(res.data.stripped_protocol_ref_count);
    setClassificationByKey({});
    setAcceptError(null);
    persist(next, res.data.withheld_count, res.data.stripped_protocol_ref_count);
    if (next.length === 0) {
      setDraftNote(
        res.data.withheld_count > 0
          ? 'Every proposal was withheld — none could be traced to your notes or filed evidence. Add detail to the notes and retry.'
          : 'PIQC found nothing to propose from the current notes and evidence.',
      );
    }
  };

  const patch = (key: string, change: Partial<ObservationCandidate>) => {
    persist(candidates.map((c) => (c.key === key ? { ...c, ...change, dirty: true } : c)));
  };

  const dismiss = (key: string) => {
    if (acceptError?.key === key) setAcceptError(null);
    persist(candidates.filter((c) => c.key !== key));
  };

  const accept = async (c: StashedCandidate) => {
    if (acceptingKey) return;
    setAcceptingKey(c.key);
    setAcceptError(null);
    const res = await promoteWorkspaceCandidate(auditId, {
      vendorDomain: c.vendor_domain.trim(),
      observationText: c.observation_text.trim(),
      evidence: c.evidence,
      edited: c.dirty,
      checkpointRef: c.checkpoint_ref?.trim() || null,
      protocolRef: c.protocol_ref,
      provisionalClassification: classificationByKey[c.key] ?? 'NOT_YET_CLASSIFIED',
    });
    setAcceptingKey(null);
    if (res.ok) {
      persist(candidates.filter((x) => x.key !== c.key));
      onPromoted(res.data, citedNoteIds(c));
    } else {
      setAcceptError({ key: c.key, message: res.error });
    }
  };

  const notesById = new Map((notes ?? []).map((n) => [n.id, n]));

  // ---------------------------------------------------------------------------
  // Theme tokens — same palette as the pad.
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-slate-200' : 'bg-slate-900 border-white/5';
  const rowBorder = isLight ? 'border-slate-200' : 'border-white/5';
  const innerCard = isLight ? 'bg-slate-50 border-slate-200' : 'bg-white/[0.02] border-white/10';
  const inputBase = isLight
    ? 'bg-white border-slate-300 focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'bg-slate-900 border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  // Dark-ink-on-brand label: the house idiom (AuditConductWorkspace's
  // buttonPrimary) — no fg-* token exists for inverse text yet.
  const primaryBtn = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const brandText = isLight ? 'text-brand-600' : 'text-brand-300';
  const amberChip = isLight
    ? 'bg-amber-50 border-amber-200 text-amber-700'
    : 'bg-amber-500/10 border-amber-500/25 text-amber-300';
  const redBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';
  const quoteBorder = isLight ? 'border-slate-300' : 'border-white/15';

  return (
    <section data-testid="vendor-candidate-panel" className={`${cardBg} border rounded-xl`}>
      <div className={`flex flex-wrap items-center gap-2 px-4 py-3 border-b ${rowBorder}`}>
        <Sparkles size={15} className={brandText} />
        <h3 className="text-fg-heading text-sm font-semibold">PIQC-drafted observations</h3>
        {candidates.length > 0 && (
          <span className="text-fg-muted text-xs" data-testid="vendor-candidate-count">
            {candidates.length === 1 ? '1 candidate' : `${candidates.length} candidates`} to review
          </span>
        )}
        {hasReached && (
          <button
            type="button"
            onClick={() => void runDrafting()}
            disabled={drafting}
            data-testid="vendor-candidate-generate"
            className={`ml-auto rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${primaryBtn}`}
          >
            {drafting ? 'Drafting…' : candidates.length > 0 ? 'Draft again' : 'Draft observations'}
          </button>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        <p className="text-fg-muted text-xs leading-relaxed">
          PIQC reads your un-promoted notes and the filed evidence and proposes observations
          for you to consider — one root cause per candidate, every evidence line citing the
          note or document it came from. Nothing is recorded until you accept.{' '}
          <span className="font-medium">
            Accepting adds an entry to the observation record; an approved findings report will
            be flagged for re-review.
          </span>
        </p>

        {draftNote && (
          <p className="text-fg-sub text-sm" data-testid="vendor-candidate-note" role="status">
            {draftNote}
          </p>
        )}

        {candidates.length > 0 && (withheldCount > 0 || strippedProtoCount > 0) && (
          <p className="text-fg-sub text-xs" data-testid="vendor-candidate-counts">
            {withheldCount > 0 &&
              `${withheldCount} ${withheldCount === 1 ? 'proposal was' : 'proposals were'} withheld — ${withheldCount === 1 ? 'it' : 'they'} couldn't be traced to your notes or evidence. `}
            {strippedProtoCount > 0 &&
              `${strippedProtoCount} protocol ${strippedProtoCount === 1 ? 'citation' : 'citations'} that couldn't be verified against the protocol text ${strippedProtoCount === 1 ? 'was' : 'were'} removed.`}
          </p>
        )}

        {candidates.length === 0 && !draftNote && (
          <p className="text-fg-muted text-xs">
            {hasReached
              ? 'No candidates yet. Draft when your notes have enough detail to propose from.'
              : 'Candidates are drafted once the audit reaches this stage.'}
          </p>
        )}

        {candidates.map((c) => {
          const rowError = acceptError?.key === c.key ? acceptError.message : null;
          const canAccept =
            hasReached &&
            acceptingKey === null &&
            c.vendor_domain.trim().length > 0 &&
            c.observation_text.trim().length > 0;
          return (
            <div
              key={c.key}
              data-testid={`vendor-candidate-${c.key}`}
              className={`rounded-lg border ${innerCard}`}
            >
              <div className={`flex flex-wrap items-center gap-2 px-3 py-2 border-b ${rowBorder}`}>
                <Sparkles size={12} className={brandText} />
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${brandText}`}>
                  Candidate
                </span>
                {c.dirty && (
                  <span
                    data-testid={`vendor-candidate-edited-${c.key}`}
                    className={`rounded border px-1.5 py-0.5 text-[10px] ${amberChip}`}
                  >
                    Edited
                  </span>
                )}
                <input
                  value={c.vendor_domain}
                  onChange={(e) => patch(c.key, { vendor_domain: e.target.value })}
                  disabled={!hasReached}
                  aria-label="Domain"
                  data-testid={`vendor-candidate-domain-${c.key}`}
                  className={`ml-auto w-44 rounded-md border px-2 py-1 text-xs text-fg-body outline-none disabled:opacity-70 ${inputBase}`}
                />
              </div>

              <div className="p-3 space-y-2.5">
                <textarea
                  value={c.observation_text}
                  onChange={(e) => patch(c.key, { observation_text: e.target.value })}
                  disabled={!hasReached}
                  rows={3}
                  aria-label="Observation"
                  data-testid={`vendor-candidate-observation-${c.key}`}
                  className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y disabled:opacity-70 ${inputBase}`}
                />
                <input
                  value={c.checkpoint_ref ?? ''}
                  onChange={(e) => patch(c.key, { checkpoint_ref: e.target.value })}
                  disabled={!hasReached}
                  placeholder="Vendor SOP / document reference (optional)"
                  aria-label="Checkpoint reference"
                  data-testid={`vendor-candidate-checkpoint-${c.key}`}
                  className={`w-full rounded-md border px-3 py-1.5 text-xs text-fg-body placeholder:text-fg-muted outline-none disabled:opacity-70 ${inputBase}`}
                />

                {/* Verified protocol quote (post-Gate-3). Delta-only provenance
                    on accept — entries carry no protocol_refs column. */}
                {c.protocol_ref && (
                  <div className={`rounded-md border ${rowBorder} px-3 py-2`}>
                    <div className="flex items-center gap-1.5">
                      <BookOpen size={11} className={brandText} />
                      <span className={`text-[10px] font-semibold ${brandText}`}>
                        Protocol requirement · {passageWhere(c.protocol_ref)}
                      </span>
                      {hasReached && (
                        <button
                          type="button"
                          onClick={() => patch(c.key, { protocol_ref: null })}
                          className="ml-auto text-fg-muted hover:text-fg-body"
                          aria-label="Remove protocol citation"
                        >
                          <XIcon size={11} />
                        </button>
                      )}
                    </div>
                    <p className="text-fg-sub text-[11px] mt-1 italic">“{c.protocol_ref.quote}”</p>
                  </div>
                )}

                {/* Evidence — side by side with what it cites. */}
                <div className="space-y-2" data-testid={`vendor-candidate-evidence-${c.key}`}>
                  {c.evidence.map((ev, i) => (
                    <div key={i} className={`rounded-md border ${rowBorder} px-3 py-2`}>
                      <p className="text-fg-body text-xs">{ev.text}</p>
                      {ev.source_note_ids.map((id) => {
                        const src = notesById.get(id);
                        return (
                          <p
                            key={id}
                            className={`text-fg-muted text-[11px] mt-1 pl-2 border-l-2 ${quoteBorder}`}
                          >
                            <span className="font-medium">Your note:</span>{' '}
                            {src ? src.body : '(note not loaded)'}
                          </p>
                        );
                      })}
                      {ev.source_passages.map((p) => (
                        <p
                          key={p.chunk_id}
                          className={`flex items-center gap-1 text-fg-muted text-[11px] mt-1 pl-2 border-l-2 ${quoteBorder}`}
                        >
                          <FileText size={10} />
                          Filed evidence · {passageWhere(p)}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>

                {rowError && (
                  <div
                    role="alert"
                    data-testid={`vendor-candidate-error-${c.key}`}
                    className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs leading-relaxed ${redBox}`}
                  >
                    <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                    <p className="flex-1">Not accepted — {rowError}</p>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {hasReached && (
                    <label className="flex items-center gap-1.5 text-fg-muted text-xs">
                      Classification
                      <select
                        value={classificationByKey[c.key] ?? 'NOT_YET_CLASSIFIED'}
                        onChange={(e) =>
                          setClassificationByKey((prev) => ({
                            ...prev,
                            [c.key]: e.target.value as ProvisionalClassification,
                          }))
                        }
                        aria-label="Classification"
                        data-testid={`vendor-candidate-classification-${c.key}`}
                        className={`rounded-md border px-2 py-1 text-xs text-fg-body outline-none ${inputBase}`}
                      >
                        {CLASSIFICATION_OPTIONS.map((value) => (
                          <option key={value} value={value}>
                            {PROVISIONAL_CLASSIFICATION_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => dismiss(c.key)}
                      data-testid={`vendor-candidate-dismiss-${c.key}`}
                      className="text-fg-muted text-xs hover:text-fg-body"
                    >
                      Dismiss
                    </button>
                    {hasReached && (
                      <button
                        type="button"
                        onClick={() => void accept(c)}
                        disabled={!canAccept}
                        data-testid={`vendor-candidate-accept-${c.key}`}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                      >
                        {acceptingKey === c.key ? 'Accepting…' : 'Accept as observation'}
                      </button>
                    )}
                  </div>
                </div>
                {c.dirty && hasReached && (
                  <p className="text-fg-muted text-[11px]">
                    Recorded as PIQC-drafted, edited by you — the accepted text is what goes on record.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
