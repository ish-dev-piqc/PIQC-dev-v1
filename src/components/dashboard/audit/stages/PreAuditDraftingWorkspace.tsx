import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Pencil,
  Plus,
  X,
  ArrowRight,
  AlertTriangle,
  Sparkles,
  FileText,
  CalendarDays,
  ListChecks,
  History as HistoryIcon,
  Megaphone,
  FileSearch,
  Paperclip,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  type MockAgendaItem,
  type MockChecklistItem,
  type MockConfirmationLetter,
  type MockAgenda,
  type MockChecklist,
  type MockInternalNotification,
  type MockEvidenceGapSummary,
  type MockPreAuditBundle,
} from '../../../../lib/audit/mockPreAudit';
import {
  fetchPreAuditDeliverables,
  upsertConfirmationLetter,
  approveConfirmationLetter,
  upsertAgenda,
  approveAgenda,
  upsertChecklist,
  approveChecklist,
  upsertInternalNotification,
  approveInternalNotification,
  upsertEvidenceGapSummary,
  approveEvidenceGapSummary,
  prefillStage5Deliverables,
} from '../../../../lib/audit/preAuditApi';
import type { DeliverableApprovalStatus, TrackedObjectType } from '../../../../types/audit';
import { listAuditEvidence } from '../../../../lib/audit/evidenceApi';
import { checklistLiveIds } from '../../../../lib/audit/deliverableGenerationApi';
import type { AuditEvidenceListRow } from '../../../../types/audit';
import { useOpenEvidence } from '../evidenceDrawerContext';
import { hasPassedStage, hasReachedStage } from '../../../../lib/audit/workflowStages';
import HistoryDrawer from '../HistoryDrawer';
import PrefillAgentNote from '../PrefillAgentNote';
import StagePreviewNotice from '../StagePreviewNotice';
import DeliverableGenerationPanel from '../deliverables/DeliverableGenerationPanel';
import { useDeliverableGeneration } from '../deliverables/useDeliverableGeneration';
import { useDeliverablePersistence } from '../deliverables/useDeliverablePersistence';
import { useDeliverableResync } from '../deliverables/useDeliverableResync';

// =============================================================================
// PreAuditDraftingWorkspace — PRE_AUDIT_DRAFTING stage center pane.
//
// Five tabs sharing the Revise / Save / Cancel / Approve pattern:
//   - Confirmation Letter      (sent to vendor)
//   - Agenda                   (multi-item audit plan)
//   - Checklist                (auditor's working checklist)
//   - Internal Notification    (internal heads-up inviting scope input — PR-D1)
//   - Evidence Gap Summary     (per-scope-area coverage vs the register — PR-D3)
//
// All follow the D-010 step 7 lifecycle:
//   - DRAFT until explicitly Approved
//   - Editing an APPROVED deliverable demotes it to DRAFT (re-approval needed)
//   - When letter + agenda + checklist are APPROVED, AUDIT_CONDUCT unlocks.
//     The internal notification and evidence gap summary NEVER gate advance
//     (v8 rule) — their approvals are their own latches only.
// =============================================================================

type TabKey =
  | 'confirmation_letter'
  | 'agenda'
  | 'checklist'
  | 'internal_notification'
  | 'evidence_gap_summary';

interface TabDef {
  key: TabKey;
  label: string;
  description: string;
  icon: typeof FileText;
  // Whether this deliverable's approval feeds the 5→6 gate (server truth:
  // 20260730000000 readout). Declared here ONCE — the gate checklist and the
  // advance condition both derive from it, so they can never disagree.
  gating: boolean;
}

const TAB_DEFS: TabDef[] = [
  {
    key: 'confirmation_letter',
    label: 'Confirmation letter',
    description: 'Sent to the vendor confirming dates, attendees, and scope.',
    icon: FileText,
    gating: true,
  },
  {
    key: 'agenda',
    label: 'Agenda',
    description: 'Multi-day audit plan: time slots, topics, owners, and notes.',
    icon: CalendarDays,
    gating: true,
  },
  {
    key: 'checklist',
    label: 'Checklist',
    description: "The auditor's working checklist — what to observe, evidence to collect, checkpoints to verify.",
    icon: ListChecks,
    gating: true,
  },
  {
    key: 'internal_notification',
    label: 'Internal notification',
    description: 'Internal heads-up announcing the audit and inviting scope input. Optional — never blocks advance.',
    icon: Megaphone,
    gating: false,
  },
  {
    key: 'evidence_gap_summary',
    label: 'Evidence gap summary',
    description: 'Per scope area: what evidence the register holds and what remains outstanding. Optional — never blocks advance.',
    icon: FileSearch,
    gating: false,
  },
];

const GATING_TAB_DEFS = TAB_DEFS.filter((t) => t.gating);

// One place for "nothing loaded yet" — the render fallback and the functional
// bundle merges below both use it.
const EMPTY_BUNDLE: MockPreAuditBundle = {
  confirmation_letter: null,
  agenda: null,
  checklist: null,
  internal_notification: null,
  evidence_gap_summary: null,
};

const ALL_KINDS: (keyof MockPreAuditBundle)[] = [
  'confirmation_letter',
  'agenda',
  'checklist',
  'internal_notification',
  'evidence_gap_summary',
];

// The prefill/stub bootstraps read and write ONLY these three — their gating
// must not be poisoned by a failed read of the two optional kinds (in prod
// today those two tables don't exist yet, so an all-five health gate would
// switch the Stage-5 bootstrap off entirely).
const TRIO_KINDS: (keyof MockPreAuditBundle)[] = [
  'confirmation_letter',
  'agenda',
  'checklist',
];

