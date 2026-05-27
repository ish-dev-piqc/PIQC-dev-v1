import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, FlaskConical, X } from 'lucide-react';
import { useProtocol } from '../../../context/ProtocolContext';
import { useTheme } from '../../../context/ThemeContext';
import { fetchVisitExecutionWorkspaces, isMockEnabled } from '../../../lib/visit-execution/visitExecutionApi';
import {
  flagForReview,
  markReviewed,
  unmarkReviewed,
} from '../../../lib/visit-execution/visitExecutionMutationsApi';
import type {
  ExecutionReviewStatus,
  VisitExecutionItem,
  VisitExecutionWorkspace,
} from '../../../types/visit-execution';
import VisitNavigator from './VisitNavigator';
import VisitSnapshotCard from './VisitSnapshotCard';
import ExecutionChecklist from './ExecutionChecklist';
import TraceabilityDrawer from './TraceabilityDrawer';
import ExportPlaceholderButton from './ExportPlaceholderButton';

// =============================================================================
// VisitExecutionTab — root component for the new primary Site Mode surface.
//
// Layout:
//   - Left rail: VisitNavigator (visit list with indicator chips)
//   - Right pane: VisitSnapshotCard (above-fold summary + timing) +
//                 ExecutionChecklist (workflow-ordered grouped items) +
//                 ExportPlaceholderButton at the bottom
//   - Drawer overlay: TraceabilityDrawer (one instance, item-scoped)
//
// State owned here:
//   - workspaces[]   — loaded once per active protocol
//   - selectedVisitTemplateId
//   - reviewStatus Map<itemId, ExecutionReviewStatus> — optimistic-update
//     override on top of each item's persisted review_status. Seeded empty
//     on workspace load; populated on each successful mutation. Sprint 4a
//     wires this Map to real RPC writes (visit_execution_set_review_status)
//     via visitExecutionMutationsApi.
//   - mutationError: string | null — most-recent mutation failure, shown as
//     a dismissable banner above the checklist
//   - traceabilityItem (VisitExecutionItem | null)
//
// No context promotion yet — single consumer of this data so far.
// =============================================================================

