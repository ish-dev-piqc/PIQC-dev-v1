import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, BookOpen, FileText, X as XIcon } from 'lucide-react';
import { useAuth } from '../../../../../context/AuthContext';
import {
  EMPTY_CANDIDATE_STASH,
  isCandidateEdited,
  readCandidateStash,
  requestObservationCandidates,
  stashCandidate,
  writeCandidateStash,
  type CandidateStash,
  type ObservationCandidate,
  type StashedCandidate,
} from '../../../../../lib/audit/observationDraftApi';
import { promoteWorkspaceCandidate } from '../../../../../lib/audit/workspaceEntriesApi';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import {
  PROVISIONAL_CLASSIFICATION_LABELS,
  PROVISIONAL_CLASSIFICATION_ORDER,
} from '../../../../../lib/audit/labels';
import { formatProtocolRefWhere } from '../../../../../lib/audit/isaReportModel';
import PiqcMark from '../../PiqcMark';
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
// transaction, one delta). A candidate carries no severity or
// classification — the auditor picks the classification here, defaulting to
// NOT_YET_CLASSIFIED, which keeps the entry out of report bodies and blocks
// Stage-8 sign-off until it is classified. Whether the accepted text was
// edited is decided by the server against the proposal it was drafted from;
// the "Edited" chip here is the same comparison, so the two never disagree.
//
// Candidates live in ONE state slot — the stash shape — hydrated from
// localStorage (scoped to the signed-in user and the audit) once the user is
// known, written back debounced, flushed on unmount. Every state change is a
// functional update, so an edit made while an Accept is in flight survives
// the Accept resolving. Stashed candidates whose cited notes are gone or
// promoted are pruned only once the notes are KNOWN for this audit.
//
// Honesty: every evidence line renders side by side with the note it cites
// (verifying against your own words IS the review act) or the filed document
// it came from — so while the notes are unknown (loading or failed) neither
// Draft nor Accept is armed. Withheld / stripped counts are disclosed; a
// failed Draft keeps the cards already on screen; a failed Accept reports on
// its card and keeps the candidate.
// =============================================================================

type NotesStatus = 'loading' | 'ready' | 'failed';

interface Props {
  auditId: string;
  hasReached: boolean;
  isLight: boolean;
  notes: AuditNoteObject[];
  notesStatus: NotesStatus;
  onPromoted: (entry: MockWorkspaceEntry, consumedNoteIds: string[]) => void;
}

const STASH_WRITE_DELAY_MS = 400;

function mintKey(i: number): string {
  return `${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 10)}`;
}

function citedNoteIds(c: ObservationCandidate): string[] {
  return [...new Set(c.evidence.flatMap((e) => e.source_note_ids))];
}

// The shared locator formatter reads only section/pages; a passage carries
// no quote. Its no-locator fallback names the protocol, which a filed
// document is not — so that case renders as nothing here.
function passageWhere(p: {
  section_heading: string | null;
  page_start: number | null;
  page_end: number | null;
}): string {
  const where = formatProtocolRefWhere({ chunk_id: null, document_id: null, quote: '', ...p });
  return where === 'Protocol' ? '' : where;
}

