import { Sparkles } from 'lucide-react';
import {
  computeDeliverableCurrency,
  type DeliverableKind,
  type LiveEntryTuple,
} from '../../../../lib/audit/deliverableGenerationApi';
import type {
  AuditEvidenceListRow,
  DeliverableApprovalStatus,
  DeliverableGenerationRef,
  DeliverableGroundingSnapshot,
} from '../../../../types/audit';

// =============================================================================
// DeliverableGenerationPanel — grounded drafting controls + currency notice
// (PR-C1 checklist, PR-C2 all three; extracted from PreAuditDraftingWorkspace
// in PR-6). Renders above each deliverable tab. Three states:
//   never generated  → "Draft with PIQC" CTA (grounds in protocol + register)
//   generated, current → quiet provenance line + Revise with AI
//   generated, drifted → non-dismissable amber currency notice naming the
//                        new/removed sources + Revise with AI. Flag, never
//                        block: the auditor can approve and export regardless.
// =============================================================================

/** Structural floor of the deliverable row types — exactly the generation
 *  fields the panel reads. Every deliverable kind's row satisfies it. */
interface GenerationPanelDeliverable {
  approval_status: DeliverableApprovalStatus;
  generation_refs?: DeliverableGenerationRef[] | null;
  grounding_snapshot?: DeliverableGroundingSnapshot | null;
  generated_at?: string | null;
}

interface DeliverableGenerationPanelProps {
  /** Stable machine key — used verbatim in the `${kind}-*` data-testids the
   *  workspace tests pin, so it stays union-typed: a typo'd kind is a
   *  compile error, never a silently unmatched selector. */
  kind: DeliverableKind;
  /** Human noun for the copy, e.g. "confirmation letter". */
  noun: string;
  deliverable: GenerationPanelDeliverable | null;
  evidenceRows: AuditEvidenceListRow[] | null;
  generating: boolean;
  editing: boolean;
  error: string | null;
  isLight: boolean;
  /** One-ahead preview (UX2): the CTA disables honestly instead of the
   *  click dying silently against the generation hook's guard. */
  previewLocked?: boolean;
  /** Kind-specific sequence lock (the certificate's report-approval gate,
   *  PR-D6): when set, the CTA disables with this title. The server enforces
   *  the same rule — this is the honest surface of it, not the gate. */
  lockedReason?: string;
  /** Kind-specific privacy line rendered under the provenance copy (the
   *  confirmation letter's "recipients are never sent to the model"). The
   *  panel renders it verbatim — the CALLER owns the truth of the claim, so
   *  pair it only with the kind whose behavior it describes. */
  privacyNote?: string;
  /** Gap summary only (PR-D3): live checklist item ids for the snapshot's
   *  checklist-identity axis. Other kinds' snapshots carry no such axis, so
   *  they never pass this. */
  liveChecklistItemIds?: string[];
  /** Findings report only (PR-D4): the live Stage-6 entries for the
   *  snapshot's entries axis. Same rule as the checklist ids — pass only for
   *  the kind whose snapshot carries the axis. */
  liveEntries?: LiveEntryTuple[];
  onGenerate: () => void;
}

