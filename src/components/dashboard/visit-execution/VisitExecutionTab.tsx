import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FlaskConical, X, AlertTriangle } from 'lucide-react';
import { useProtocol } from '../../../context/ProtocolContext';
import { useTheme } from '../../../context/ThemeContext';
import { fetchVisitExecutionWorkspaces, isMockEnabled } from '../../../lib/visit-execution/visitExecutionApi';
import {
  addSiteNote,
  editText,
  flagForReview,
  markNeedsClarification,
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
import ExecutionChecklist, { type ChecklistItemAction } from './ExecutionChecklist';
import TraceabilityDrawer from './TraceabilityDrawer';
import ExportPlaceholderButton from './ExportPlaceholderButton';
import RequirementTextDrawer, {
  type RequirementTextDrawerMode,
} from './RequirementTextDrawer';

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

/**
 * Map common RPC error patterns to human-readable strings for the banner.
 * Falls back to a generic message so a coordinator never sees raw Postgres
 * jargon. The raw error stays in console.error for debugging.
 */
function humanizeRpcError(raw: string): string {
  const r = raw.toLowerCase();
  if (r.includes('permission denied') || r.includes('access denied')) {
    return "You don't have permission to change this requirement.";
  }
  if (r.includes('not authenticated') || r.includes('jwt')) {
    return 'Your session expired. Sign in again to save changes.';
  }
  if (r.includes('not found') || r.includes('requirement not found')) {
    return 'This requirement no longer exists — refresh the page.';
  }
  if (r.includes('network') || r.includes('fetch')) {
    return 'Network error — check your connection and try again.';
  }
  if (r.includes('malformed')) {
    return 'The server returned an unexpected response — try again.';
  }
  return "Couldn't save that change — try again.";
}

export default function VisitExecutionTab() {
  const { activeProtocol } = useProtocol();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [workspaces, setWorkspaces] = useState<VisitExecutionWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<Map<string, ExecutionReviewStatus>>(new Map());
  const [mutationError, setMutationError] = useState<{ message: string; itemLabel: string } | null>(null);
  const [traceabilityItem, setTraceabilityItem] = useState<VisitExecutionItem | null>(null);

  // Sprint 4b: RequirementTextDrawer state. One drawer instance, two modes.
  const [textDrawerItem, setTextDrawerItem] = useState<VisitExecutionItem | null>(null);
  const [textDrawerMode, setTextDrawerMode] = useState<RequirementTextDrawerMode>('edit');

  // Per-item generation counter for race-guarding rapid clicks. Each click
  // increments the item's generation; the in-flight RPC captures the gen at
  // dispatch time. On response, we compare — if the captured gen no longer
  // matches the current value, a newer click superseded this RPC and we
  // drop the stale result rather than letting it overwrite the latest state.
  // Ref (not state) because we never need a re-render on bump.
  const mutationGenRef = useRef<Map<string, number>>(new Map());

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
      // Reset optimistic overrides when protocol changes; persisted state
      // comes through `r.data`. Also clear any lingering mutation error +
      // race-guard generations (they're scoped to the prior protocol).
      setReviewStatus(new Map());
      setTraceabilityItem(null);
      setMutationError(null);
      mutationGenRef.current = new Map();
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.visit_template_id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  // Clear any lingering mutation error when the user changes visits — the
  // error refers to a specific item; banner is contextless once the user
  // navigates away.
  useEffect(() => {
    setMutationError(null);
  }, [selectedId]);

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
  // fires the RPC, reverts on failure with an error banner.
  //
  // Race-guard: every click bumps a per-item generation counter. The RPC
  // callback captures the gen at dispatch time and only applies its result
  // if the gen still matches on response. If a later click superseded this
  // RPC (gen mismatch), we drop the stale result rather than letting an
  // older response overwrite the newer optimistic state.
  const runReviewMutation = useCallback(
    async (
      itemId: string,
      itemLabel: string,
      optimisticNext: ExecutionReviewStatus,
      rpc: () => Promise<{ ok: true; data: { review_status: ExecutionReviewStatus } } | { ok: false; error: string }>,
    ) => {
      const prior = effectiveStatusFor(itemId);
      // Bump generation. Mutation captures this value; comparing on response
      // tells us whether a newer click superseded us.
      const myGen = (mutationGenRef.current.get(itemId) ?? 0) + 1;
      mutationGenRef.current.set(itemId, myGen);

      // Optimistic update.
      setReviewStatus((prev) => {
        const next = new Map(prev);
        next.set(itemId, optimisticNext);
        return next;
      });
      setMutationError(null);

      const result = await rpc();

      // Stale? A later click superseded us — drop the result.
      if (mutationGenRef.current.get(itemId) !== myGen) {
        return;
      }

      if (!result.ok) {
        // Revert.
        setReviewStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, prior);
          return next;
        });
        // Surface a humanized message; keep the raw RPC error in the console
        // for developer debugging.
        console.error('[vew] mutation_failed', { itemId, error: result.error });
        setMutationError({ message: humanizeRpcError(result.error), itemLabel });
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

  // Resolve an item's display label for the mutation-error banner. Looks
  // in the selected workspace; falls back to the itemId if not found
  // (defensive — shouldn't happen since handlers are only called from rows
  // in the current workspace).
  const labelForItem = useCallback(
    (itemId: string): string => {
      const item = selectedWorkspace?.items.find((i) => i.id === itemId);
      return item?.label ?? itemId;
    },
    [selectedWorkspace],
  );

  const handleToggleReviewed = useCallback(
    (itemId: string) => {
      const current = effectiveStatusFor(itemId);
      const label = labelForItem(itemId);
      if (current === 'reviewed') {
        void runReviewMutation(itemId, label, 'not_reviewed', () => unmarkReviewed(itemId));
      } else {
        void runReviewMutation(itemId, label, 'reviewed', () => markReviewed(itemId));
      }
    },
    [effectiveStatusFor, labelForItem, runReviewMutation],
  );

  /**
   * Sprint 4b dispatcher. Routes each menu action to the right mutation API
   * call or drawer-open handler.
   *
   * - flag_for_review          → flagForReview RPC (sets review_status='needs_review')
   * - mark_needs_clarification → markNeedsClarification RPC (same end state, distinct audit-log action)
   * - open_edit                → opens RequirementTextDrawer in 'edit' mode
   * - open_note                → opens RequirementTextDrawer in 'note' mode
   */
  const handleItemAction = useCallback(
    (item: VisitExecutionItem, action: ChecklistItemAction) => {
      switch (action) {
        case 'flag_for_review':
          void runReviewMutation(item.id, item.label, 'needs_review', () =>
            flagForReview(item.id),
          );
          return;
        case 'mark_needs_clarification':
          void runReviewMutation(item.id, item.label, 'needs_review', () =>
            markNeedsClarification(item.id),
          );
          return;
        case 'open_edit':
          setTextDrawerItem(item);
          setTextDrawerMode('edit');
          return;
        case 'open_note':
          setTextDrawerItem(item);
          setTextDrawerMode('note');
          return;
        default: {
          // Exhaustive-check helper. If a new ChecklistItemAction is added
          // without updating this switch, TypeScript flags `_exhaustive` as
          // type `never` → compile error.
          const _exhaustive: never = action;
          void _exhaustive;
        }
      }
    },
    [runReviewMutation],
  );

  // ----------------------------------------------------------------------
  // Drawer save handlers — return Result<> so the drawer can show inline
  // error / keep itself open on failure / close + refresh state on success.
  // Optimistic-revert is NOT used for text edits per the plan MD: rolling
  // back a text change mid-edit is jarring. Drawer shows a saving spinner
  // and only updates the row on success.
  // ----------------------------------------------------------------------

  const updateItemFromMutation = useCallback(
    (itemId: string, patch: Partial<VisitExecutionItem>) => {
      // Splice the updated row into local workspace state so the UI reflects
      // the persisted value without a full re-fetch. Future Sprint 4c may
      // refresh via the v3 RPC to also pick up new audit-log signals.
      setWorkspaces((prev) =>
        prev.map((ws) => ({
          ...ws,
          items: ws.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)),
        })),
      );
      // Also re-sync the optimistic-override Map for the row's status, so a
      // subsequent toggle reflects the new server-authoritative value.
      if (patch.review_status) {
        setReviewStatus((prev) => {
          const next = new Map(prev);
          next.set(itemId, patch.review_status!);
          return next;
        });
      }
    },
    [],
  );

  const handleEditSave = useCallback(
    async (newText: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!textDrawerItem) return { ok: false, error: 'no item open' };
      const result = await editText(textDrawerItem.id, newText);
      if (!result.ok) {
        console.error('[vew] edit_text_failed', {
          itemId: textDrawerItem.id,
          error: result.error,
        });
        return { ok: false, error: humanizeRpcError(result.error) };
      }
      updateItemFromMutation(textDrawerItem.id, {
        label: result.data.current_text,
        review_status: result.data.review_status,
      });
      setTextDrawerItem(null);
      return { ok: true };
    },
    [textDrawerItem, updateItemFromMutation],
  );

  const handleNoteSave = useCallback(
    async (note: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!textDrawerItem) return { ok: false, error: 'no item open' };
      const result = await addSiteNote(textDrawerItem.id, note);
      if (!result.ok) {
        console.error('[vew] add_site_note_failed', {
          itemId: textDrawerItem.id,
          error: result.error,
        });
        return { ok: false, error: humanizeRpcError(result.error) };
      }
      updateItemFromMutation(textDrawerItem.id, {
        review_status: result.data.review_status,
        review_note: note.trim(),
      });
      setTextDrawerItem(null);
      return { ok: true };
    },
    [textDrawerItem, updateItemFromMutation],
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
                  {/* Icon for non-color signaling — color-blind users need a
                      non-hue cue that this is an alert. */}
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
                  <span className="flex-1 leading-relaxed">
                    Couldn't save change to <strong>{mutationError.itemLabel}</strong>:{' '}
                    {mutationError.message} Your previous state was restored.
                  </span>
                  <button
                    type="button"
                    onClick={() => setMutationError(null)}
                    aria-label="Dismiss error"
                    className={`flex items-center justify-center w-6 h-6 rounded -mr-1 opacity-70 hover:opacity-100 ${
                      isLight ? 'hover:bg-[#f3c7c7]' : 'hover:bg-[#5a2e2e]'
                    }`}
                  >
                    <X size={12} aria-hidden />
                  </button>
                </div>
              )}

              <ExecutionChecklist
                workspace={selectedWorkspace}
                reviewStatus={reviewStatus}
                onToggleReviewed={handleToggleReviewed}
                onItemAction={handleItemAction}
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

      <RequirementTextDrawer
        item={textDrawerItem}
        mode={textDrawerMode}
        onClose={() => setTextDrawerItem(null)}
        onSave={textDrawerMode === 'edit' ? handleEditSave : handleNoteSave}
      />
    </div>
  );
}
