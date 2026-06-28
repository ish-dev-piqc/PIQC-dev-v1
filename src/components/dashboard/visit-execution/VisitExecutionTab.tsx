import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, FlaskConical, X, AlertTriangle, Plus, Database } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useTheme } from '../../../context/ThemeContext';
import { fetchVisitExecutionWorkspaces, fetchVisitCoverage, fetchProtocolCohorts, isMockEnabled } from '../../../lib/visit-execution/visitExecutionApi';
// Cross-mode import allowed: sourceEvidenceApi is on the piqc-discipline
// ALLOWED_CROSS_MODE allowlist (same helper the old Protocol tab badge used).
import { countWorksheetItemsForStudy } from '../../../lib/sotr/sourceEvidenceApi';
import ProtocolDrawer from './ProtocolDrawer';
import CoverageBanner from './CoverageBanner';
import {
  addRequirement,
  addSiteNote,
  deleteRequirement,
  editText,
  flagForReview,
  markNeedsClarification,
  markReviewed,
  resolveSignal,
  unmarkReviewed,
} from '../../../lib/visit-execution/visitExecutionMutationsApi';
import type {
  ExecutionReviewStatus,
  ProtocolCohort,
  RoleFilter,
  VisitCompletenessSignal,
  VisitExecutionItem,
  VisitCoverage,
  VisitExecutionWorkspace,
} from '../../../types/visit-execution';
import { itemMatchesRoleFilter } from '../../../lib/visit-execution/parseRoleHint';
import { deriveVisitConfidence } from '../../../lib/visit-execution/deriveVisitConfidence';
import VisitNavigator from './VisitNavigator';
import VisitSnapshotCard from './VisitSnapshotCard';
import ExecutionChecklist, { type ChecklistItemAction } from './ExecutionChecklist';
import TraceabilityDrawer from './TraceabilityDrawer';
import ExportWorksheetButton from './ExportWorksheetButton';
import RequirementTextDrawer, {
  type RequirementTextDrawerMode,
  type RequirementTextDrawerSubject,
} from './RequirementTextDrawer';
import CompletenessSignalsPanel from './CompletenessSignalsPanel';
import EditLogDrawer from './EditLogDrawer';
import RoleFilterBar from './RoleFilterBar';
import CohortDetailPanel from './CohortDetailPanel';