export default function PreAuditDraftingWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage, advanceStageError } = useAudit();
  const isLight = theme === 'light';

  // One-ahead preview guard (UX2): Stage 5 is viewable while the audit is
  // still at Stage 4. Reads render; the prefill RPCs, stub/LLM generation,
  // and advance stay off until the stage is real.
  const hasReached =
    !!activeAudit &&
    hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, 'PRE_AUDIT_DRAFTING');

  const { preAuditBundles: bundles, setPreAuditBundles: setBundles } = useAuditData();
  const [activeTab, setActiveTab] = useState<TabKey>('confirmation_letter');

  // Evidence register summary chip. null = not loaded (or list failed) — the
  // chip hides rather than claiming "0 attached" untruthfully; the header
  // Evidence button remains the always-on entry point. Count can go stale
  // while the drawer is open (attach/remove happen there); it refreshes on
  // audit switch / remount, which is the cheap-and-honest v1 trade-off.
  const openEvidence = useOpenEvidence();
  // Full rows, not just a count: the chip shows length, and the checklist
  // currency notice set-diffs these against the grounding snapshot.
  const [evidenceRows, setEvidenceRows] = useState<AuditEvidenceListRow[] | null>(null);
  const evidenceCount = evidenceRows === null ? null : evidenceRows.length;

  useEffect(() => {
    if (!activeAudit) return;
    let cancelled = false;
    void listAuditEvidence(activeAudit.id).then((res) => {
      if (!cancelled) setEvidenceRows(res.ok ? res.data : null);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id]);

  // Revise-with-AI must never fire over unsaved tab edits (persist human
  // edits first): while a tab is in edit mode, its generate button is
  // disabled — the button state IS the rule's enforcement.
  const [editingTabs, setEditingTabs] = useState<Partial<Record<TabKey, boolean>>>({});
  const setTabEditing = (tab: TabKey, editing: boolean) =>
    setEditingTabs((prev) => ({ ...prev, [tab]: editing }));

  // Load-path honesty (hardening PR-1). Kinds whose bundle read failed, per
  // audit. Their null slots mean unknown, not absent — those tabs render a
  // load-error card instead of a scratch form, and the prefill/stub
  // bootstraps stay off (a transient read failure must never trigger writes
  // meant for a genuinely empty stage).
  const [failedKindsByAudit, setFailedKindsByAudit] = useState<
    Record<string, (keyof MockPreAuditBundle)[]>
  >({});
  // Audits whose bundle read has resolved (or definitively failed) since
  // THIS mount. A cached bundle without a settled read this mount is not
  // trustworthy — failedKindsByAudit is component state and dies with the
  // component, so a remount over a stale cache must re-earn trust before
  // any scratch form or bootstrap renders.
  const [settledAudits, setSettledAudits] = useState<Set<string>>(new Set());
  const [retryingBundle, setRetryingBundle] = useState(false);
  const [stubsError, setStubsError] = useState<string | null>(null);

  const setAuditFailedKinds = (aid: string, kinds: (keyof MockPreAuditBundle)[]) =>
    setFailedKindsByAudit((p) => ({ ...p, [aid]: kinds }));

  // The hooks below close over auditId; the workspace renders nothing
  // without an audit (the null guard sits after the hooks — rules of hooks).
  const auditId = activeAudit?.id ?? '';
  const bundle: MockPreAuditBundle = bundles[auditId] ?? EMPTY_BUNDLE;

  // Functional per-field merge: every async completion folds into the LATEST
  // cache state. Writing `{ ...bundle, field }` from a render-time closure
  // instead lets interleaved persists clobber each other — save the
  // notification, approve the checklist while the save is in flight, and the
  // checklist's APPROVED reverts in cache when the notification write lands.
  const setBundleField = (
    key: keyof MockPreAuditBundle,
    value: MockPreAuditBundle[keyof MockPreAuditBundle],
  ) => {
    setBundles((prev) => ({
      ...prev,
      [auditId]: { ...(prev[auditId] ?? EMPTY_BUNDLE), [key]: value } as MockPreAuditBundle,
    }));
  };

  // THE refetch path — every post-write refresh and every retry goes through
  // here (the copies had already drifted on error handling). Never throws: a
  // failed refetch marks all five kinds unknown for this audit rather than
  // leaving a stale view labeled trustworthy.
  const refreshBundle = async (): Promise<boolean> => {
    try {
      const fresh = await fetchPreAuditDeliverables(auditId);
      setAuditFailedKinds(auditId, fresh.failedKinds);
      setBundles((prev) => ({ ...prev, [auditId]: fresh.bundle }));
      return true;
    } catch (err) {
      console.error('[PreAuditDraftingWorkspace] bundle refresh error:', err);
      setAuditFailedKinds(auditId, ALL_KINDS);
      return false;
    }
  };

  // Persist honesty (hardening PR-1) — the shared flow; see the hook for
  // the full latch/CAS/preserved-draft story.
  const {
    savingTabs,
    persistErrors,
    unsavedDraftFor,
    approveErrors,
    staleReloadNotices,
    persistDeliverable,
    dismissSaveError,
    resetTransient,
  } = useDeliverablePersistence<MockPreAuditBundle>({
    auditId,
    setField: setBundleField,
    refresh: refreshBundle,
    logTag: 'PreAuditDraftingWorkspace',
  });

  // Grounded deliverable generation (PR-C1 checklist, PR-C2 all three).
  // Letter: generation never sees recipients — the current ones merge at
  // apply time, read from the bundle as of the click's render (same
  // staleness window as always — see the hook's applyOptions doc).
  const { generatingTab, generationError, clearGenerationError, runGeneration } =
    useDeliverableGeneration({
      auditId,
      hasReached,
      refresh: refreshBundle,
      applyOptions: () => ({
        currentRecipients: bundle.confirmation_letter?.content.recipients ?? [],
      }),
    });

  // A generation error belongs to the tab it happened on.
  useEffect(() => {
    clearGenerationError();
  }, [activeTab, clearGenerationError]);

  // Tracks audits whose prefill RPCs have already been attempted in this
  // session, so opening Stage 5 / switching tabs / re-rendering doesn't fire
  // the RPCs repeatedly. Server-side has 23505 guards too — this is purely a
  // network-noise optimisation.
  const attemptedPrefillRef = useRef<Set<string>>(new Set());

  // Optional-first escape hatch: the guided stub screen (below) renders when
  // nothing is drafted, but the two optional kinds (notification, gap
  // summary) have no stubs — this flag lets the auditor skip straight to
  // either tab without creating three unwanted stub rows first.
  const [optionalFirst, setOptionalFirst] = useState(false);

  useEffect(() => {
    setActiveTab('confirmation_letter');
    setOptionalFirst(false);
    // Only the TRANSIENT UX states reset on audit switch. The data-guarding
    // states (persistErrors, unsavedDrafts, failedKindsByAudit) are keyed by
    // audit and deliberately survive it — a preserved draft must still be
    // there when the auditor comes back.
    resetTransient();
    setStubsError(null);
  }, [activeAudit?.id, resetTransient]);

  useEffect(() => {
    if (!activeAudit) return;
    const auditIdLocal = activeAudit.id;
    // Cancellation matters since hasReached joined the deps: the effect can
    // now run twice for the SAME audit (preview → stage advances while
    // mounted). Without it, a slow run-1 fetch resolving after run-2's
    // prefill would clobber the prefilled bundle with the stale pre-advance
    // snapshot. Same pattern as AuditConduct's hydrate effect.
    let cancelled = false;

    const load = async () => {
      try {
        const initial = await fetchPreAuditDeliverables(auditIdLocal);
        if (cancelled) return;
        setAuditFailedKinds(auditIdLocal, initial.failedKinds);
        setSettledAudits((prev) => new Set(prev).add(auditIdLocal));

        // Silent agentic bootstrap: if all three deliverables are missing AND
        // we haven't attempted prefill yet for this audit this session, fire
        // the prefill RPCs in parallel. They server-side-gate on approved
        // Stage 3 + 4 sources and skip silently when not met.
        // Gated on the TRIO's reads being healthy — a failed trio read makes
        // "missing" unknowable (and would burn this session's one attempt on
        // a state we never observed), but a failed read of the two optional
        // kinds says nothing about the trio and must not switch the
        // bootstrap off (in prod those two tables can lag the frontend).
        const trioReadable = !TRIO_KINDS.some((k) => initial.failedKinds.includes(k));
        const trioMissingNow =
          trioReadable &&
          !initial.bundle.confirmation_letter &&
          !initial.bundle.agenda &&
          !initial.bundle.checklist;

        if (trioMissingNow && hasReached && !attemptedPrefillRef.current.has(auditIdLocal)) {
          attemptedPrefillRef.current.add(auditIdLocal);
          await prefillStage5Deliverables(auditIdLocal);
          const refreshed = await fetchPreAuditDeliverables(auditIdLocal);
          if (cancelled) return;
          setAuditFailedKinds(auditIdLocal, refreshed.failedKinds);
          setBundles((prev) => ({ ...prev, [auditIdLocal]: refreshed.bundle }));
        } else {
          setBundles((prev) => ({ ...prev, [auditIdLocal]: initial.bundle }));
        }
      } catch (err) {
        // A thrown read (network drop, not a per-table PostgREST error) means
        // the WHOLE bundle is unknown — mark all five failed so nothing
        // renders a scratch form or bootstrap over state we never saw. The
        // old console-only catch was the last path that still did.
        console.error('[PreAuditDraftingWorkspace] Load error:', err);
        if (!cancelled) {
          setAuditFailedKinds(auditIdLocal, ALL_KINDS);
          setSettledAudits((prev) => new Set(prev).add(auditIdLocal));
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // Depend on activeAudit?.id only — see RiskSummaryPanel for rationale.
    // hasReached added so the bootstrap fires when the audit advances into
    // Stage 5 after an earlier read-only preview ran.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, hasReached, setBundles]);

  if (!activeAudit) return null;

  // ---------------------------------------------------------------------------
  // Mutations
  //
  // Each tab calls onChange(next | null). We diff against the current bundle
  // to figure out: was content edited? was approval transitioned?
  // Then call the right RPC. Optimistic update, revert on failure — the
  // shared persist flow (useDeliverablePersistence) owns the latch/CAS/
  // preserved-draft story.
  // ---------------------------------------------------------------------------

  const persistConfirmationLetter = (
    prev: MockConfirmationLetter | null,
    next: MockConfirmationLetter | null,
  ) =>
    persistDeliverable('confirmation_letter', 'ConfirmationLetter', prev, next, {
      upsert: (n) => upsertConfirmationLetter(auditId, n.content),
      approve: (p) => approveConfirmationLetter(p.id, p.updated_at),
    });

  const persistAgenda = (prev: MockAgenda | null, next: MockAgenda | null) =>
    persistDeliverable('agenda', 'Agenda', prev, next, {
      upsert: (n) => upsertAgenda(auditId, n.content),
      approve: (p) => approveAgenda(p.id, p.updated_at),
    });

  const persistChecklist = (prev: MockChecklist | null, next: MockChecklist | null) =>
    persistDeliverable('checklist', 'Checklist', prev, next, {
      upsert: (n) => upsertChecklist(auditId, n.content),
      approve: (p) => approveChecklist(p.id, p.updated_at),
    });

  const persistInternalNotification = (
    prev: MockInternalNotification | null,
    next: MockInternalNotification | null,
  ) =>
    persistDeliverable('internal_notification', 'InternalNotification', prev, next, {
      upsert: (n) => upsertInternalNotification(auditId, n.content),
      approve: (p) => approveInternalNotification(p.id, p.updated_at),
    });

  const persistEvidenceGapSummary = (
    prev: MockEvidenceGapSummary | null,
    next: MockEvidenceGapSummary | null,
  ) =>
    persistDeliverable('evidence_gap_summary', 'EvidenceGapSummary', prev, next, {
      upsert: (n) => upsertEvidenceGapSummary(auditId, n.content),
      approve: (p) => approveEvidenceGapSummary(p.id, p.updated_at),
    });

  const generateAllStubs = async () => {
    setStubsError(null);
    // Stubs cover the three gating deliverables only — the internal
    // notification has no stub by design (drafted from its tab when wanted).
    // Functional merges so a concurrently-landed notification is preserved.
    const stubs = {
      confirmation_letter: createConfirmationStub(auditId),
      agenda: createAgendaStub(auditId),
      checklist: createChecklistStub(auditId),
    };
    setBundles((prev) => ({
      ...prev,
      [auditId]: { ...(prev[auditId] ?? EMPTY_BUNDLE), ...stubs },
    }));

    try {
      const [letter, agenda, checklist] = await Promise.all([
        upsertConfirmationLetter(auditId, stubs.confirmation_letter.content, 'Generated stub'),
        upsertAgenda(auditId, stubs.agenda.content, 'Generated stub'),
        upsertChecklist(auditId, stubs.checklist.content, 'Generated stub'),
      ]);
      // Refetch server truth rather than hand-merging the write results: a
      // null here can mean "failed" OR "row already existed" (23505 from a
      // concurrent prefill/tab) — only the read path can tell them apart,
      // and writing nulls into cache would render a scratch form over a row
      // that exists. refreshBundle also clears the optimistic stubs on
      // failure (all-kinds-unknown beats unsaved-shown-as-saved).
      await refreshBundle();
      if (!letter || !agenda || !checklist) {
        setStubsError('Some stubs failed to save — showing what the server actually holds. Retry when ready.');
      }
    } catch (err) {
      console.error('[PreAuditDraftingWorkspace] generateAllStubs error:', err);
      await refreshBundle();
      setStubsError('Generating stubs failed — retry when ready.');
    }
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const tabRail = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const tabActive = isLight
    ? 'border-brand-600 text-brand-600'
    : 'border-brand-300 text-brand-300';
  const tabInactive = isLight
    ? 'border-transparent text-[#334155]/60 hover:text-[#0F172A]'
    : 'border-transparent text-[#CBD5E1]/55 hover:text-white';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';

  // ---------------------------------------------------------------------------
  // Empty state — nothing drafted yet. The two non-gating kinds are part of
  // the check so an existing notification or gap-summary row is never hidden
  // behind the stub screen (data on the server must always render);
  // trioMissing separately drives the in-tab stub affordance below, so the
  // one-click bootstrap stays reachable when the tabs render with the gating
  // trio still unstarted.
  // ---------------------------------------------------------------------------
  // A failed kind's null is unknown, not absent — the "nothing drafted yet"
  // screen and the stub bootstrap must not run over a bundle we couldn't
  // actually read (a scratch form over real server data is the lie this PR
  // exists to end). Failed tabs render their own load-error card below.
  // Each derived flag is gated on the health of exactly the kinds it reads:
  // the trio affordances survive a failed read of the two optional kinds.
  const failedKinds = failedKindsByAudit[auditId] ?? [];
  const trioReadable = !TRIO_KINDS.some((k) => failedKinds.includes(k));
  const trioMissing =
    trioReadable && !bundle.confirmation_letter && !bundle.agenda && !bundle.checklist;
  const allMissing =
    trioMissing &&
    failedKinds.length === 0 &&
    !bundle.internal_notification &&
    !bundle.evidence_gap_summary;

  const retryBundleLoad = async () => {
    if (retryingBundle) return;
    setRetryingBundle(true);
    try {
      await refreshBundle(); // never throws; failure re-marks all five unknown
    } finally {
      setRetryingBundle(false);
    }
  };

  // A cached bundle without a settled read THIS mount must not render
  // scratch forms or bootstraps — the failed-kinds qualifier died with the
  // previous mount and hasn't been re-earned yet.
  if (!settledAudits.has(auditId)) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 5 · Pre-audit drafting
        </p>
        <p className={`${subColor} text-sm mt-2`}>Loading deliverables…</p>
      </div>
    );
  }

  if (allMissing && !optionalFirst) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 5 · Pre-audit drafting
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Draft pre-audit deliverables
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          The pre-audit deliverables — confirmation letter, agenda, checklist, plus an
          optional internal notification and evidence gap summary — are drafted here from
          your approved risk summary and vendor service mappings. Stubs start the three
          gating deliverables; the two optional ones have no stubs and are drafted from
          their own tabs.
        </p>
        {hasReached && (
          <div className="mt-5 flex items-center gap-4 flex-wrap">
            <button
              type="button"
              onClick={generateAllStubs}
              className={`inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
            >
              <Sparkles size={14} />
              Generate all three stubs
            </button>
            <button
              type="button"
              onClick={() => {
                setOptionalFirst(true);
                setActiveTab('internal_notification');
              }}
              className={`${subColor} text-sm font-medium underline underline-offset-2 hover:opacity-80`}
            >
              Start with the internal notification instead
            </button>
            <button
              type="button"
              onClick={() => {
                setOptionalFirst(true);
                setActiveTab('evidence_gap_summary');
              }}
              className={`${subColor} text-sm font-medium underline underline-offset-2 hover:opacity-80`}
            >
              …or the evidence gap summary
            </button>
          </div>
        )}
        {stubsError && (
          <div
            role="alert"
            data-testid="stage5-stubs-error"
            className={`text-xs px-3 py-2 mt-4 rounded-md border ${
              isLight
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            {stubsError}
          </div>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Per-tab approval signals + advance gate
  // ---------------------------------------------------------------------------
  const approvalStatuses: Record<TabKey, DeliverableApprovalStatus | null> = {
    confirmation_letter: bundle.confirmation_letter?.approval_status ?? null,
    agenda: bundle.agenda?.approval_status ?? null,
    checklist: bundle.checklist?.approval_status ?? null,
    internal_notification: bundle.internal_notification?.approval_status ?? null,
    evidence_gap_summary: bundle.evidence_gap_summary?.approval_status ?? null,
  };
  // Derived from the SAME gating flags that render the gate checklist, so the
  // advance button and the list can never disagree about membership. The
  // internal notification and evidence gap summary (gating: false) never
  // feed this.
  const allApproved = GATING_TAB_DEFS.every((t) => approvalStatuses[t.key] === 'APPROVED');

  const alreadyAdvanced = hasPassedStage(
    activeAudit.workflow_type,
    activeAudit.current_stage,
    'PRE_AUDIT_DRAFTING',
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // Any deliverable that was agent-bootstrapped surfaces the one-time note.
  const anyPrefilled =
    !!bundle.confirmation_letter?.prefilled_at ||
    !!bundle.agenda?.prefilled_at ||
    !!bundle.checklist?.prefilled_at;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 5 · Pre-audit drafting
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Draft pre-audit deliverables
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Five deliverables share this stage. The confirmation letter, agenda, and checklist
          must be Approved before audit conduct unlocks; the internal notification and
          evidence gap summary are optional and never block. Editing an Approved
          deliverable reverts it to Draft.
        </p>
      </div>

      {/* Evidence summary chip — grounding matters most at this stage: the
          deliverables draft from what the register holds. Opens the
          shell's audit-level Evidence drawer (one list, one implementation). */}
      {openEvidence && evidenceCount !== null && (
        <button
          type="button"
          onClick={openEvidence}
          data-testid="stage5-evidence-chip"
          className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
              : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
          }`}
        >
          <Paperclip size={12} />
          {evidenceCount === 0
            ? 'No source evidence attached yet — attach'
            : `${evidenceCount} evidence source${evidenceCount === 1 ? '' : 's'} attached · View`}
        </button>
      )}

      {/* Agentic moment — one-time note. Dismissable; persists per (stage, audit)
          in localStorage. The next-action signal lives inside the note text. */}
      {anyPrefilled && (
        <PrefillAgentNote
          storageKey={`piq-stage5-prefill-note-dismissed:${auditId}`}
          message="These deliverables were pre-filled from your approved questionnaire and risk summary. Review and approve the letter, agenda, and checklist before continuing."
        />
      )}

      {/* Stub bootstrap stays reachable when the tabs rendered with the
          gating trio unstarted (notification-first flow) — without this the
          one-click stub path exists only on the all-empty screen. */}
      {trioMissing && hasReached && (
        <div className={`${cardBg} border rounded-xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap`}>
          <p className={`${subColor} text-sm`}>
            The confirmation letter, agenda, and checklist haven't been started.
          </p>
          <button
            type="button"
            onClick={generateAllStubs}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary}`}
          >
            <Sparkles size={12} />
            Generate all three stubs
          </button>
        </div>
      )}
      {stubsError && (
        <div
          role="alert"
          data-testid="stage5-stubs-error"
          className={`text-xs px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          {stubsError}
        </div>
      )}

      {/* Tab rail with per-tab approval indicator */}
      <div className={`border-b ${tabRail}`}>
        <div className="flex items-stretch gap-1 overflow-x-auto">
          {TAB_DEFS.map((t) => {
            const Icon = t.icon;
            const status = approvalStatuses[t.key];
            const isActive = activeTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  isActive ? tabActive : tabInactive
                }`}
              >
                <Icon size={14} />
                {t.label}
                <ApprovalDot status={status} isLight={isLight} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Active tab content. A kind whose bundle SELECT failed renders a
          load-error card in place of its panel + tab: its null slot is
          unknown, not absent, and a scratch form (or a "Draft with PIQC" CTA)
          over unknown server state invites overwriting real data. */}
      {activeTab === 'confirmation_letter' &&
        (failedKinds.includes('confirmation_letter') ? (
          <DeliverableLoadError noun="confirmation letter" isLight={isLight} retrying={retryingBundle} onRetry={retryBundleLoad} />
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="confirmation_letter"
              noun="confirmation letter"
              deliverable={bundle.confirmation_letter}
              evidenceRows={evidenceRows}
              generating={generatingTab === 'confirmation_letter'}
              editing={editingTabs['confirmation_letter'] === true}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              privacyNote="Recipients are never sent to the model — they stay exactly as you set them."
              onGenerate={() => void runGeneration('confirmation_letter')}
            />
            <ConfirmationLetterTab
              key={auditId}
              deliverable={bundle.confirmation_letter}
              isLight={isLight}
              onChange={(next) => {
                setBundleField('confirmation_letter', next);
                persistConfirmationLetter(bundle.confirmation_letter, next);
              }}
              onEditingChange={(e) => setTabEditing('confirmation_letter', e)}
              previewLocked={!hasReached}
              saving={savingTabs['confirmation_letter'] === true}
              saveError={persistErrors[auditId]?.['confirmation_letter'] ?? null}
              unsavedDraft={unsavedDraftFor(auditId, 'confirmation_letter')}
              approveError={approveErrors['confirmation_letter'] ?? null}
              staleNotice={staleReloadNotices['confirmation_letter'] ?? null}
              onDismissSaveError={() => dismissSaveError('confirmation_letter')}
            />
          </>
        ))}
      {activeTab === 'agenda' &&
        (failedKinds.includes('agenda') ? (
          <DeliverableLoadError noun="agenda" isLight={isLight} retrying={retryingBundle} onRetry={retryBundleLoad} />
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="agenda"
              noun="agenda"
              deliverable={bundle.agenda}
              evidenceRows={evidenceRows}
              generating={generatingTab === 'agenda'}
              editing={editingTabs['agenda'] === true}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              onGenerate={() => void runGeneration('agenda')}
            />
            <AgendaTab
              key={auditId}
              deliverable={bundle.agenda}
              isLight={isLight}
              onChange={(next) => {
                setBundleField('agenda', next);
                persistAgenda(bundle.agenda, next);
              }}
              onEditingChange={(e) => setTabEditing('agenda', e)}
              previewLocked={!hasReached}
              saving={savingTabs['agenda'] === true}
              saveError={persistErrors[auditId]?.['agenda'] ?? null}
              unsavedDraft={unsavedDraftFor(auditId, 'agenda')}
              approveError={approveErrors['agenda'] ?? null}
              staleNotice={staleReloadNotices['agenda'] ?? null}
              onDismissSaveError={() => dismissSaveError('agenda')}
            />
          </>
        ))}
      {activeTab === 'checklist' &&
        (failedKinds.includes('checklist') ? (
          <DeliverableLoadError noun="checklist" isLight={isLight} retrying={retryingBundle} onRetry={retryBundleLoad} />
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="checklist"
              noun="checklist"
              deliverable={bundle.checklist}
              evidenceRows={evidenceRows}
              generating={generatingTab === 'checklist'}
              editing={editingTabs['checklist'] === true}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              onGenerate={() => void runGeneration('checklist')}
            />
            <ChecklistTab
              key={auditId}
              deliverable={bundle.checklist}
              isLight={isLight}
              onChange={(next) => {
                setBundleField('checklist', next);
                persistChecklist(bundle.checklist, next);
              }}
              onEditingChange={(e) => setTabEditing('checklist', e)}
              previewLocked={!hasReached}
              saving={savingTabs['checklist'] === true}
              saveError={persistErrors[auditId]?.['checklist'] ?? null}
              unsavedDraft={unsavedDraftFor(auditId, 'checklist')}
              approveError={approveErrors['checklist'] ?? null}
              staleNotice={staleReloadNotices['checklist'] ?? null}
              onDismissSaveError={() => dismissSaveError('checklist')}
            />
          </>
        ))}
      {activeTab === 'internal_notification' &&
        (failedKinds.includes('internal_notification') ? (
          <DeliverableLoadError noun="internal notification" isLight={isLight} retrying={retryingBundle} onRetry={retryBundleLoad} />
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="internal_notification"
              noun="internal notification"
              deliverable={bundle.internal_notification}
              evidenceRows={evidenceRows}
              generating={generatingTab === 'internal_notification'}
              editing={editingTabs['internal_notification'] === true}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              onGenerate={() => void runGeneration('internal_notification')}
            />
            <SimpleLetterTab
              key={auditId}
              config={NOTIFICATION_TAB_CONFIG}
              deliverable={bundle.internal_notification}
              isLight={isLight}
              onChange={(next) => {
                setBundleField('internal_notification', next);
                persistInternalNotification(bundle.internal_notification, next);
              }}
              onEditingChange={(e) => setTabEditing('internal_notification', e)}
              previewLocked={!hasReached}
              saving={savingTabs['internal_notification'] === true}
              saveError={persistErrors[auditId]?.['internal_notification'] ?? null}
              unsavedDraft={unsavedDraftFor(auditId, 'internal_notification')}
              approveError={approveErrors['internal_notification'] ?? null}
              staleNotice={staleReloadNotices['internal_notification'] ?? null}
              onDismissSaveError={() => dismissSaveError('internal_notification')}
            />
          </>
        ))}
      {activeTab === 'evidence_gap_summary' &&
        (failedKinds.includes('evidence_gap_summary') ? (
          <DeliverableLoadError noun="evidence gap summary" isLight={isLight} retrying={retryingBundle} onRetry={retryBundleLoad} />
        ) : (
          <>
            <DeliverableGenerationPanel
              kind="evidence_gap_summary"
              noun="evidence gap summary"
              deliverable={bundle.evidence_gap_summary}
              evidenceRows={evidenceRows}
              generating={generatingTab === 'evidence_gap_summary'}
              editing={editingTabs['evidence_gap_summary'] === true}
              error={generationError}
              isLight={isLight}
              previewLocked={!hasReached}
              // A failed checklist READ makes the axis unknowable (undefined),
              // which computeDeliverableCurrency treats as no-verdict — while
              // a confirmed absent checklist row is genuinely [] (live ids).
              liveChecklistItemIds={
                failedKinds.includes('checklist') ? undefined : checklistLiveIds(bundle.checklist)
              }
              onGenerate={() => void runGeneration('evidence_gap_summary')}
            />
            <SimpleLetterTab
              key={auditId}
              config={GAP_SUMMARY_TAB_CONFIG}
              deliverable={bundle.evidence_gap_summary}
              isLight={isLight}
              onChange={(next) => {
                setBundleField('evidence_gap_summary', next);
                persistEvidenceGapSummary(bundle.evidence_gap_summary, next);
              }}
              onEditingChange={(e) => setTabEditing('evidence_gap_summary', e)}
              previewLocked={!hasReached}
              saving={savingTabs['evidence_gap_summary'] === true}
              saveError={persistErrors[auditId]?.['evidence_gap_summary'] ?? null}
              unsavedDraft={unsavedDraftFor(auditId, 'evidence_gap_summary')}
              approveError={approveErrors['evidence_gap_summary'] ?? null}
              staleNotice={staleReloadNotices['evidence_gap_summary'] ?? null}
              onDismissSaveError={() => dismissSaveError('evidence_gap_summary')}
            />
          </>
        ))}

      {/* Stage advance */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Stage transition
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {alreadyAdvanced
                ? 'Audit has already advanced past this stage'
                : allApproved
                ? 'Gating deliverables approved — ready to advance'
                : 'Approve the confirmation letter, agenda, and checklist to advance'}
            </p>
            {!alreadyAdvanced && !allApproved && (
              <ul className={`${subColor} text-xs mt-2 space-y-1`}>
                {GATING_TAB_DEFS.map((t) => {
                  const s = approvalStatuses[t.key];
                  const ok = s === 'APPROVED';
                  return (
                    <li key={t.key} className="flex items-center gap-1.5">
                      {ok ? (
                        <CheckCircle2 size={11} className="text-emerald-600" />
                      ) : (
                        <span className={`inline-block w-2.5 h-2.5 rounded-full border ${
                          isLight ? 'border-[#CBD5E1]' : 'border-white/15'
                        }`} />
                      )}
                      <span className={ok ? subColor : mutedColor}>{t.label}</span>
                      <span className={`${mutedColor} text-[10px] uppercase tracking-wider`}>
                        {/* A failed read is 'unavailable', never 'not started' —
                            the row may be APPROVED on the server. The gate
                            itself stays fail-closed either way. */}
                        {s === 'APPROVED'
                          ? 'approved'
                          : s === 'DRAFT'
                          ? 'draft'
                          : failedKinds.includes(t.key)
                          ? 'unavailable'
                          : 'not started'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {alreadyAdvanced && (
              <p className={`${subColor} text-xs mt-1`}>
                Current stage: {activeAudit.current_stage.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => advanceStage('AUDIT_CONDUCT')}
            disabled={!allApproved || alreadyAdvanced || !hasReached}
            className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
          >
            Advance to Audit conduct
            <ArrowRight size={14} />
          </button>
          {advanceStageError && (
            <div
              role="alert"
              className={`text-xs px-3 py-2 mt-3 rounded-md border ${
                isLight
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-red-500/15 border-red-500/30 text-red-300'
              }`}
            >
              Couldn’t advance the stage: {advanceStageError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// DeliverableLoadError — honest stand-in for a tab whose bundle SELECT
// failed. Says "couldn't read" instead of rendering the scratch form that
// used to sit over unknown server data.
// ============================================================================

function DeliverableLoadError({
  noun,
  isLight,
  retrying,
  onRetry,
}: {
  noun: string;
  isLight: boolean;
  retrying: boolean;
  onRetry: () => void;
}) {
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  return (
    <div
      role="alert"
      data-testid="deliverable-load-error"
      className={`${cardBg} border rounded-xl p-5 space-y-3`}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          size={14}
          className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-red-600' : 'text-red-400'}`}
        />
        <p className={`text-sm leading-relaxed ${isLight ? 'text-red-700' : 'text-red-300'}`}>
          The {noun} could not be loaded — it may exist on the server, so no scratch form is
          shown (typing into one would overwrite whatever is really there).
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 ${
          isLight
            ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
            : 'bg-[#0F172A] border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
        }`}
      >
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}

// ============================================================================
// ApprovalDot — small marker shown next to each tab label
// ============================================================================

function ApprovalDot({
  status,
  isLight,
}: {
  status: DeliverableApprovalStatus | null;
  isLight: boolean;
}) {
  if (status === 'APPROVED') {
    return (
      <span className={isLight ? 'text-emerald-600' : 'text-emerald-400'}>
        <CheckCircle2 size={12} />
      </span>
    );
  }
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full ${
        status === 'DRAFT'
          ? 'bg-amber-500'
          : isLight
          ? 'bg-[#CBD5E1]'
          : 'bg-white/15'
      }`}
    />
  );
}

// ============================================================================
// Confirmation Letter tab
// ============================================================================

interface ConfirmationLetterTabProps {
  deliverable: MockConfirmationLetter | null;
  isLight: boolean;
  onChange: (next: MockConfirmationLetter | null) => void;
  // Reports the tab's edit mode so the generation panel can disable
  // Revise while unsaved edits exist (rule: persist human edits first).
  onEditingChange?: (editing: boolean) => void;
  /** One-ahead preview (UX2): no scratch form, no Edit/Approve. */
  previewLocked?: boolean;
  /** Persist honesty (PR-1): save in flight blocks Save/Approve. */
  saving?: boolean;
  /** Last save failed — banner shows, editor keeps its content, Approve
   *  blocks until it clears (retry succeeds or Cancel discards). */
  saveError?: string | null;
  /** The row a failed upsert could not save — survives this tab unmounting
   *  (tab switches). The editor seeds from it so the banner's "preserved"
   *  promise holds across remounts. */
  unsavedDraft?: MockConfirmationLetter | null;
  /** Non-stale approve failure: content is saved, only the latch didn't
   *  move — banner only; Approve stays retryable, no editor interaction. */
  approveError?: string | null;
  /** Informational: approve CAS-missed and server truth was reloaded. */
  staleNotice?: string | null;
  onDismissSaveError?: () => void;
}

function ConfirmationLetterTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false, saving = false, saveError = null, unsavedDraft = null, approveError = null, staleNotice = null, onDismissSaveError }: ConfirmationLetterTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [body, setBody] = useState((unsavedDraft ?? deliverable)?.content.body_text ?? '');
  const [recipients, setRecipients] = useState<string[]>(
    (unsavedDraft ?? deliverable)?.content.recipients ?? [],
  );
  const [scope, setScope] = useState<string[]>((unsavedDraft ?? deliverable)?.content.scope ?? []);

  // Same-id resync + failed-save force-edit — see useDeliverableResync for
  // the full rationale (skip-while-saveError is the data-loss guard).
  useDeliverableResync({
    deliverable,
    saveError,
    syncFromServer: () => {
      setEditing(!deliverable);
      setBody(deliverable?.content.body_text ?? '');
      setRecipients(deliverable?.content.recipients ?? []);
      setScope(deliverable?.content.scope ?? []);
    },
    forceEdit: () => setEditing(true),
  });

  const save = () => {
    onChange({
      id: deliverable?.id ?? `cl-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { body_text: body, recipients, scope },
      // Editing demotes APPROVED → DRAFT
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
      // Optimistic placeholder; the persist round-trip replaces this with the
      // server row (whose updated_at the approve CAS then uses).
      updated_at: deliverable?.updated_at ?? new Date().toISOString(),
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    // An explicit discard: form returns to server truth, so the pending
    // save error (and its Approve block) clears with it.
    onDismissSaveError?.();
    setBody(deliverable?.content.body_text ?? '');
    setRecipients(deliverable?.content.recipients ?? []);
    setScope(deliverable?.content.scope ?? []);
    setEditing(false);
  };

  return (
    <DeliverableShell
      kind="Confirmation letter"
      objectType="CONFIRMATION_LETTER_OBJECT"
      description="Sent to the vendor confirming dates, attendees, and scope. Sponsor branding is added externally on export."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={!!body.trim()}
      previewLocked={previewLocked}
      saving={saving}
      saveError={saveError}
      approveError={approveError}
      staleNotice={staleNotice}
      prefilledSources={
        deliverable?.prefilled_at
          ? [
              ...(deliverable.source_risk_summary_id ? ['risk summary focus areas'] : []),
              ...(deliverable.source_questionnaire_instance_id ? ['vendor contact'] : []),
            ]
          : undefined
      }
    >
      {previewLocked && !deliverable ? (
        <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
      ) : !editing && deliverable ? (
        <div className="space-y-4">
          <SubSection label="Body" isLight={isLight}>
            <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
              {deliverable.content.body_text}
            </p>
          </SubSection>
          {deliverable.content.recipients.length > 0 && (
            <SubSection label="Recipients" isLight={isLight}>
              <div className="flex flex-wrap gap-1.5">
                {deliverable.content.recipients.map((r, i) => (
                  <Chip key={i} isLight={isLight}>{r}</Chip>
                ))}
              </div>
            </SubSection>
          )}
          {deliverable.content.scope.length > 0 && (
            <SubSection label="Scope" isLight={isLight}>
              <ul className="space-y-1">
                {deliverable.content.scope.map((s, i) => (
                  <li
                    key={i}
                    className={`text-sm flex items-start gap-2 ${isLight ? 'text-[#0F172A]' : 'text-white'}`}
                  >
                    <span
                      className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                        isLight ? 'bg-brand-600/55' : 'bg-brand-300/55'
                      }`}
                    />
                    {s}
                  </li>
                ))}
              </ul>
            </SubSection>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FieldLabel label="Body text" isLight={isLight}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder="Confirm dates, attendees, and scope. Keep it sponsor-name-free."
              className={textareaClass(isLight)}
            />
          </FieldLabel>
          <ChipListEditor
            label="Recipients"
            placeholder='e.g. "Maya Khoury (Quality Director)"'
            items={recipients}
            onChange={setRecipients}
            isLight={isLight}
          />
          <ChipListEditor
            label="Scope"
            placeholder="One scope item per entry"
            items={scope}
            onChange={setScope}
            isLight={isLight}
            multiline
          />
        </div>
      )}
    </DeliverableShell>
  );
}

// ============================================================================
// Simple letter tab — shared by the two OPTIONAL letter-shaped kinds:
//   - Internal notification (PR-D1): letter-shaped, deliberately without a
//     recipients editor — internal distribution happens outside PIQC, and
//     roles-only body text keeps the deliverable name-free end to end.
//   - Evidence gap summary (PR-D3): same shape; almost always drafted with
//     PIQC (grounding in the register is the point), the scratch form exists
//     so a manual summary is still possible when generation is down.
// The two diverge ONLY in strings (rule-of-three: the third letter-shaped
// tab was the consolidation moment, same call as persistDeliverable). The
// confirmation letter stays its own component — recipients is a behavioral
// axis, not a string.
// ============================================================================

// Structural common shape of the two kinds' rows. Both Mock types are
// mutually assignable with it (their generation fields are optional), so the
// call sites keep their precisely-typed persist wrappers without casts.
interface SimpleLetterDeliverable {
  id: string;
  audit_id: string;
  content: { body_text: string; scope: string[] };
  approval_status: DeliverableApprovalStatus;
  approved_by_name: string | null;
  approved_at: string | null;
  updated_at: string;
}

interface SimpleLetterTabConfig {
  kind: string;
  objectType: TrackedObjectType;
  description: string;
  /** Optimistic-row id mint, e.g. 'in' → `in-${Date.now()}`. */
  idPrefix: string;
  scopeLabel: string;
  bodyPlaceholder: string;
  scopePlaceholder: string;
}

const NOTIFICATION_TAB_CONFIG: SimpleLetterTabConfig = {
  kind: 'Internal notification',
  objectType: 'INTERNAL_NOTIFICATION_OBJECT',
  description: 'Circulated inside your organization to announce the audit and invite scope input before the opening meeting. Optional — approving it is never required to advance. Address roles, not names; distribution happens outside PIQC.',
  idPrefix: 'in',
  scopeLabel: 'Scope',
  bodyPlaceholder: 'Announce the audit to internal stakeholders and invite scope input before the opening meeting. Address roles, not names.',
  scopePlaceholder: 'One scope item per entry',
};

const GAP_SUMMARY_TAB_CONFIG: SimpleLetterTabConfig = {
  kind: 'Evidence gap summary',
  objectType: 'EVIDENCE_GAP_SUMMARY_OBJECT',
  description: 'Per scope area: what evidence the register holds and what remains outstanding. Withheld register documents are named as withheld, never silently absent. Optional — approving it is never required to advance.',
  idPrefix: 'egs',
  scopeLabel: 'Scope areas covered',
  bodyPlaceholder: 'Summarize per scope area what evidence is on file and what remains outstanding. Name withheld documents as withheld.',
  scopePlaceholder: 'One scope area per entry',
};

interface SimpleLetterTabProps {
  config: SimpleLetterTabConfig;
  deliverable: SimpleLetterDeliverable | null;
  isLight: boolean;
  onChange: (next: SimpleLetterDeliverable | null) => void;
  // Reports the tab's edit mode so the generation panel can disable
  // Revise while unsaved edits exist (rule: persist human edits first).
  onEditingChange?: (editing: boolean) => void;
  /** One-ahead preview (UX2): no scratch form, no Edit/Approve. */
  previewLocked?: boolean;
  /** Persist honesty (PR-1) — see ConfirmationLetterTabProps. */
  saving?: boolean;
  saveError?: string | null;
  unsavedDraft?: SimpleLetterDeliverable | null;
  approveError?: string | null;
  staleNotice?: string | null;
  onDismissSaveError?: () => void;
}

function SimpleLetterTab({ config, deliverable, isLight, onChange, onEditingChange, previewLocked = false, saving = false, saveError = null, unsavedDraft = null, approveError = null, staleNotice = null, onDismissSaveError }: SimpleLetterTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [body, setBody] = useState((unsavedDraft ?? deliverable)?.content.body_text ?? '');
  const [scope, setScope] = useState<string[]>((unsavedDraft ?? deliverable)?.content.scope ?? []);

  // Same-id resync + failed-save force-edit — see useDeliverableResync.
  useDeliverableResync({
    deliverable,
    saveError,
    syncFromServer: () => {
      setEditing(!deliverable);
      setBody(deliverable?.content.body_text ?? '');
      setScope(deliverable?.content.scope ?? []);
    },
    forceEdit: () => setEditing(true),
  });

  const save = () => {
    onChange({
      id: deliverable?.id ?? `${config.idPrefix}-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { body_text: body, scope },
      // Editing demotes APPROVED → DRAFT
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
      // Optimistic placeholder; the persist round-trip replaces this with the
      // server row (whose updated_at the approve CAS then uses).
      updated_at: deliverable?.updated_at ?? new Date().toISOString(),
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    onDismissSaveError?.();
    setBody(deliverable?.content.body_text ?? '');
    setScope(deliverable?.content.scope ?? []);
    setEditing(false);
  };

  return (
    <DeliverableShell
      kind={config.kind}
      objectType={config.objectType}
      description={config.description}
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={!!body.trim()}
      previewLocked={previewLocked}
      saving={saving}
      saveError={saveError}
      approveError={approveError}
      staleNotice={staleNotice}
    >
      {previewLocked && !deliverable ? (
        <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
      ) : !editing && deliverable ? (
        <div className="space-y-4">
          <SubSection label="Body" isLight={isLight}>
            <p className={`text-sm whitespace-pre-wrap leading-relaxed ${isLight ? 'text-[#0F172A]' : 'text-white'}`}>
              {deliverable.content.body_text}
            </p>
          </SubSection>
          {deliverable.content.scope.length > 0 && (
            <SubSection label={config.scopeLabel} isLight={isLight}>
              <ul className="space-y-1">
                {deliverable.content.scope.map((s, i) => (
                  <li
                    key={i}
                    className={`text-sm flex items-start gap-2 ${isLight ? 'text-[#0F172A]' : 'text-white'}`}
                  >
                    <span
                      className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                        isLight ? 'bg-brand-600/55' : 'bg-brand-300/55'
                      }`}
                    />
                    {s}
                  </li>
                ))}
              </ul>
            </SubSection>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <FieldLabel label="Body text" isLight={isLight}>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              placeholder={config.bodyPlaceholder}
              className={textareaClass(isLight)}
            />
          </FieldLabel>
          <ChipListEditor
            label={config.scopeLabel}
            placeholder={config.scopePlaceholder}
            items={scope}
            onChange={setScope}
            isLight={isLight}
            multiline
          />
        </div>
      )}
    </DeliverableShell>
  );
}

// ============================================================================
// Agenda tab
// ============================================================================

interface AgendaTabProps {
  deliverable: MockAgenda | null;
  isLight: boolean;
  onChange: (next: MockAgenda | null) => void;
  // Reports the tab's edit mode so the generation panel can disable
  // Revise while unsaved edits exist (rule: persist human edits first).
  onEditingChange?: (editing: boolean) => void;
  /** One-ahead preview (UX2): no scratch form, no Edit/Approve. */
  previewLocked?: boolean;
  /** Persist honesty (PR-1) — see ConfirmationLetterTabProps. */
  saving?: boolean;
  saveError?: string | null;
  unsavedDraft?: MockAgenda | null;
  approveError?: string | null;
  staleNotice?: string | null;
  onDismissSaveError?: () => void;
}

function AgendaTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false, saving = false, saveError = null, unsavedDraft = null, approveError = null, staleNotice = null, onDismissSaveError }: AgendaTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [items, setItems] = useState<MockAgendaItem[]>(
    (unsavedDraft ?? deliverable)?.content.items ?? [],
  );

  // Same-id resync + failed-save force-edit — see useDeliverableResync.
  useDeliverableResync({
    deliverable,
    saveError,
    syncFromServer: () => {
      setEditing(!deliverable);
      setItems(deliverable?.content.items ?? []);
    },
    forceEdit: () => setEditing(true),
  });

  const save = () => {
    onChange({
      id: deliverable?.id ?? `ag-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { items },
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
      updated_at: deliverable?.updated_at ?? new Date().toISOString(),
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    onDismissSaveError?.();
    setItems(deliverable?.content.items ?? []);
    setEditing(false);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      { id: `ai-${Date.now()}-${prev.length}`, time: '', topic: '', owner: '', notes: null },
    ]);
  };

  const updateItem = (id: string, patch: Partial<MockAgendaItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  return (
    <DeliverableShell
      kind="Agenda"
      objectType="AGENDA_OBJECT"
      description="Day-by-day audit plan. Each row is one slot — time, topic, owner, optional notes."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      prefilledSources={
        deliverable?.prefilled_at && deliverable.source_risk_summary_id
          ? ['risk summary focus areas']
          : undefined
      }
      canSave={items.length > 0 && items.every((it) => it.time.trim() && it.topic.trim())}
      previewLocked={previewLocked}
      saving={saving}
      saveError={saveError}
      approveError={approveError}
      staleNotice={staleNotice}
    >
      {previewLocked && !deliverable ? (
        <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
      ) : !editing && deliverable && deliverable.content.items.length > 0 ? (
        <div className="space-y-2">
          {deliverable.content.items.map((it) => (
            <AgendaItemRow key={it.id} item={it} isLight={isLight} />
          ))}
        </div>
      ) : !editing && deliverable ? (
        <p className={`text-sm italic ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
          No agenda items.
        </p>
      ) : (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className={`text-sm italic ${isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'}`}>
              No agenda items yet. Add one below.
            </p>
          )}
          {items.map((it) => (
            <AgendaItemEditRow
              key={it.id}
              item={it}
              isLight={isLight}
              onUpdate={(patch) => updateItem(it.id, patch)}
              onRemove={() => removeItem(it.id)}
            />
          ))}
          <button
            type="button"
            onClick={addItem}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
            }`}
          >
            <Plus size={14} />
            Add agenda item
          </button>
        </div>
      )}
    </DeliverableShell>
  );
}

function AgendaItemRow({ item, isLight }: { item: MockAgendaItem; isLight: boolean }) {
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/[0.04]';
  return (
    <div className={`${cardBg} border rounded-md px-3 py-2.5`}>
      <p className={`text-[11px] uppercase tracking-wider font-semibold ${mutedColor}`}>
        {item.time}
      </p>
      <p className={`${headingColor} text-sm font-semibold mt-0.5`}>{item.topic}</p>
      <p className={`${subColor} text-xs mt-0.5`}>Owner: {item.owner}</p>
      {item.notes && (
        <p className={`${subColor} text-xs mt-1.5 leading-relaxed`}>{item.notes}</p>
      )}
    </div>
  );
}

function AgendaItemEditRow({
  item,
  isLight,
  onUpdate,
  onRemove,
}: {
  item: MockAgendaItem;
  isLight: boolean;
  onUpdate: (patch: Partial<MockAgendaItem>) => void;
  onRemove: () => void;
}) {
  const headingColor = 'text-fg-heading';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const buttonGhost = isLight
    ? 'text-[#334155]/55 hover:text-red-600'
    : 'text-[#CBD5E1]/55 hover:text-red-400';
  return (
    <div className={`${cardBg} border rounded-md p-3 space-y-2`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
          <input
            type="text"
            value={item.time}
            onChange={(e) => onUpdate({ time: e.target.value })}
            placeholder='Day 1 · 09:00 – 10:00'
            className={inputClass(isLight)}
          />
          <input
            type="text"
            value={item.topic}
            onChange={(e) => onUpdate({ topic: e.target.value })}
            placeholder="Topic"
            className={`${inputClass(isLight)} sm:col-span-2`}
          />
          <input
            type="text"
            value={item.owner}
            onChange={(e) => onUpdate({ owner: e.target.value })}
            placeholder="Owner (auditor / vendor team)"
            className={`${inputClass(isLight)} sm:col-span-3`}
          />
          <textarea
            value={item.notes ?? ''}
            onChange={(e) => onUpdate({ notes: e.target.value || null })}
            rows={2}
            placeholder="Notes (optional)"
            className={`${inputClass(isLight)} ${headingColor} sm:col-span-3`}
          />
        </div>
        <button
          type="button"
          onClick={onRemove}
          className={`flex-shrink-0 p-1.5 rounded-md ${buttonGhost}`}
          aria-label="Remove agenda item"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Checklist tab
// ============================================================================

interface ChecklistTabProps {
  deliverable: MockChecklist | null;
  isLight: boolean;
  onChange: (next: MockChecklist | null) => void;
  // Reports the tab's edit mode so the generation panel can disable
  // Revise while unsaved edits exist (rule: persist human edits first).
  onEditingChange?: (editing: boolean) => void;
  /** One-ahead preview (UX2): no scratch form, no Edit/Approve. */
  previewLocked?: boolean;
  /** Persist honesty (PR-1) — see ConfirmationLetterTabProps. */
  saving?: boolean;
  saveError?: string | null;
  unsavedDraft?: MockChecklist | null;
  approveError?: string | null;
  staleNotice?: string | null;
  onDismissSaveError?: () => void;
}

function ChecklistTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false, saving = false, saveError = null, unsavedDraft = null, approveError = null, staleNotice = null, onDismissSaveError }: ChecklistTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [items, setItems] = useState<MockChecklistItem[]>(
    (unsavedDraft ?? deliverable)?.content.items ?? [],
  );

  // Same-id resync + failed-save force-edit — see useDeliverableResync.
  useDeliverableResync({
    deliverable,
    saveError,
    syncFromServer: () => {
      setEditing(!deliverable);
      setItems(deliverable?.content.items ?? []);
    },
    forceEdit: () => setEditing(true),
  });

  const save = () => {
    onChange({
      id: deliverable?.id ?? `ch-${Date.now()}`,
      audit_id: deliverable?.audit_id ?? '',
      content: { items },
      approval_status: 'DRAFT',
      approved_by_name: null,
      approved_at: null,
      updated_at: deliverable?.updated_at ?? new Date().toISOString(),
    });
    setEditing(false);
  };

  const approve = () => {
    if (!deliverable) return;
    onChange({
      ...deliverable,
      approval_status: 'APPROVED',
      approved_at: new Date().toISOString(),
      approved_by_name: 'You',
    });
  };

  const cancel = () => {
    onDismissSaveError?.();
    setItems(deliverable?.content.items ?? []);
    setEditing(false);
  };

  const addItem = () => {
    setItems((prev) => [
      ...prev,
      {
        id: `ci-${Date.now()}-${prev.length}`,
        prompt: '',
        checkpoint_ref: null,
        evidence_expected: false,
      },
    ]);
  };

  const updateItem = (id: string, patch: Partial<MockChecklistItem>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/[0.04]';
  const buttonGhost = isLight
    ? 'text-[#334155]/55 hover:text-red-600'
    : 'text-[#CBD5E1]/55 hover:text-red-400';

  return (
    <DeliverableShell
      kind="Checklist"
      objectType="CHECKLIST_OBJECT"
      description="The auditor's working checklist for the audit day. Each item: a prompt, optional SOP/section reference, and whether evidence is expected on the spot."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      prefilledSources={
        deliverable?.prefilled_at && deliverable.source_questionnaire_instance_id
          ? ['questionnaire evidence requests']
          : undefined
      }
      canSave={items.length > 0 && items.every((it) => it.prompt.trim())}
      previewLocked={previewLocked}
      saving={saving}
      saveError={saveError}
      approveError={approveError}
      staleNotice={staleNotice}
    >
      {previewLocked && !deliverable ? (
        <p className="text-fg-muted text-sm">Nothing recorded yet.</p>
      ) : !editing && deliverable && deliverable.content.items.length > 0 ? (
        <div className="space-y-2">
          {deliverable.content.items.map((it, idx) => (
            <div key={it.id} className={`${cardBg} border rounded-md px-3 py-2.5 flex items-start gap-3`}>
              <span className={`text-[11px] font-semibold ${mutedColor} w-5 flex-shrink-0`}>
                {idx + 1}.
              </span>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${headingColor}`}>{it.prompt}</p>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {it.checkpoint_ref && (
                    <span className={`text-[11px] font-mono ${subColor}`}>{it.checkpoint_ref}</span>
                  )}
                  {it.evidence_expected && (
                    <span
                      className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                        isLight
                          ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
                          : 'bg-brand-300/15 border-brand-300/30 text-brand-300'
                      }`}
                    >
                      Evidence expected
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : !editing && deliverable ? (
        <p className={`text-sm italic ${subColor}`}>No checklist items.</p>
      ) : (
        <div className="space-y-2">
          {items.length === 0 && (
            <p className={`text-sm italic ${subColor}`}>No checklist items yet. Add one below.</p>
          )}
          {items.map((it, idx) => (
            <div key={it.id} className={`${cardBg.replace('bg-white/[0.02]', 'bg-[#0F172A]')} border rounded-md p-3`}>
              <div className="flex items-start gap-2">
                <span className={`text-[11px] font-semibold ${mutedColor} w-5 flex-shrink-0 mt-2`}>
                  {idx + 1}.
                </span>
                <div className="flex-1 grid grid-cols-1 gap-2">
                  <textarea
                    value={it.prompt}
                    onChange={(e) => updateItem(it.id, { prompt: e.target.value })}
                    placeholder="Checklist prompt"
                    rows={2}
                    className={inputClass(isLight)}
                  />
                  <div className="grid grid-cols-1 sm:grid-cols-[1fr,auto] gap-2 items-center">
                    <input
                      type="text"
                      value={it.checkpoint_ref ?? ''}
                      onChange={(e) =>
                        updateItem(it.id, { checkpoint_ref: e.target.value || null })
                      }
                      placeholder="SOP / section reference (optional)"
                      className={inputClass(isLight)}
                    />
                    <label className={`flex items-center gap-2 text-xs ${headingColor}`}>
                      <input
                        type="checkbox"
                        checked={it.evidence_expected}
                        onChange={(e) =>
                          updateItem(it.id, { evidence_expected: e.target.checked })
                        }
                        className="rounded"
                      />
                      Evidence expected
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeItem(it.id)}
                  className={`flex-shrink-0 p-1.5 rounded-md ${buttonGhost}`}
                  aria-label="Remove checklist item"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addItem}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${
              isLight
                ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]'
            }`}
          >
            <Plus size={14} />
            Add checklist item
          </button>
        </div>
      )}
    </DeliverableShell>
  );
}

// ============================================================================
// Shared deliverable shell (header + actions)
// ============================================================================

interface DeliverableShellProps {
  kind: string;
  objectType: TrackedObjectType;
  description: string;
  deliverable: { id: string; approval_status: DeliverableApprovalStatus; approved_at: string | null; approved_by_name: string | null } | null;
  isLight: boolean;
  editing: boolean;
  onBeginEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onApprove: () => void;
  canSave: boolean;
  /** Human-readable provenance for this deliverable's pre-fill, e.g.
   *  ["risk summary focus areas", "vendor contact"]. When non-empty,
   *  renders a small Sparkles + "Started from: …" line below the
   *  description so the auditor can see where the content originated. */
  prefilledSources?: string[];
  /** One-ahead preview (UX2): hide Edit/Approve — approving from a preview
   *  would pre-flip the Stage 6 gate. History stays. */
  previewLocked?: boolean;
  /** Persist honesty (PR-1): a save in flight or a pending SAVE error blocks
   *  Approve — approving while cache and server may disagree is the CAS hole
   *  the persist flow's revert exists to prevent. NOTE: for saveError the
   *  PRIMARY enforcement is the tab's force-edit effect (editing hides this
   *  button entirely); the disabled attribute is a backstop, exercised only
   *  in the in-flight (`saving`) window. An approve error only banners:
   *  content is saved, so retrying approve is safe. */
  saving?: boolean;
  saveError?: string | null;
  approveError?: string | null;
  staleNotice?: string | null;
  children: React.ReactNode;
}

function DeliverableShell({
  kind,
  objectType,
  description,
  deliverable,
  isLight,
  editing,
  onBeginEdit,
  onSave,
  onCancel,
  onApprove,
  canSave,
  prefilledSources,
  previewLocked = false,
  saving = false,
  saveError = null,
  approveError = null,
  staleNotice = null,
  children,
}: DeliverableShellProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400';

  const approved = deliverable?.approval_status === 'APPROVED';

  return (
    <div className={`${cardBg} border rounded-xl p-5 space-y-4`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              {kind}
            </p>
            <StatusBadge
              status={deliverable?.approval_status ?? null}
              isLight={isLight}
            />
          </div>
          <p className={`${subColor} text-xs mt-1 leading-relaxed`}>{description}</p>
          {prefilledSources && prefilledSources.length > 0 && (
            <p
              data-testid="deliverable-prefill-chip"
              className={`${mutedColor} text-[11px] mt-1 inline-flex items-center gap-1`}
              title="Drafted from approved Stage 3 + Stage 4 context"
            >
              <Sparkles size={10} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
              Started from: {prefilledSources.join(' + ')}
            </p>
          )}
          {approved && deliverable?.approved_at && (
            <p className={`${mutedColor} text-[11px] mt-1`}>
              Approved {formatTimestamp(deliverable.approved_at)}
              {deliverable.approved_by_name ? ` · ${deliverable.approved_by_name}` : ''}
            </p>
          )}
        </div>
        {deliverable && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              title="View change history"
              aria-label={`Open change history for the ${kind.toLowerCase()}`}
            >
              <HistoryIcon size={12} />
              History
            </button>
            {!editing && !previewLocked && (
              <>
                <button
                  type="button"
                  onClick={onBeginEdit}
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                >
                  <Pencil size={12} />
                  {approved ? 'Revise' : 'Edit'}
                </button>
                {!approved && (
                  <button
                    type="button"
                    onClick={onApprove}
                    disabled={saving || !!saveError}
                    title={
                      saving
                        ? 'A save is in flight — approve once it lands'
                        : saveError
                        ? 'The last save failed — approve only attests to saved content'
                        : undefined
                    }
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonApprove}`}
                  >
                    <CheckCircle2 size={12} />
                    Approve
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {editing && approved && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
              : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
          }`}
        >
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">
            This deliverable is approved. Saving any change will revert it to Draft and require
            re-approval before this stage can advance.
          </p>
        </div>
      )}

      {saveError && (
        <div
          role="alert"
          data-testid="deliverable-persist-error"
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">{saveError}</p>
        </div>
      )}

      {/* No !saveError guards here: persistDeliverable clears all three
          channels on entry and sets at most one, so co-occurrence is
          structurally impossible — a guard would only imply otherwise. */}
      {approveError && (
        <div
          role="alert"
          data-testid="deliverable-approve-error"
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">{approveError}</p>
        </div>
      )}

      {staleNotice && (
        <div
          data-testid="deliverable-stale-notice"
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
              : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
          }`}
        >
          <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed">{staleNotice}</p>
        </div>
      )}

      <div>{children}</div>

      {editing && (
        <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave || saving}
            className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {/* Cancel also renders during a first-save failure (no row yet):
              it is the only way to discard the preserved draft and clear the
              error — without it that state has no exit. */}
          {(deliverable || saveError) && (
            <button
              type="button"
              onClick={onCancel}
              className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${buttonSecondary}`}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {historyOpen && deliverable && (
        <HistoryDrawer
          objectType={objectType}
          objectId={deliverable.id}
          title={kind}
          subTitle="Pre-audit drafting · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}

function StatusBadge({
  status,
  isLight,
}: {
  status: DeliverableApprovalStatus | null;
  isLight: boolean;
}) {
  if (status === 'APPROVED') {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
          isLight
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
        }`}
      >
        <CheckCircle2 size={10} />
        Approved
      </span>
    );
  }
  if (status === 'DRAFT') {
    return (
      <span
        className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
          isLight
            ? 'bg-amber-50 border-amber-200 text-amber-700'
            : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
        }`}
      >
        Draft
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${
        isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/55'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/45'
      }`}
    >
      Not started
    </span>
  );
}

// ============================================================================
// Form helpers
// ============================================================================

function FieldLabel({
  label,
  isLight: _isLight,
  children,
}: {
  label: string;
  isLight: boolean;
  children: React.ReactNode;
}) {
  const labelColor = 'text-fg-heading';
  return (
    <div>
      <label className={`block text-sm font-medium mb-1.5 ${labelColor}`}>{label}</label>
      {children}
    </div>
  );
}

function SubSection({
  label,
  isLight: _isLight,
  children,
}: {
  label: string;
  isLight: boolean;
  children: React.ReactNode;
}) {
  const sectionHeader = 'text-fg-label';
  return (
    <div>
      <p className={`text-[10px] uppercase tracking-wider font-semibold mb-1.5 ${sectionHeader}`}>
        {label}
      </p>
      {children}
    </div>
  );
}

function Chip({
  isLight,
  children,
}: {
  isLight: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center text-xs px-2 py-1 rounded border ${
        isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#0F172A]'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]'
      }`}
    >
      {children}
    </span>
  );
}

interface ChipListEditorProps {
  label: string;
  placeholder: string;
  items: string[];
  onChange: (next: string[]) => void;
  isLight: boolean;
  multiline?: boolean;
}

function ChipListEditor({ label, placeholder, items, onChange, isLight, multiline }: ChipListEditorProps) {
  const [draft, setDraft] = useState('');
  const labelColor = 'text-fg-heading';

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft('');
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <label className={`block text-sm font-medium mb-2 ${labelColor}`}>{label}</label>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {items.map((it, i) => (
            <span
              key={`${it}-${i}`}
              className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${
                isLight
                  ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#0F172A]'
                  : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]'
              }`}
            >
              {it}
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove"
                className={`flex-shrink-0 ${
                  isLight ? 'text-[#334155]/55 hover:text-red-600' : 'text-[#CBD5E1]/55 hover:text-red-400'
                }`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder={placeholder}
            className={`flex-1 ${inputClass(isLight)}`}
          />
        ) : (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className={`flex-1 ${inputClass(isLight)}`}
          />
        )}
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim()}
          className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
            isLight
              ? 'bg-brand-600 text-white hover:bg-brand-800'
              : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700'
          } disabled:opacity-50`}
        >
          <Plus size={12} />
          Add
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function inputClass(isLight: boolean): string {
  return `w-full rounded-md border px-2.5 py-1.5 text-sm ${
    isLight ? 'bg-white' : 'bg-[#0F172A]'
  } ${
    isLight
      ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
      : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30'
  } ${isLight ? 'text-[#0F172A]' : 'text-white'} focus:outline-none transition-colors`;
}

function textareaClass(isLight: boolean): string {
  return inputClass(isLight);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ============================================================================
// Stub generators
// ============================================================================

function createConfirmationStub(auditId: string): MockConfirmationLetter {
  return {
    id: `cl-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      body_text:
        'Stub draft generated from your approved risk summary and vendor service category. Edit the body, recipients, and scope below to fit this engagement. Sponsor branding is added externally on export.',
      recipients: [],
      scope: [],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
    updated_at: new Date().toISOString(),
  };
}

function createAgendaStub(auditId: string): MockAgenda {
  return {
    id: `ag-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      items: [
        {
          id: `ai-${Date.now()}-1`,
          time: 'Day 1 · 09:00 – 09:30',
          topic: 'Opening meeting',
          owner: 'Auditor + Vendor leadership',
          notes: null,
        },
        {
          id: `ai-${Date.now()}-2`,
          time: 'Day 1 · 09:30 – 12:00',
          topic: '[Edit] Topic from approved risk summary focus areas',
          owner: 'Vendor SME',
          notes: null,
        },
      ],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
    updated_at: new Date().toISOString(),
  };
}

function createChecklistStub(auditId: string): MockChecklist {
  return {
    id: `ch-${auditId}-${Date.now()}`,
    audit_id: auditId,
    content: {
      items: [
        {
          id: `ci-${Date.now()}-1`,
          prompt: '[Edit] Verification step from approved risk summary',
          checkpoint_ref: null,
          evidence_expected: true,
        },
      ],
    },
    approval_status: 'DRAFT',
    approved_by_name: null,
    approved_at: null,
    updated_at: new Date().toISOString(),
  };
}