export default function DeliverableGenerationPanel({
  kind,
  noun,
  deliverable,
  evidenceRows,
  generating,
  editing,
  error,
  isLight,
  previewLocked = false,
  lockedReason,
  privacyNote,
  liveChecklistItemIds,
  liveEntries,
  onGenerate,
}: DeliverableGenerationPanelProps) {
  const subColor = 'text-fg-sub';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800 disabled:bg-[#CBD5E1]'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700 disabled:bg-white/10 disabled:text-white/35';

  const hasGeneration = !!deliverable?.grounding_snapshot;
  // No register data (fetch failed / still loading) → no currency verdict.
  // Diffing against [] would falsely flag every grounded source as removed.
  const currency = evidenceRows === null
    ? null
    : computeDeliverableCurrency(
        deliverable?.grounding_snapshot,
        evidenceRows,
        liveChecklistItemIds,
        liveEntries,
      );
  // The gap kind can drift on checklist identity alone, and the findings
  // report on entry identity alone — the header must not blame the register
  // for a change on another axis.
  const registerDrifted =
    !!currency &&
    (currency.newSinceGeneration.length > 0 ||
      currency.removedSinceGeneration.length > 0 ||
      (currency.withholdFlippedSinceGeneration?.length ?? 0) > 0);
  const refCount = deliverable?.generation_refs?.length ?? 0;
  const isApproved = deliverable?.approval_status === 'APPROVED';
  const evidenceCount = evidenceRows?.length ?? 0;

  const buttonLabel = generating
    ? hasGeneration ? 'Revising…' : 'Drafting…'
    : hasGeneration ? 'Revise with AI' : 'Draft with PIQC';

  return (
    <div className={`${cardBg} border rounded-xl px-4 py-3 space-y-2`} data-testid={`${kind}-generation-panel`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {hasGeneration ? (
            <p className={`${subColor} text-xs`}>
              <Sparkles size={11} className="inline mr-1 -mt-0.5" />
              Drafted by PIQC
              {deliverable?.generated_at
                ? ` on ${new Date(deliverable.generated_at).toLocaleDateString()}`
                : ''}
              {/* A register-carrying snapshot (gap summary) is grounded in the
                  FULL register — quoting the included-only evidence count
                  would contradict a body that names withheld docs too. */}
              {deliverable?.grounding_snapshot?.register
                ? ` from the protocol and the full evidence register (${deliverable.grounding_snapshot.register.length} document${deliverable.grounding_snapshot.register.length === 1 ? '' : 's'})`
                : ` from the protocol and ${deliverable?.grounding_snapshot?.evidence.length ?? 0} evidence source${(deliverable?.grounding_snapshot?.evidence.length ?? 0) === 1 ? '' : 's'}`}
              {refCount > 0 ? ` · ${refCount} cited passage${refCount === 1 ? '' : 's'}` : ''}.
              {' '}Every citation quotes its source verbatim — invalid ones are stripped, never repaired.
            </p>
          ) : (
            <p className={`${subColor} text-xs`}>
              PIQC can draft this {noun} grounded in the protocol
              {evidenceCount > 0
                ? ` and the ${evidenceCount} attached evidence source${evidenceCount === 1 ? '' : 's'}`
                : ''}
              . It lands as a Draft for your review — nothing is approved for you.
            </p>
          )}
          {isApproved && (
            <p className={`${subColor} text-[11px] mt-1`}>
              This {noun} is Approved — revising returns it to Draft.
            </p>
          )}
          {privacyNote && (
            <p className={`${subColor} text-[11px] mt-1`}>
              {privacyNote}
            </p>
          )}
        </div>
        <button
          type="button"
          // Editing blocks generation only when a persisted row exists
          // (revise would overwrite unsaved edits). A never-saved create form
          // doesn't block: on an empty deliverable — prefill gated off — the
          // draft CTA is the whole point, and the click is an explicit choice
          // to replace the scratch form.
          disabled={generating || (editing && !!deliverable) || previewLocked || !!lockedReason}
          onClick={onGenerate}
          title={
            previewLocked
              ? 'Available when the audit reaches this stage'
              : lockedReason
              ? lockedReason
              : editing && deliverable
              ? 'Save or cancel your edits first — revising would overwrite them'
              : undefined
          }
          data-testid={`${kind}-generate-button`}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors flex-shrink-0 ${buttonPrimary}`}
        >
          <Sparkles size={12} />
          {buttonLabel}
        </button>
      </div>

      {currency && !currency.isCurrent && (
        <div
          data-testid={`${kind}-currency-notice`}
          className={`border rounded-md px-3 py-2 text-xs ${
            isLight
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-amber-500/15 border-amber-500/30 text-amber-300'
          }`}
        >
          <span className="font-semibold">
            {registerDrifted
              ? 'The evidence register has changed since this draft.'
              : currency.entriesChanged === true
              ? 'The audit observations have changed since this draft.'
              : 'The checklist has changed since this draft.'}
          </span>{' '}
          {currency.newSinceGeneration.length > 0 && (
            <>New: {currency.newSinceGeneration.map((d) => d.title).join(', ')}. </>
          )}
          {currency.removedSinceGeneration.length > 0 && (
            <>Removed: {currency.removedSinceGeneration.map((d) => d.title).join(', ')}. </>
          )}
          {(currency.withholdFlippedSinceGeneration?.length ?? 0) > 0 && (
            <>
              Withhold flag changed:{' '}
              {(currency.withholdFlippedSinceGeneration ?? []).map((d) => d.title).join(', ')}.{' '}
            </>
          )}
          {registerDrifted && currency.checklistChanged === true && (
            <>The checklist's items have also changed. </>
          )}
          {registerDrifted && currency.entriesChanged === true && (
            <>The audit observations have also changed. </>
          )}
          Revise when you're ready — this never blocks approval or export.
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-500">
          {error} — your {noun} is unchanged.
        </p>
      )}
    </div>
  );
}