export default function VendorCandidatePanel({
  auditId,
  hasReached,
  isLight,
  notes,
  notesStatus,
  onPromoted,
}: Props) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // ---------------------------------------------------------------------------
  // Stash: hydrate → (debounced) persist → flush on unmount.
  // ---------------------------------------------------------------------------
  const [stash, setStash] = useState<CandidateStash>(EMPTY_CANDIDATE_STASH);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!userId) return;
    setStash(readCandidateStash(userId, auditId) ?? EMPTY_CANDIDATE_STASH);
    setHydrated(true);
  }, [userId, auditId]);

  const latest = useRef({ stash, hydrated, userId });
  latest.current = { stash, hydrated, userId };
  useEffect(() => {
    if (!hydrated || !userId) return;
    // Debounced: per-keystroke serialization of every card is wasted disk.
    const timer = setTimeout(() => writeCandidateStash(userId, auditId, stash), STASH_WRITE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [stash, hydrated, userId, auditId]);
  useEffect(
    () => () => {
      const { stash: s, hydrated: h, userId: u } = latest.current;
      if (h && u) writeCandidateStash(u, auditId, s);
    },
    [auditId],
  );

  // Prune stashed candidates whose cited notes are gone or promoted — only
  // once the notes are known for THIS audit (an Accept on them would rightly
  // fail the DB gate). Evidence-only candidates cite no notes and survive.
  useEffect(() => {
    if (!hydrated || notesStatus !== 'ready') return;
    const citable = new Set(
      notes
        .filter((n) => n.promoted_entry_id === null && n.promoted_finding_id === null)
        .map((n) => n.id),
    );
    setStash((prev) => {
      const still = prev.candidates.filter((c) => citedNoteIds(c).every((id) => citable.has(id)));
      return still.length === prev.candidates.length ? prev : { ...prev, candidates: still };
    });
  }, [hydrated, notes, notesStatus]);

  const [drafting, setDrafting] = useState(false);
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
  const acceptingRef = useRef(false);
  const [acceptError, setAcceptError] = useState<{ key: string; message: string } | null>(null);

  const notesKnown = notesStatus === 'ready';
  const notesById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const runDrafting = async () => {
    if (drafting || !notesKnown) return;
    setDrafting(true);
    setDraftNote(null);
    const res = await requestObservationCandidates(auditId);
    setDrafting(false);
    if (!res.ok) {
      // Cards already on screen stay — the failure is about this run only.
      setDraftNote(res.error);
      return;
    }
    const { candidates, withheld_count, stripped_protocol_ref_count, engine, drafted_at } = res.data;
    setAcceptError(null);
    setStash({
      candidates: candidates.map((c, i) => stashCandidate(c, engine, drafted_at, mintKey(i))),
      withheld_count,
      stripped_protocol_ref_count,
    });
    if (candidates.length === 0) {
      setDraftNote(
        withheld_count > 0
          ? 'Every proposal was withheld — none could be traced to your notes or filed evidence. Add detail and retry.'
          : 'PIQC found nothing to propose from the current notes and evidence.',
      );
    }
  };

  const patch = (key: string, change: Partial<ObservationCandidate>) =>
    setStash((prev) => ({
      ...prev,
      candidates: prev.candidates.map((c) => (c.key === key ? { ...c, ...change } : c)),
    }));

  const classify = (key: string, classification: ProvisionalClassification) =>
    setStash((prev) => ({
      ...prev,
      candidates: prev.candidates.map((c) => (c.key === key ? { ...c, classification } : c)),
    }));

  const dismiss = (key: string) => {
    if (!hasReached) return;
    setAcceptError((e) => (e?.key === key ? null : e));
    setStash((prev) => ({ ...prev, candidates: prev.candidates.filter((c) => c.key !== key) }));
  };

  const accept = async (c: StashedCandidate) => {
    // Ref, not state: two clicks in one frame both read the same render.
    if (acceptingRef.current || !hasReached || !notesKnown) return;
    acceptingRef.current = true;
    setAcceptingKey(c.key);
    setAcceptError(null);
    const res = await promoteWorkspaceCandidate(auditId, {
      candidateKey: c.key,
      vendorDomain: c.vendor_domain.trim(),
      observationText: c.observation_text.trim(),
      checkpointRef: c.checkpoint_ref?.trim() || null,
      evidence: c.evidence,
      protocolRef: c.protocol_ref,
      drafted: c.drafted,
      engine: c.engine,
      provisionalClassification: c.classification,
    });
    acceptingRef.current = false;
    setAcceptingKey(null);
    if (res.ok) {
      setStash((prev) => ({ ...prev, candidates: prev.candidates.filter((x) => x.key !== c.key) }));
      onPromoted(res.data, citedNoteIds(c));
    } else {
      setAcceptError({ key: c.key, message: res.error });
    }
  };

  const { candidates, withheld_count: withheldCount, stripped_protocol_ref_count: strippedProtoCount } =
    stash;

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
        <PiqcMark size={15} className={brandText} />
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
            disabled={drafting || !notesKnown}
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

        {hasReached && notesStatus === 'failed' && (
          <p
            role="alert"
            data-testid="vendor-candidate-notes-hint"
            className={`px-3 py-2 rounded-md border text-xs ${redBox}`}
          >
            Notes could not be loaded — retry in the notes pad above before drafting or
            accepting. Candidates are reviewed against your notes, not instead of them.
          </p>
        )}

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
          const edited = isCandidateEdited(c);
          const busy = acceptingKey === c.key;
          const locked = !hasReached || busy;
          const rowError = acceptError?.key === c.key ? acceptError.message : null;
          const canAccept =
            hasReached &&
            notesKnown &&
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
                <PiqcMark size={12} className={brandText} />
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${brandText}`}>
                  Candidate
                </span>
                {edited && (
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
                  disabled={locked}
                  aria-label="Domain"
                  data-testid={`vendor-candidate-domain-${c.key}`}
                  className={`ml-auto w-44 rounded-md border px-2 py-1 text-xs text-fg-body outline-none disabled:opacity-70 ${inputBase}`}
                />
              </div>

              <div className="p-3 space-y-2.5">
                <textarea
                  value={c.observation_text}
                  onChange={(e) => patch(c.key, { observation_text: e.target.value })}
                  disabled={locked}
                  rows={3}
                  aria-label="Observation"
                  data-testid={`vendor-candidate-observation-${c.key}`}
                  className={`w-full rounded-md border px-3 py-2 text-sm text-fg-body outline-none resize-y disabled:opacity-70 ${inputBase}`}
                />
                <input
                  value={c.checkpoint_ref ?? ''}
                  onChange={(e) => patch(c.key, { checkpoint_ref: e.target.value })}
                  disabled={locked}
                  placeholder="Vendor SOP / document reference (optional)"
                  aria-label="Checkpoint reference"
                  data-testid={`vendor-candidate-checkpoint-${c.key}`}
                  className={`w-full rounded-md border px-3 py-1.5 text-xs text-fg-body placeholder:text-fg-muted outline-none disabled:opacity-70 ${inputBase}`}
                />

                {/* Verified protocol quote (post-Gate-3) — goes on the record
                    as protocol_ref when accepted. */}
                {c.protocol_ref && (
                  <div className={`rounded-md border ${rowBorder} px-3 py-2`}>
                    <div className="flex items-center gap-1.5">
                      <BookOpen size={11} className={brandText} />
                      <span className={`text-[10px] font-semibold ${brandText}`}>
                        Protocol requirement · {formatProtocolRefWhere(c.protocol_ref)}
                      </span>
                      {!locked && (
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
                      {ev.source_passages.map((p) => {
                        const where = passageWhere(p);
                        return (
                          <p
                            key={p.chunk_id}
                            className={`flex items-center gap-1 text-fg-muted text-[11px] mt-1 pl-2 border-l-2 ${quoteBorder}`}
                          >
                            <FileText size={10} />
                            Filed evidence{where ? ` · ${where}` : ''}
                          </p>
                        );
                      })}
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
                    <div className="flex items-center gap-1.5 text-fg-muted text-xs">
                      Classification
                      <select
                        value={c.classification}
                        onChange={(e) => classify(c.key, e.target.value as ProvisionalClassification)}
                        disabled={busy}
                        aria-label="Classification"
                        data-testid={`vendor-candidate-classification-${c.key}`}
                        className={`rounded-md border px-2 py-1 text-xs text-fg-body outline-none ${inputBase}`}
                      >
                        {PROVISIONAL_CLASSIFICATION_ORDER.map((value) => (
                          <option key={value} value={value}>
                            {PROVISIONAL_CLASSIFICATION_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  {hasReached && (
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => dismiss(c.key)}
                        disabled={busy}
                        data-testid={`vendor-candidate-dismiss-${c.key}`}
                        className="text-fg-muted text-xs hover:text-fg-body disabled:opacity-40"
                      >
                        Dismiss
                      </button>
                      <button
                        type="button"
                        onClick={() => void accept(c)}
                        disabled={!canAccept}
                        data-testid={`vendor-candidate-accept-${c.key}`}
                        className={`rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-40 ${primaryBtn}`}
                      >
                        {busy ? 'Accepting…' : 'Accept as observation'}
                      </button>
                    </div>
                  )}
                </div>
                {edited && hasReached && (
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