// =============================================================================
// VisitExecutionTab — root component for the new primary Site Mode surface.
//
// Layout:
//   - Left rail: VisitNavigator (visit list with indicator chips)
//   - Right pane: VisitSnapshotCard + (Sprint 4c) CompletenessSignalsPanel +
//                 ExecutionChecklist + ExportWorksheetButton (Sprint 5)
//   - Drawer overlays:
//       - TraceabilityDrawer (item-scoped)
//       - RequirementTextDrawer (modes: edit / note / promote_signal)
//       - EditLogDrawer (Sprint 4c, read-only history for one item)
//
// State owned here:
//   - workspaces[]                  — loaded once per active protocol
//   - selectedVisitTemplateId
//   - reviewStatus Map<itemId, status> — optimistic-update overrides
//   - mutationError                 — most recent mutation failure for banner
//   - traceabilityItem
//   - textDrawerSubject + mode      — generic drawer subject; mode discriminator
//   - textDrawerSignal              — the in-flight signal when mode='promote_signal'
//                                      (null otherwise; lets handleEditSave route
//                                      saves to the right mutation API)
//   - editLogItem                   — Sprint 4c, the item whose history drawer is open
//   - inFlightSignalIds             — Sprint 4c, signals with a pending resolveSignal
//                                      RPC; used by the panel for per-row spinners.
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
  if (r.includes('signal not found')) {
    return 'This suggestion is no longer available — refresh the page.';
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
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const isLight = theme === 'light';

  const [workspaces, setWorkspaces] = useState<VisitExecutionWorkspace[]>([]);
  const [coverage, setCoverage] = useState<VisitCoverage | null>(null);
  // Slice 3: authoritative per-protocol cohort list (label + dose + evidence),
  // extracted from the protocol body. Drives the cohort selector (so EVERY
  // cohort shows, not just SoA "[X only]" markers) + the per-cohort dose panel.
  const [protocolCohorts, setProtocolCohorts] = useState<ProtocolCohort[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<Map<string, ExecutionReviewStatus>>(new Map());
  // Tagged-union banner state. `kind` discriminates between requirement-row
  // mutations (the optimistic toggles + drawer saves, where "your previous
  // state was restored" applies) and signal-resolution failures (where there
  // is no optimistic state to revert — the signal just stayed visible).
  // Sprint 4c added the 'signal' variant; before that, every banner was
  // implicitly 'item'.
  const [mutationError, setMutationError] = useState<
    | { kind: 'item'; message: string; itemLabel: string }
    | { kind: 'signal'; message: string; gapText: string }
    | null
  >(null);
  const [traceabilityItem, setTraceabilityItem] = useState<VisitExecutionItem | null>(null);

  // Sprint 6: role-filter lens. `'all'` default — current behavior, no
  // filtering. Selecting a specific role narrows the checklist + the
  // export to items matching that role (or unscoped — see
  // itemMatchesRoleFilter for the safety default).
  //
  // Resets to `'all'` when the active protocol or selected visit changes:
  // a coordinator switching from a "Nurse view" of Visit 1 to Visit 4
  // shouldn't silently carry the filter into a visit where it might
  // produce an empty checklist by surprise.
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  // Slice 2: cohort lens over the VISIT LIST (vs roleFilter, which narrows the
  // checklist within a visit). 'all' or a cohort label (SAD/MAD/CSF/…).
  const [cohortFilter, setCohortFilter] = useState<string>('all');

  // Sprint 4b: RequirementTextDrawer state. Sprint 4c extends to three modes.
  // textDrawerSubject is the generic display payload (title + initial draft
  // + drift-from text). textDrawerMode discriminates which RPC the save
  // handler dispatches to. textDrawerSignal/Item remember the underlying
  // domain object so we know what to update on success.
  const [textDrawerSubject, setTextDrawerSubject] =
    useState<RequirementTextDrawerSubject | null>(null);
  const [textDrawerMode, setTextDrawerMode] = useState<RequirementTextDrawerMode>('edit');
  const [textDrawerItem, setTextDrawerItem] = useState<VisitExecutionItem | null>(null);
  const [textDrawerSignal, setTextDrawerSignal] =
    useState<VisitCompletenessSignal | null>(null);

  // Sprint 4c: read-only edit-log drawer state.
  const [editLogItem, setEditLogItem] = useState<VisitExecutionItem | null>(null);

  // Sprint 4c: signals with an in-flight resolveSignal RPC. Drives the
  // CompletenessSignalsPanel's per-row spinner. Set, not Map — we don't need
  // per-signal data, just presence.
  const [inFlightSignalIds, setInFlightSignalIds] = useState<Set<string>>(new Set());

  // Protocol-as-drawer (replaces the former Protocol tab): open state + the
  // awaiting-review badge count that used to live on the tab. Refreshes on
  // protocol change and whenever the drawer closes (parsed items may have been
  // reviewed inside it).
  const [protocolOpen, setProtocolOpen] = useState(false);
  const [awaitingReview, setAwaitingReview] = useState(0);

  const refreshAwaitingReview = useCallback(async () => {
    const pid = activeProtocol?.id;
    if (!pid) {
      setAwaitingReview(0);
      return;
    }
    try {
      const c = await countWorksheetItemsForStudy(pid);
      setAwaitingReview(c.awaitingReview);
    } catch {
      setAwaitingReview(0);
    }
  }, [activeProtocol?.id]);

  useEffect(() => {
    void refreshAwaitingReview();
  }, [refreshAwaitingReview]);

  // Wrap an async signal-resolution call in the in-flight Set so the panel
  // can render the row spinner for the duration. Exception-safe via try/finally
  // — guarantees the Set is trimmed even if the wrapped fn throws or rejects.
  // The wrapped fn returns whatever it returns; this helper passes that
  // through unchanged.
  const withInFlightSignal = useCallback(
    async <T,>(signalId: string, fn: () => Promise<T>): Promise<T> => {
      setInFlightSignalIds((prev) => {
        const next = new Set(prev);
        next.add(signalId);
        return next;
      });
      try {
        return await fn();
      } finally {
        setInFlightSignalIds((prev) => {
          const next = new Set(prev);
          next.delete(signalId);
          return next;
        });
      }
    },
    [],
  );

  // Stable close callback — passed to the drawer's useOverlay which has
  // onClose in its effect deps. An inline arrow would change identity every
  // render and re-fire the effect (focus-trap teardown + setup churn during
  // unrelated parent re-renders, including the saving=true transition).
  const closeTextDrawer = useCallback(() => {
    setTextDrawerSubject(null);
    setTextDrawerItem(null);
    setTextDrawerSignal(null);
  }, []);

  const closeEditLog = useCallback(() => setEditLogItem(null), []);

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
      setCoverage(null);
      setProtocolCohorts([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    // Completeness coverage (#4) — best-effort, independent of the workspace load.
    fetchVisitCoverage(activeProtocol.id).then((cr) => {
      if (!cancelled) setCoverage(cr.ok ? cr.data : null);
    });
    // Slice 3: authoritative cohort list — best-effort, independent of the
    // workspace load. Empty / error → no cohort UI (no behavior change).
    fetchProtocolCohorts(activeProtocol.id).then((cr) => {
      if (!cancelled) setProtocolCohorts(cr.ok ? cr.data : []);
    });
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
      setEditLogItem(null);
      setMutationError(null);
      setInFlightSignalIds(new Set());
      // Sprint 6: reset role filter on protocol change. Carrying a Nurse
      // filter from BRIGHTEN-2 into CARDIAC-7 could surprise the user with
      // an empty checklist if CARDIAC-7's parser output uses different
      // role_hint phrasing.
      setRoleFilter('all');
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

  // Slice 3: cohort selector list = the AUTHORITATIVE protocol_cohorts (so every
  // cohort shows — even ones whose visits are all shared/null), in the protocol's
  // own order, UNIONed with any visit applies_to tag not already in that list
  // (defensive: a "[X only]" marker cohort the body extraction happened to miss
  // still shows). Empty → no cohort filter (single-schedule; no behavior change).
  const cohorts = useMemo(() => {
    const ordered = protocolCohorts.map((c) => c.label);
    const seen = new Set(ordered.map((l) => l.toLowerCase()));
    for (const w of workspaces) {
      for (const c of w.snapshot.applies_to ?? []) {
        if (!seen.has(c.toLowerCase())) {
          seen.add(c.toLowerCase());
          ordered.push(c);
        }
      }
    }
    return ordered;
  }, [protocolCohorts, workspaces]);

  // Slice 3: the selected cohort's detail (dose / description) for the panel.
  // null when "all", or when the active label is a marker-only cohort with no
  // protocol_cohorts row (defensive — the panel simply doesn't render).
  const selectedCohort = useMemo(
    () =>
      cohortFilter === 'all'
        ? null
        : protocolCohorts.find((c) => c.label === cohortFilter) ?? null,
    [cohortFilter, protocolCohorts],
  );

  // Visit list under the active cohort lens. A null applies_to (shared/unscoped)
  // shows under every cohort — same convention as the role filter's "unscoped".
  const visibleWorkspaces = useMemo(
    () =>
      cohortFilter === 'all'
        ? workspaces
        : workspaces.filter(
            (w) => w.snapshot.applies_to == null || w.snapshot.applies_to.includes(cohortFilter),
          ),
    [workspaces, cohortFilter],
  );

  // Reset the cohort lens when the protocol changes (cohorts differ per protocol).
  useEffect(() => {
    setCohortFilter('all');
  }, [activeProtocol?.id]);

  // Clear any lingering mutation error when the user changes visits — the
  // error refers to a specific item; banner is contextless once the user
  // navigates away. Also reset the role filter (Sprint 6) — see protocol-
  // change reset comment above for the same rationale at visit scope.
  useEffect(() => {
    setMutationError(null);
    setRoleFilter('all');
  }, [selectedId]);

  const reviewedCountForSelected = useMemo(() => {
    if (!selectedWorkspace) return 0;
    return selectedWorkspace.items.filter(
      (i) => (reviewStatus.get(i.id) ?? i.review_status) === 'reviewed',
    ).length;
  }, [selectedWorkspace, reviewStatus]);

  // Sprint 6: count of items visible under the active role filter. Memoized
  // because it's consumed by BOTH the RoleFilterBar (scope hint) and the
  // ExportWorksheetButton (zero-item-export guard) — same number, computed
  // once.
  const roleFilteredCount = useMemo(() => {
    if (!selectedWorkspace) return 0;
    if (roleFilter === 'all') return selectedWorkspace.items.length;
    return selectedWorkspace.items.filter((i) =>
      itemMatchesRoleFilter(i.role_hint, roleFilter),
    ).length;
  }, [selectedWorkspace, roleFilter]);

  // Sprint 7: derived visit-level confidence. Computed against the
  // role-filtered item set so that a "Nurse view" rollup reflects the
  // nurse-relevant items only (consistency with the rest of the workspace).
  // When role filter is 'all', derivation runs against the canonical items.
  const derivedVisitConfidence = useMemo(() => {
    if (!selectedWorkspace) return undefined;
    const itemsForDerivation =
      roleFilter === 'all'
        ? selectedWorkspace.items
        : selectedWorkspace.items.filter((i) =>
            itemMatchesRoleFilter(i.role_hint, roleFilter),
          );
    return deriveVisitConfidence(selectedWorkspace.snapshot, itemsForDerivation);
  }, [selectedWorkspace, roleFilter]);

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
        setMutationError({
          kind: 'item',
          message: humanizeRpcError(result.error),
          itemLabel,
        });
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
   * Sprint 4b dispatcher (extended Sprint 4c). Routes each menu action to
   * the right mutation API call or drawer-open handler.
   *
   * - flag_for_review          → flagForReview RPC
   * - mark_needs_clarification → markNeedsClarification RPC
   * - open_edit                → opens text drawer in 'edit' mode
   * - open_note                → opens text drawer in 'note' mode
   * - view_history             → opens read-only EditLogDrawer
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
          setTextDrawerSignal(null);
          setTextDrawerMode('edit');
          setTextDrawerSubject({
            title: item.label,
            initialDraft: item.label,
            // The drift block is only meaningful when current label is
            // already a human edit (label !== derived_text). When they match,
            // passing null keeps the block hidden.
            driftFromText: item.derived_text,
          });
          return;
        case 'open_note':
          setTextDrawerItem(item);
          setTextDrawerSignal(null);
          setTextDrawerMode('note');
          setTextDrawerSubject({
            title: item.label,
            initialDraft: '',
            driftFromText: null,
          });
          return;
        case 'view_history':
          setEditLogItem(item);
          return;
        case 'delete': {
          if (
            !window.confirm(
              `Delete requirement “${item.label}”? This removes it from the checklist and the exported worksheet.`,
            )
          ) {
            return;
          }
          void deleteRequirement(item.id).then((r) => {
            if (!r.ok) {
              console.error('[vew] delete_requirement_failed', { itemId: item.id, error: r.error });
              setMutationError({ kind: 'item', message: humanizeRpcError(r.error), itemLabel: item.label });
              return;
            }
            // Splice the row out of local state; export + workspace read from
            // the same table, so the deletion is already reflected server-side.
            setWorkspaces((prev) =>
              prev.map((ws) => {
                if (!ws.items.some((i) => i.id === item.id)) return ws;
                return {
                  ...ws,
                  items: ws.items.filter((i) => i.id !== item.id),
                  snapshot: {
                    ...ws.snapshot,
                    item_count: Math.max(0, ws.snapshot.item_count - 1),
                  },
                };
              }),
            );
          });
          return;
        }
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
      // the persisted value without a full re-fetch.
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

  /**
   * Sprint 4c. Splice a brand-new visit_requirements row into local state
   * after a successful 'added_as_requirement' signal resolution.
   *
   * The RPC returns the new requirement_id but no other fields, so we
   * synthesize the row from the signal (gap_text + optional override text)
   * and append it to the parent visit. The row appears at the end of the
   * checklist (max ordinal + 1, same as the RPC's INSERT). Defaults match
   * the migration's INSERT: phase='assessment', classification='required',
   * review_status='not_reviewed'.
   *
   * On the next protocol refresh / page reload, the v3 RPC will return the
   * same row with the canonical derived values — this synthetic row stays
   * consistent because we mirror the same defaults.
   *
   * IMPORTANT — snapshot counts we patch (item_count, needs_review_count)
   * assume the row's classification is 'required' (not endpoint/safety) and
   * phase is 'assessment'. If the resolve-signal RPC is ever changed to
   * accept a classification/phase override from the caller, this helper
   * must update has_primary_endpoint / has_safety_critical /
   * endpoint_critical_count / is_dosing_visit too. Until then, the
   * coupling is documented + locked at the migration layer.
   */
  const appendRequirementFromSignal = useCallback(
    (
      visitTemplateId: string,
      newRequirementId: string,
      signal: VisitCompletenessSignal,
      currentText: string | null,
    ) => {
      const newItem: VisitExecutionItem = {
        id: newRequirementId,
        extracted_item_id: null,
        label: currentText ?? signal.gap_text,
        derived_text: signal.gap_text,
        description: null,
        phase: 'assessment',
        classification: 'required',
        conditions: [],
        timing: null,
        source_fields: [],
        traceability: {
          soa_column: null,
          protocol_section: signal.source_section,
          protocol_page: signal.source_page,
          amendment_version: null,
          source_evidence_id: null,
          source_quote: null,
          cross_reference_source_section: null,
          cross_reference_page: null,
          cross_reference_snippet: null,
        },
        role_hint: null,
        review_status: 'not_reviewed',
        review_note: null,
        confidence_state: null,
      };

      setWorkspaces((prev) =>
        prev.map((ws) => {
          if (ws.visit_template_id !== visitTemplateId) return ws;
          // Drop the resolved signal from snapshot + append the new item.
          const remainingSignals = ws.snapshot.completeness_signals.filter(
            (s) => s.id !== signal.id,
          );
          return {
            ...ws,
            snapshot: {
              ...ws.snapshot,
              completeness_signals: remainingSignals,
              completeness_signal_count: remainingSignals.length,
              item_count: ws.snapshot.item_count + 1,
              needs_review_count: ws.snapshot.needs_review_count + 1,
            },
            items: [...ws.items, newItem],
          };
        }),
      );
    },
    [],
  );

  /**
   * Sprint 4c. Drop a resolved signal from snapshot without creating a
   * requirement (dismiss_not_real path). Mirrors the snapshot trim half of
   * appendRequirementFromSignal.
   */
  const dropSignal = useCallback(
    (visitTemplateId: string, signalId: string) => {
      setWorkspaces((prev) =>
        prev.map((ws) => {
          if (ws.visit_template_id !== visitTemplateId) return ws;
          const remainingSignals = ws.snapshot.completeness_signals.filter(
            (s) => s.id !== signalId,
          );
          return {
            ...ws,
            snapshot: {
              ...ws.snapshot,
              completeness_signals: remainingSignals,
              completeness_signal_count: remainingSignals.length,
            },
          };
        }),
      );
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
      closeTextDrawer();
      return { ok: true };
    },
    [textDrawerItem, updateItemFromMutation, closeTextDrawer],
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
      closeTextDrawer();
      return { ok: true };
    },
    [textDrawerItem, updateItemFromMutation, closeTextDrawer],
  );

  /**
   * Sprint 4c. Promote-mode save: caller supplied refined text (or kept
   * gap_text); we resolve the signal as 'added_as_requirement' and splice
   * the new row into local state.
   */
  const handlePromoteSignalSave = useCallback(
    async (newText: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!textDrawerSignal || !selectedWorkspace) {
        return { ok: false, error: 'no signal in flight' };
      }
      // Mark in-flight so the panel's per-row spinner shows even though the
      // drawer is also displaying its own spinner. Belt-and-suspenders so a
      // user dismissing the drawer mid-flight still sees the right state on
      // the row beneath.

      const trimmed = newText.trim();
      const override = trimmed === textDrawerSignal.gap_text ? undefined : trimmed;

      const result = await withInFlightSignal(textDrawerSignal.id, () =>
        resolveSignal(textDrawerSignal.id, 'added_as_requirement', override),
      );

      if (!result.ok) {
        console.error('[vew] resolve_signal_failed', {
          signalId: textDrawerSignal.id,
          error: result.error,
        });
        return { ok: false, error: humanizeRpcError(result.error) };
      }

      // Already-resolved race: signal was dismissed/promoted in another tab
      // or by another tab. Drop the signal locally; don't surface as an error
      // (the user's intent was either way to stop seeing the signal).
      if (result.data.already_resolved) {
        dropSignal(selectedWorkspace.visit_template_id, textDrawerSignal.id);
        closeTextDrawer();
        return { ok: true };
      }

      // Server returned the new requirement_id. Splice it in.
      if (result.data.requirement_id) {
        appendRequirementFromSignal(
          selectedWorkspace.visit_template_id,
          result.data.requirement_id,
          textDrawerSignal,
          override ?? null,
        );
      }
      closeTextDrawer();
      return { ok: true };
    },
    [
      textDrawerSignal,
      selectedWorkspace,
      appendRequirementFromSignal,
      dropSignal,
      closeTextDrawer,
      withInFlightSignal,
    ],
  );

  // Sprint 4c. Panel handlers. Promote routes through the drawer for text
  // confirmation; dismiss fires immediately.

  const handlePromoteSignal = useCallback(
    (signal: VisitCompletenessSignal) => {
      setTextDrawerItem(null);
      setTextDrawerSignal(signal);
      setTextDrawerMode('promote_signal');
      setTextDrawerSubject({
        title: signal.gap_text,
        initialDraft: signal.gap_text,
        // No drift block for promote — the gap_text IS the parser output.
        driftFromText: null,
      });
    },
    [],
  );

  const handleDismissSignal = useCallback(
    async (signal: VisitCompletenessSignal) => {
      if (!selectedWorkspace) return;

      setMutationError(null);

      const result = await withInFlightSignal(signal.id, () =>
        resolveSignal(signal.id, 'dismissed_not_real'),
      );

      if (!result.ok) {
        console.error('[vew] dismiss_signal_failed', {
          signalId: signal.id,
          error: result.error,
        });
        setMutationError({
          kind: 'signal',
          message: humanizeRpcError(result.error),
          gapText: signal.gap_text,
        });
        return;
      }
      // Drop the row whether the server actually wrote or saw an
      // already-resolved race; either way it's no longer pending.
      dropSignal(selectedWorkspace.visit_template_id, signal.id);
    },
    [selectedWorkspace, dropSignal, withInFlightSignal],
  );

  // Add-requirement: opens the text drawer in 'add' mode (empty draft).
  const handleOpenAdd = useCallback(() => {
    if (!selectedWorkspace) return;
    setTextDrawerItem(null);
    setTextDrawerSignal(null);
    setTextDrawerMode('add');
    setTextDrawerSubject({
      title: selectedWorkspace.snapshot.visit_name,
      initialDraft: '',
      driftFromText: null,
    });
  }, [selectedWorkspace]);

  // Add-mode save: create a coordinator-authored requirement, then splice it
  // into local state (mirrors appendRequirementFromSignal's row shape). The
  // export worksheet picks it up automatically (reads visit_requirements).
  const handleAddSave = useCallback(
    async (text: string): Promise<{ ok: true } | { ok: false; error: string }> => {
      if (!selectedWorkspace) return { ok: false, error: 'no visit selected' };
      const visitTemplateId = selectedWorkspace.visit_template_id;
      const result = await addRequirement(visitTemplateId, text);
      if (!result.ok) {
        console.error('[vew] add_requirement_failed', { visitTemplateId, error: result.error });
        return { ok: false, error: humanizeRpcError(result.error) };
      }
      const label = text.trim();
      const newId = result.data.id;
      setWorkspaces((prev) =>
        prev.map((ws) => {
          if (ws.visit_template_id !== visitTemplateId) return ws;
          const newItem: VisitExecutionItem = {
            id: newId,
            extracted_item_id: null,
            label,
            derived_text: label,
            description: null,
            phase: 'assessment',
            classification: 'required',
            conditions: [],
            timing: null,
            source_fields: [],
            traceability: {
              soa_column: null,
              protocol_section: null,
              protocol_page: null,
              amendment_version: null,
              source_evidence_id: null,
              source_quote: null,
              cross_reference_source_section: null,
              cross_reference_page: null,
              cross_reference_snippet: null,
            },
            role_hint: null,
            review_status: 'not_reviewed',
            review_note: null,
            confidence_state: null,
          };
          return {
            ...ws,
            items: [...ws.items, newItem],
            snapshot: {
              ...ws.snapshot,
              item_count: ws.snapshot.item_count + 1,
              needs_review_count: ws.snapshot.needs_review_count + 1,
            },
          };
        }),
      );
      closeTextDrawer();
      return { ok: true };
    },
    [selectedWorkspace, closeTextDrawer],
  );

  // Pick the right save handler based on mode. Memoized so the drawer's
  // prop identity stays stable across unrelated parent re-renders.
  const drawerOnSave = useMemo(() => {
    switch (textDrawerMode) {
      case 'edit':           return handleEditSave;
      case 'note':           return handleNoteSave;
      case 'promote_signal': return handlePromoteSignalSave;
      case 'add':            return handleAddSave;
    }
  }, [textDrawerMode, handleEditSave, handleNoteSave, handlePromoteSignalSave, handleAddSave]);


  if (!activeProtocol) {
    return null;
  }

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div className="flex-1 flex items-center justify-center text-fg-sub text-sm gap-2">
        <Loader2 size={14} className="animate-spin" />
        Loading visit workspaces…
      </div>
    );
  } else if (error) {
    body = (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-fg-heading text-sm font-semibold mb-1">Couldn't load visits</p>
          <p className="text-fg-sub text-xs">{error}</p>
        </div>
      </div>
    );
  } else if (workspaces.length === 0) {
    body = (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <FlaskConical size={20} className="mx-auto text-fg-muted mb-3" aria-hidden />
          <p className="text-fg-heading text-sm font-semibold mb-1">
            No visit templates yet for this protocol
          </p>
          <p className="text-fg-sub text-xs leading-relaxed">
            Open the Protocol panel to upload a protocol PDF, and the parsed
            Schedule of Events will appear here.{' '}
            {!isMockEnabled() && (
              <>
                To preview with sample data, enable the mock toggle:
                <code className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                  isLight ? 'bg-[#F2F2F2]' : 'bg-white/[0.05]'
                }`}>
                  localStorage.setItem('piq-visit-execution-mock-v1', '1')
                </code>
              </>
            )}
          </p>
        </div>
      </div>
    );
  } else {
    body = (
    <div className="flex-1 flex overflow-hidden">
      <VisitNavigator
        workspaces={visibleWorkspaces}
        selectedVisitTemplateId={selectedId}
        onSelect={setSelectedId}
        reviewStatusByItemId={reviewStatus}
        cohorts={cohorts}
        cohortFilter={cohortFilter}
        onCohortFilter={setCohortFilter}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-5">
          <CoverageBanner coverage={coverage} />
          {/* Slice 3: per-cohort dose/description when a specific cohort is
              selected. The shared visit schedule renders below unchanged. */}
          {selectedCohort && <CohortDetailPanel cohort={selectedCohort} />}
          {selectedWorkspace ? (
            <>
              <VisitSnapshotCard
                snapshot={selectedWorkspace.snapshot}
                reviewedCount={reviewedCountForSelected}
                totalItems={selectedWorkspace.items.length}
                derivedConfidence={derivedVisitConfidence}
              />

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 border ${
                    isLight
                      ? 'border-[#E2E8F0] text-fg-body hover:bg-[#F2F2F2]'
                      : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
                  }`}
                >
                  <Plus size={13} aria-hidden /> Add requirement
                </button>
              </div>

              {selectedWorkspace.items.length === 0 ? (
                /* Visits loaded (templates exist) but no requirements were
                   extracted — the per-visit execution items never got written
                   to visit_requirements. Make this state honest + actionable
                   instead of rendering a bare 0-item checklist that reads as
                   "broken". */
                <div
                  data-testid="vew-no-requirements"
                  className={`rounded-lg border px-4 py-6 text-center ${
                    isLight
                      ? 'bg-[#FFFBEB] border-[#FDE68A]'
                      : 'bg-[#422006]/40 border-[#854D0E]'
                  }`}
                >
                  <FlaskConical size={18} className="mx-auto text-fg-muted mb-2" aria-hidden />
                  <p className="text-fg-heading text-sm font-semibold mb-1">
                    This visit&rsquo;s requirements aren&rsquo;t drafted yet
                  </p>
                  <p className="text-fg-sub text-xs leading-relaxed max-w-md mx-auto">
                    The visit is on the protocol schedule, but PIQC hasn&rsquo;t
                    drafted its procedures, roles, and timing. Re-ingest the
                    protocol from the Protocol tab to generate them from the
                    source document.
                  </p>
                </div>
              ) : (
                <>
              {selectedWorkspace.snapshot.completeness_signals.length > 0 && (
                <CompletenessSignalsPanel
                  signals={selectedWorkspace.snapshot.completeness_signals}
                  inFlightSignalIds={inFlightSignalIds}
                  onPromote={handlePromoteSignal}
                  onDismiss={handleDismissSignal}
                />
              )}

              {/* Sprint 6: role-filter lens. Sits between the snapshot/signals
                  area (workspace overview) and the checklist (narrowed view).
                  Filtering signals + edit-log is intentionally NOT in scope —
                  signals are visit-level + audit-log is role-agnostic.
                  filteredCount computed once; also fed downstream to the
                  ExportWorksheetButton (zero-item-export guard). */}
              <RoleFilterBar
                filter={roleFilter}
                onSelect={setRoleFilter}
                totalCount={selectedWorkspace.items.length}
                filteredCount={roleFilteredCount}
              />

              {mutationError && (
                <div
                  role="alert"
                  data-testid="vew-mutation-error-banner"
                  data-kind={mutationError.kind}
                  className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
                    isLight
                      ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
                      : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
                  }`}
                >
                  <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
                  <span className="flex-1 leading-relaxed">
                    {mutationError.kind === 'item' ? (
                      <>
                        Couldn't save change to <strong>{mutationError.itemLabel}</strong>:{' '}
                        {mutationError.message} Your previous state was restored.
                      </>
                    ) : (
                      <>
                        Couldn't update <strong>{mutationError.gapText}</strong>:{' '}
                        {mutationError.message} The suggestion is still pending — try again
                        or reload the page.
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMutationError(null)}
                    aria-label="Dismiss error"
                    className={`flex items-center justify-center w-6 h-6 rounded -mr-1 opacity-70 hover:opacity-100 ${
                      isLight ? 'hover:bg-[#FECDD3]' : 'hover:bg-[#881337]'
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
                roleFilter={roleFilter}
              />

              {/* Polish-v2 follow-up (Sprint 5 design-critique): the
                  export row is the moment-of-lock-in / funnel-exit action.
                  Bumped pt-2 → pt-6 gives the row breathing room from the
                  checklist content above so it doesn't read as a footer
                  attachment to the disclaimer line. */}
              <div className="flex items-center justify-between pt-6 gap-3">
                <p className="text-fg-muted text-[11px] leading-relaxed max-w-md">
                  This workspace is a draft. Final source-document authoring and
                  approval are performed outside PIQC.
                </p>
                <ExportWorksheetButton
                  visitTemplateId={selectedWorkspace.visit_template_id}
                  visitName={selectedWorkspace.snapshot.visit_name}
                  roleFilter={roleFilter}
                  filteredCount={roleFilteredCount}
                />
              </div>
                </>
              )}
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
        subject={textDrawerSubject}
        mode={textDrawerMode}
        onClose={closeTextDrawer}
        onSave={drawerOnSave}
      />

      <EditLogDrawer
        item={editLogItem}
        currentUserId={currentUserId}
        onClose={closeEditLog}
      />
    </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header bar — the Protocol panel trigger (replaces the former Protocol
          tab). Available in every state so re-ingest/upload is always reachable. */}
      <div
        className={`flex-shrink-0 flex items-center justify-end px-4 py-2 border-b ${
          isLight ? 'border-[#E2E8F0]' : 'border-white/5'
        }`}
      >
        <button
          type="button"
          onClick={() => setProtocolOpen(true)}
          data-testid="vew-open-protocol"
          className={`relative inline-flex items-center gap-1.5 text-xs font-medium rounded-md px-3 py-1.5 border ${
            isLight
              ? 'border-[#E2E8F0] text-fg-body hover:bg-[#F2F2F2]'
              : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
          }`}
        >
          <Database size={13} aria-hidden /> Protocol
          {awaitingReview > 0 && (
            <span
              data-testid="vew-protocol-awaiting-badge"
              className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-semibold rounded-full border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/[0.08] dark:text-amber-300"
              title={`${awaitingReview} parsed item${awaitingReview === 1 ? '' : 's'} awaiting review`}
            >
              {awaitingReview}
            </span>
          )}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">{body}</div>

      <ProtocolDrawer
        isOpen={protocolOpen}
        onClose={() => {
          setProtocolOpen(false);
          void refreshAwaitingReview();
        }}
      />
    </div>
  );
}