export default function VisitExecutionTab() {
  const { activeProtocol } = useProtocol();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [workspaces, setWorkspaces] = useState<VisitExecutionWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<Map<string, ExecutionReviewStatus>>(new Map());
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [traceabilityItem, setTraceabilityItem] = useState<VisitExecutionItem | null>(null);

  // Load workspaces when the active protocol changes.
  useEffect(() => {
    if (!activeProtocol) {
      setWorkspaces([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchVisitExecutionWorkspaces(activeProtocol.id).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setWorkspaces([]);
        setSelectedId(null);
        return;
      }
      setWorkspaces(r.data);
      // Default to first visit (lowest study_day, set by adapter sort).
      if (r.data.length > 0) {
        setSelectedId(r.data[0].visit_template_id);
      } else {
        setSelectedId(null);
      }
      // Reset review state when protocol changes — review state isn't persisted yet.
      setReviewStatus(new Map());
      setTraceabilityItem(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.visit_template_id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const reviewedCountForSelected = useMemo(() => {
    if (!selectedWorkspace) return 0;
    return selectedWorkspace.items.filter(
      (i) => (reviewStatus.get(i.id) ?? i.review_status) === 'reviewed',
    ).length;
  }, [selectedWorkspace, reviewStatus]);

  // Helper: read the effective current status for an item (optimistic
  // override OR persisted value). Used to compute the "what to revert to"
  // value on RPC failure.
  const effectiveStatusFor = useCallback(
    (itemId: string): ExecutionReviewStatus => {
      const override = reviewStatus.get(itemId);
      if (override) return override;
      const item = selectedWorkspace?.items.find((i) => i.id === itemId);
      return item?.review_status ?? 'not_reviewed';
    },
    [reviewStatus, selectedWorkspace],
  );

  // Generic optimistic-mutation runner. Updates the local Map immediately,
  // fires the RPC, reverts on failure with an error banner. Sprint 4a wires
  // four entry points (markReviewed / unmarkReviewed / flagForReview /
  // markNeedsClarification) through this one helper.
  const runReviewMutation = useCallback(
    async (
      itemId: string,
      optimisticNext: ExecutionReviewStatus,
      rpc: () => Promise<{ ok: true; data: { review_status: ExecutionReviewStatus } } | { ok: false; error: string }>,
    ) => {
      const prior = effectiveStatusFor(itemId);
      // Optimistic update.
      setReviewStatus((prev) => {
        const next = new Map(prev);
        next.set(itemId, optimisticNext);
        return next;
      });
      setMutationError(null);

      const result = await rpc();
      if (!result.ok) {
        // Revert.
        setReviewStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, prior);
          return next;
        });
        setMutationError(result.error);
        return;
      }
      // Server-authoritative final state. Usually matches optimisticNext,
      // but if the RPC has rules that snap to a different value (e.g. a
      // future server-side validation), we honor whatever the server says.
      if (result.data.review_status !== optimisticNext) {
        setReviewStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, result.data.review_status);
          return next;
        });
      }
    },
    [effectiveStatusFor],
  );

  const handleToggleReviewed = useCallback(
    (itemId: string) => {
      const current = effectiveStatusFor(itemId);
      if (current === 'reviewed') {
        void runReviewMutation(itemId, 'not_reviewed', () => unmarkReviewed(itemId));
      } else {
        void runReviewMutation(itemId, 'reviewed', () => markReviewed(itemId));
      }
    },
    [effectiveStatusFor, runReviewMutation],
  );

  const handleSetStatus = useCallback(
    (itemId: string, nextStatus: ExecutionReviewStatus) => {
      // The menu items that route through onSetStatus today are "Flag for
      // review" and "Mark needs clarification" (both → 'needs_review'). The
      // RPC distinguishes them via the action enum even though the resulting
      // status is identical. We can't tell them apart from `nextStatus`
      // alone here — the menu in ExecutionChecklist would need to plumb the
      // action through. For 4a we default to 'flag_for_review'; Sprint 4b
      // adds the discriminator when it adds the note-input UI.
      //
      // 'site_note_added' is unreachable in 4a (Add-site-note removed from
      // the menu). Treated as a programmer-error guard.
      if (nextStatus === 'reviewed') {
        void runReviewMutation(itemId, 'reviewed', () => markReviewed(itemId));
        return;
      }
      if (nextStatus === 'not_reviewed') {
        void runReviewMutation(itemId, 'not_reviewed', () => unmarkReviewed(itemId));
        return;
      }
      if (nextStatus === 'needs_review') {
        void runReviewMutation(itemId, 'needs_review', () => flagForReview(itemId));
        return;
      }
      if (nextStatus === 'site_note_added') {
        // Programmer error in 4a — the menu shouldn't surface this. Log + ignore.
        console.warn('[vew] add_site_note path not wired until Sprint 4b', { itemId });
        return;
      }
      if (nextStatus === 'edited') {
        // edited goes through visit_execution_edit_text — wired in 4b.
        console.warn('[vew] edit_text path not wired until Sprint 4b', { itemId });
        return;
      }
    },
    [runReviewMutation],
  );


  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-sub text-sm gap-2">
        <Loader2 size={14} className="animate-spin" />
        Loading visit workspaces…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-fg-heading text-sm font-semibold mb-1">Couldn't load visits</p>
          <p className="text-fg-sub text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!activeProtocol) {
    return null;
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <FlaskConical size={20} className="mx-auto text-fg-muted mb-3" aria-hidden />
          <p className="text-fg-heading text-sm font-semibold mb-1">
            No visit templates yet for this protocol
          </p>
          <p className="text-fg-sub text-xs leading-relaxed">
            Upload a protocol PDF in the Protocol tab and the parsed Schedule
            of Events will appear here.{' '}
            {!isMockEnabled() && (
              <>
                To preview with sample data, enable the mock toggle:
                <code className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                  isLight ? 'bg-[#eef2f6]' : 'bg-white/[0.05]'
                }`}>
                  localStorage.setItem('piq-visit-execution-mock-v1', '1')
                </code>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <VisitNavigator
        workspaces={workspaces}
        selectedVisitTemplateId={selectedId}
        onSelect={setSelectedId}
        reviewStatusByItemId={reviewStatus}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-5">
          {selectedWorkspace ? (
            <>
              <VisitSnapshotCard
                snapshot={selectedWorkspace.snapshot}
                reviewedCount={reviewedCountForSelected}
                totalItems={selectedWorkspace.items.length}
              />

              {mutationError && (
                <div
                  role="alert"
                  data-testid="vew-mutation-error-banner"
                  className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
                    isLight
                      ? 'bg-[#fdecec] border-[#f3c7c7] text-[#742a2a]'
                      : 'bg-[#3b1f1f] border-[#5a2e2e] text-[#f5b8b8]'
                  }`}
                >
                  <span className="flex-1 leading-relaxed">
                    Couldn't save that change: {mutationError}. Your previous state was restored —
                    try again.
                  </span>
                  <button
                    type="button"
                    onClick={() => setMutationError(null)}
                    aria-label="Dismiss error"
                    className="opacity-70 hover:opacity-100"
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              )}

              <ExecutionChecklist
                workspace={selectedWorkspace}
                reviewStatus={reviewStatus}
                onToggleReviewed={handleToggleReviewed}
                onSetStatus={handleSetStatus}
                onOpenTraceability={setTraceabilityItem}
              />

              <div className="flex items-center justify-between pt-2">
                <p className="text-fg-muted text-[11px] leading-relaxed max-w-md">
                  This workspace is a draft. Final source-document authoring and
                  approval are performed outside PIQC.
                </p>
                <ExportPlaceholderButton />
              </div>
            </>
          ) : (
            <p className="text-fg-sub text-sm">Select a visit on the left to begin.</p>
          )}
        </div>
      </div>

      <TraceabilityDrawer
        item={traceabilityItem}
        onClose={() => setTraceabilityItem(null)}
      />
    </div>
  );
}
