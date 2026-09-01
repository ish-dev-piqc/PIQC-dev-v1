import { useCallback, useState } from 'react';
import {
  applyDeliverableGeneration,
  requestDeliverableDraft,
  type DeliverableKind,
} from '../../../../lib/audit/deliverableGenerationApi';

// =============================================================================
// useDeliverableGeneration — grounded deliverable drafting (PR-C1 checklist,
// PR-C2 all three; extracted from PreAuditDraftingWorkspace in PR-6).
// Human-triggered only — the Q&A consciously rejected auto-regenerate.
// Proposals land as DRAFT through the apply RPCs (demote latch intact),
// then the caller's refresh refetches server truth.
// =============================================================================

interface UseDeliverableGenerationArgs {
  auditId: string;
  /** One-ahead preview (UX2): generation must never spend from ahead. */
  hasReached: boolean;
  /** The surface's never-throws bundle refetch; false = refresh failed. */
  refresh: () => Promise<boolean>;
  /** Options for the apply RPC (the letter merges its current recipients
   *  there — generation never sees or emits them). Evaluated when the apply
   *  fires, but against the closure of the render that armed the click —
   *  same staleness window as the pre-extraction inline flow: recipients
   *  saved while a draft request is in flight are not picked up. */
  applyOptions?: () => { currentRecipients?: string[] };
}

export function useDeliverableGeneration({
  auditId,
  hasReached,
  refresh,
  applyOptions,
}: UseDeliverableGenerationArgs) {
  const [generatingTab, setGeneratingTab] = useState<DeliverableKind | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Stable, so the caller's clear-on-tab-switch effect can dep on it.
  const clearGenerationError = useCallback(() => setGenerationError(null), []);

  const runGeneration = async (tab: DeliverableKind) => {
    if (!hasReached) return; // preview — never spend generation from ahead
    setGeneratingTab(tab);
    setGenerationError(null);
    try {
      const draft = await requestDeliverableDraft(auditId, tab);
      if (!draft.ok) {
        setGenerationError(draft.error);
        return;
      }
      const applied = await applyDeliverableGeneration(auditId, draft.data, applyOptions?.());
      if (!applied.ok) {
        setGenerationError(applied.error);
        return;
      }
      // Refetch server truth — one mapper, one read path.
      if (!(await refresh())) {
        setGenerationError(
          'The draft was applied, but refreshing the view failed — reload the page to see it.',
        );
      }
    } finally {
      // The panel must never strand at "Drafting…" — whatever happened above.
      setGeneratingTab(null);
    }
  };

  return { generatingTab, generationError, clearGenerationError, runGeneration };
}
