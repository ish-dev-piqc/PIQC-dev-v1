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
  prefillStage5Deliverables,
  type DeliverableApproveResult,
} from '../../../../lib/audit/preAuditApi';
import type { DeliverableApprovalStatus, TrackedObjectType } from '../../../../types/audit';
import { listAuditEvidence } from '../../../../lib/audit/evidenceApi';
import {
  applyDeliverableGeneration,
  computeDeliverableCurrency,
  requestDeliverableDraft,
} from '../../../../lib/audit/deliverableGenerationApi';
import type { AuditEvidenceListRow } from '../../../../types/audit';
import { useOpenEvidence } from '../evidenceDrawerContext';
import { hasReachedStage } from '../../../../lib/audit/workflowStages';
import HistoryDrawer from '../HistoryDrawer';
import PrefillAgentNote from '../PrefillAgentNote';
import StagePreviewNotice from '../StagePreviewNotice';

// =============================================================================
// PreAuditDraftingWorkspace — PRE_AUDIT_DRAFTING stage center pane.
//
// Four tabs sharing the Revise / Save / Cancel / Approve pattern:
//   - Confirmation Letter      (sent to vendor)
//   - Agenda                   (multi-item audit plan)
//   - Checklist                (auditor's working checklist)
//   - Internal Notification    (internal heads-up inviting scope input — PR-D1)
//
// All follow the D-010 step 7 lifecycle:
//   - DRAFT until explicitly Approved
//   - Editing an APPROVED deliverable demotes it to DRAFT (re-approval needed)
//   - When letter + agenda + checklist are APPROVED, AUDIT_CONDUCT unlocks.
//     The internal notification NEVER gates advance (v8 rule) — its approval
//     is its own latch only.
// =============================================================================

type TabKey = 'confirmation_letter' | 'agenda' | 'checklist' | 'internal_notification';

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

  // Grounded deliverable generation (PR-C1 checklist, PR-C2 all three).
  // Human-triggered only — the Q&A consciously rejected auto-regenerate.
  // Proposals land as DRAFT through the apply RPCs (demote latch intact),
  // then the bundle refetches server truth.
  const [generatingTab, setGeneratingTab] = useState<TabKey | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);
  // Revise-with-AI must never fire over unsaved tab edits (persist human
  // edits first): while a tab is in edit mode, its generate button is
  // disabled — the button state IS the rule's enforcement.
  const [editingTabs, setEditingTabs] = useState<Partial<Record<TabKey, boolean>>>({});
  const setTabEditing = (tab: TabKey, editing: boolean) =>
    setEditingTabs((prev) => ({ ...prev, [tab]: editing }));

  // A generation error belongs to the tab it happened on.
  useEffect(() => {
    setGenerationError(null);
  }, [activeTab]);

  // Tracks audits whose prefill RPCs have already been attempted in this
  // session, so opening Stage 5 / switching tabs / re-rendering doesn't fire
  // the RPCs repeatedly. Server-side has 23505 guards too — this is purely a
  // network-noise optimisation.
  const attemptedPrefillRef = useRef<Set<string>>(new Set());

  // Notification-first escape hatch: the guided stub screen (below) renders
  // when nothing is drafted, but the internal notification has no stub — this
  // flag lets the auditor skip straight to its tab without creating three
  // unwanted stub rows first.
  const [notificationFirst, setNotificationFirst] = useState(false);

  useEffect(() => {
    setActiveTab('confirmation_letter');
    setNotificationFirst(false);
  }, [activeAudit?.id]);

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

        // Silent agentic bootstrap: if all three deliverables are missing AND
        // we haven't attempted prefill yet for this audit this session, fire
        // the prefill RPCs in parallel. They server-side-gate on approved
        // Stage 3 + 4 sources and skip silently when not met.
        const allMissing =
          !initial.confirmation_letter && !initial.agenda && !initial.checklist;

        if (allMissing && hasReached && !attemptedPrefillRef.current.has(auditIdLocal)) {
          attemptedPrefillRef.current.add(auditIdLocal);
          await prefillStage5Deliverables(auditIdLocal);
          const refreshed = await fetchPreAuditDeliverables(auditIdLocal);
          if (cancelled) return;
          setBundles((prev) => ({ ...prev, [auditIdLocal]: refreshed }));
        } else {
          setBundles((prev) => ({ ...prev, [auditIdLocal]: initial }));
        }
      } catch (err) {
        console.error('[PreAuditDraftingWorkspace] Load error:', err);
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

  const auditId = activeAudit.id;
  const bundle: MockPreAuditBundle = bundles[auditId] ?? EMPTY_BUNDLE;

  // ---------------------------------------------------------------------------
  // Mutations
  //
  // Each tab calls onChange(next | null). We diff against the current bundle
  // to figure out: was content edited? was approval transitioned?
  // Then call the right RPC. Optimistic update, revert on failure.
  // ---------------------------------------------------------------------------

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

  const runDeliverableGeneration = async (tab: TabKey) => {
    if (!hasReached) return; // preview — never spend generation from ahead
    setGeneratingTab(tab);
    setGenerationError(null);
    const draft = await requestDeliverableDraft(auditId, tab);
    if (!draft.ok) {
      setGenerationError(draft.error);
      setGeneratingTab(null);
      return;
    }
    // Letter: generation never sees recipients — merge the current ones here.
    const applied = await applyDeliverableGeneration(auditId, draft.data, {
      currentRecipients: bundle.confirmation_letter?.content.recipients ?? [],
    });
    if (!applied.ok) {
      setGenerationError(applied.error);
      setGeneratingTab(null);
      return;
    }
    // Refetch server truth — one mapper, one read path.
    const fresh = await fetchPreAuditDeliverables(auditId);
    setBundles((prev) => ({ ...prev, [auditId]: fresh }));
    setGeneratingTab(null);
  };

  // Approve rejected by the server's compare-and-swap (STALE_CONTENT): the
  // deliverable changed since this tab rendered it. Reload server truth so
  // the reviewer looks at the current text — invitational, not an alarm.
  const reloadAfterStaleApprove = async (scope: string, error: string) => {
    console.error(`[PreAuditDraftingWorkspace] ${scope} rejected:`, error);
    const fresh = await fetchPreAuditDeliverables(auditId);
    setBundles((prevBundles) => ({ ...prevBundles, [auditId]: fresh }));
  };

  // One persist flow for all four deliverables (the 4th copy was the
  // rule-of-three moment). Approval transitions CAS on the row version the
  // reviewer saw — the latch attests to exactly the content they reviewed.
  // An upsert that FAILS (null; the API layer already logged it) REVERTS the
  // optimistic row: the UI must never show unsaved content as saved, because
  // a later Approve would CAS-pass against the unchanged server row and latch
  // content the reviewer never wrote.
  // T ranges over the bundle's member types so the field writes below
  // type-check without casts; every member carries the id/approval_status/
  // updated_at the flow relies on.
  async function persistDeliverable<
    T extends NonNullable<MockPreAuditBundle[keyof MockPreAuditBundle]>,
  >(
    key: keyof MockPreAuditBundle,
    noun: string,
    prev: T | null,
    next: T | null,
    ops: {
      upsert: (n: T) => Promise<T | null>;
      approve: (p: T) => Promise<DeliverableApproveResult<T>>;
    },
  ): Promise<void> {
    if (!next) return;
    try {
      const isApprovalTransition =
        !!prev &&
        prev.approval_status !== 'APPROVED' &&
        next.approval_status === 'APPROVED';

      if (prev && isApprovalTransition) {
        const result = await ops.approve(prev);
        if (result.ok) {
          setBundleField(key, result.data);
        } else {
          await reloadAfterStaleApprove(`approve${noun}`, result.error);
        }
        return;
      }

      const persisted = await ops.upsert(next);
      setBundleField(key, persisted ?? prev);
    } catch (err) {
      console.error(`[PreAuditDraftingWorkspace] persist${noun} error:`, err);
      setBundleField(key, prev);
    }
  }

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

  const generateAllStubs = async () => {
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
      setBundles((prev) => ({
        ...prev,
        [auditId]: {
          ...(prev[auditId] ?? EMPTY_BUNDLE),
          confirmation_letter: letter ?? stubs.confirmation_letter,
          agenda: agenda ?? stubs.agenda,
          checklist: checklist ?? stubs.checklist,
        },
      }));
    } catch (err) {
      console.error('[PreAuditDraftingWorkspace] generateAllStubs error:', err);
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
  // Empty state — nothing drafted yet. The notification is part of the check
  // so an existing notification row is never hidden behind the stub screen
  // (data on the server must always render); trioMissing separately drives
  // the in-tab stub affordance below, so the one-click bootstrap stays
  // reachable when the tabs render with the gating trio still unstarted.
  // ---------------------------------------------------------------------------
  const trioMissing = !bundle.confirmation_letter && !bundle.agenda && !bundle.checklist;
  const allMissing = trioMissing && !bundle.internal_notification;

  if (allMissing && !notificationFirst) {
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
          The pre-audit deliverables — confirmation letter, agenda, checklist, and an
          optional internal notification — are drafted here from your approved risk summary
          and vendor service mappings. Stubs start the three gating deliverables; the
          internal notification has no stub and is drafted from its own tab.
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
                setNotificationFirst(true);
                setActiveTab('internal_notification');
              }}
              className={`${subColor} text-sm font-medium underline underline-offset-2 hover:opacity-80`}
            >
              Start with the internal notification instead
            </button>
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
  };
  // Derived from the SAME gating flags that render the gate checklist, so the
  // advance button and the list can never disagree about membership. The
  // internal notification (gating: false) never feeds this.
  const allApproved = GATING_TAB_DEFS.every((t) => approvalStatuses[t.key] === 'APPROVED');

  const alreadyAdvanced = ['AUDIT_CONDUCT', 'REPORT_DRAFTING', 'FINAL_REVIEW_EXPORT'].includes(
    activeAudit.current_stage,
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
          Four deliverables share this stage. The confirmation letter, agenda, and checklist
          must be Approved before audit conduct unlocks; the internal notification is
          optional and never blocks. Editing an Approved deliverable reverts it to Draft.
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

      {/* Active tab content */}
      {activeTab === 'confirmation_letter' && (
        <>
          <DeliverableGenerationPanel
            kind="confirmation_letter"
            deliverable={bundle.confirmation_letter}
            evidenceRows={evidenceRows}
            generating={generatingTab === 'confirmation_letter'}
            editing={editingTabs['confirmation_letter'] === true}
            error={generationError}
            isLight={isLight}
            previewLocked={!hasReached}
            onGenerate={() => void runDeliverableGeneration('confirmation_letter')}
          />
          <ConfirmationLetterTab
            deliverable={bundle.confirmation_letter}
            isLight={isLight}
            onChange={(next) => {
              setBundleField('confirmation_letter', next);
              persistConfirmationLetter(bundle.confirmation_letter, next);
            }}
            onEditingChange={(e) => setTabEditing('confirmation_letter', e)}
            previewLocked={!hasReached}
          />
        </>
      )}
      {activeTab === 'agenda' && (
        <>
          <DeliverableGenerationPanel
            kind="agenda"
            deliverable={bundle.agenda}
            evidenceRows={evidenceRows}
            generating={generatingTab === 'agenda'}
            editing={editingTabs['agenda'] === true}
            error={generationError}
            isLight={isLight}
            previewLocked={!hasReached}
            onGenerate={() => void runDeliverableGeneration('agenda')}
          />
          <AgendaTab
            deliverable={bundle.agenda}
            isLight={isLight}
            onChange={(next) => {
              setBundleField('agenda', next);
              persistAgenda(bundle.agenda, next);
            }}
            onEditingChange={(e) => setTabEditing('agenda', e)}
            previewLocked={!hasReached}
          />
        </>
      )}
      {activeTab === 'checklist' && (
        <>
          <DeliverableGenerationPanel
            kind="checklist"
            deliverable={bundle.checklist}
            evidenceRows={evidenceRows}
            generating={generatingTab === 'checklist'}
            editing={editingTabs['checklist'] === true}
            error={generationError}
            isLight={isLight}
            previewLocked={!hasReached}
            onGenerate={() => void runDeliverableGeneration('checklist')}
          />
          <ChecklistTab
            deliverable={bundle.checklist}
            isLight={isLight}
            onChange={(next) => {
              setBundleField('checklist', next);
              persistChecklist(bundle.checklist, next);
            }}
            onEditingChange={(e) => setTabEditing('checklist', e)}
            previewLocked={!hasReached}
          />
        </>
      )}
      {activeTab === 'internal_notification' && (
        <>
          <DeliverableGenerationPanel
            kind="internal_notification"
            deliverable={bundle.internal_notification}
            evidenceRows={evidenceRows}
            generating={generatingTab === 'internal_notification'}
            editing={editingTabs['internal_notification'] === true}
            error={generationError}
            isLight={isLight}
            previewLocked={!hasReached}
            onGenerate={() => void runDeliverableGeneration('internal_notification')}
          />
          <InternalNotificationTab
            deliverable={bundle.internal_notification}
            isLight={isLight}
            onChange={(next) => {
              setBundleField('internal_notification', next);
              persistInternalNotification(bundle.internal_notification, next);
            }}
            onEditingChange={(e) => setTabEditing('internal_notification', e)}
            previewLocked={!hasReached}
          />
        </>
      )}

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
                        {s === 'APPROVED' ? 'approved' : s === 'DRAFT' ? 'draft' : 'not started'}
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
}

function ConfirmationLetterTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false }: ConfirmationLetterTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [body, setBody] = useState(deliverable?.content.body_text ?? '');
  const [recipients, setRecipients] = useState<string[]>(
    deliverable?.content.recipients ?? [],
  );
  const [scope, setScope] = useState<string[]>(deliverable?.content.scope ?? []);

  // updated_at in the deps: grounded generation mutates this row under the
  // SAME id (see ChecklistTab for the full rationale). The workspace disables
  // Draft/Revise while editing, so this resync never fires over unsaved edits.
  useEffect(() => {
    setEditing(!deliverable);
    setBody(deliverable?.content.body_text ?? '');
    setRecipients(deliverable?.content.recipients ?? []);
    setScope(deliverable?.content.scope ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id, deliverable?.updated_at]);

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
// Internal notification tab (PR-D1) — letter-shaped, deliberately without a
// recipients editor: internal distribution happens outside PIQC, and
// roles-only body text keeps the deliverable name-free end to end.
// ============================================================================

interface InternalNotificationTabProps {
  deliverable: MockInternalNotification | null;
  isLight: boolean;
  onChange: (next: MockInternalNotification | null) => void;
  // Reports the tab's edit mode so the generation panel can disable
  // Revise while unsaved edits exist (rule: persist human edits first).
  onEditingChange?: (editing: boolean) => void;
  /** One-ahead preview (UX2): no scratch form, no Edit/Approve. */
  previewLocked?: boolean;
}

function InternalNotificationTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false }: InternalNotificationTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [body, setBody] = useState(deliverable?.content.body_text ?? '');
  const [scope, setScope] = useState<string[]>(deliverable?.content.scope ?? []);

  // updated_at in the deps: grounded generation mutates this row under the
  // SAME id (see ChecklistTab for the full rationale). The workspace disables
  // Draft/Revise while editing, so this resync never fires over unsaved edits.
  useEffect(() => {
    setEditing(!deliverable);
    setBody(deliverable?.content.body_text ?? '');
    setScope(deliverable?.content.scope ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id, deliverable?.updated_at]);

  const save = () => {
    onChange({
      id: deliverable?.id ?? `in-${Date.now()}`,
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
    setBody(deliverable?.content.body_text ?? '');
    setScope(deliverable?.content.scope ?? []);
    setEditing(false);
  };

  return (
    <DeliverableShell
      kind="Internal notification"
      objectType="INTERNAL_NOTIFICATION_OBJECT"
      description="Circulated inside your organization to announce the audit and invite scope input before the opening meeting. Optional — approving it is never required to advance. Address roles, not names; distribution happens outside PIQC."
      deliverable={deliverable}
      isLight={isLight}
      editing={editing}
      onBeginEdit={() => setEditing(true)}
      onSave={save}
      onCancel={cancel}
      onApprove={approve}
      canSave={!!body.trim()}
      previewLocked={previewLocked}
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
              placeholder="Announce the audit to internal stakeholders and invite scope input before the opening meeting. Address roles, not names."
              className={textareaClass(isLight)}
            />
          </FieldLabel>
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
}

function AgendaTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false }: AgendaTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [items, setItems] = useState<MockAgendaItem[]>(
    deliverable?.content.items ?? [],
  );

  // updated_at in the deps — same same-id resync rationale as ChecklistTab.
  useEffect(() => {
    setEditing(!deliverable);
    setItems(deliverable?.content.items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id, deliverable?.updated_at]);

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
}

// ============================================================================
// DeliverableGenerationPanel — grounded drafting controls + currency notice
// (PR-C1 checklist, PR-C2 all three). Renders above each tab. Three states:
//   never generated  → "Draft with PIQC" CTA (grounds in protocol + register)
//   generated, current → quiet provenance line + Revise with AI
//   generated, drifted → non-dismissable amber currency notice naming the
//                        new/removed sources + Revise with AI. Flag, never
//                        block: the auditor can approve and export regardless.
// ============================================================================
const PANEL_NOUNS: Record<TabKey, string> = {
  confirmation_letter: 'confirmation letter',
  agenda: 'agenda',
  checklist: 'checklist',
  internal_notification: 'internal notification',
};

interface DeliverableGenerationPanelProps {
  kind: TabKey;
  deliverable: MockConfirmationLetter | MockAgenda | MockChecklist | MockInternalNotification | null;
  evidenceRows: AuditEvidenceListRow[] | null;
  generating: boolean;
  editing: boolean;
  error: string | null;
  isLight: boolean;
  /** One-ahead preview (UX2): the CTA disables honestly instead of the
   *  click dying silently against runDeliverableGeneration's guard. */
  previewLocked?: boolean;
  onGenerate: () => void;
}

function DeliverableGenerationPanel({
  kind,
  deliverable,
  evidenceRows,
  generating,
  editing,
  error,
  isLight,
  previewLocked = false,
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
    : computeDeliverableCurrency(deliverable?.grounding_snapshot, evidenceRows);
  const refCount = deliverable?.generation_refs?.length ?? 0;
  const isApproved = deliverable?.approval_status === 'APPROVED';
  const evidenceCount = evidenceRows?.length ?? 0;

  const buttonLabel = generating
    ? hasGeneration ? 'Revising…' : 'Drafting…'
    : hasGeneration ? 'Revise with AI' : 'Draft with PIQC';

  const noun = PANEL_NOUNS[kind];

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
              {' '}from the protocol and{' '}
              {deliverable?.grounding_snapshot?.evidence.length ?? 0} evidence source
              {(deliverable?.grounding_snapshot?.evidence.length ?? 0) === 1 ? '' : 's'}
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
          {kind === 'confirmation_letter' && (
            <p className={`${subColor} text-[11px] mt-1`}>
              Recipients are never sent to the model — they stay exactly as you set them.
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
          disabled={generating || (editing && !!deliverable) || previewLocked}
          onClick={onGenerate}
          title={
            previewLocked
              ? 'Available when the audit reaches this stage'
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
          <span className="font-semibold">The evidence register has changed since this draft.</span>{' '}
          {currency.newSinceGeneration.length > 0 && (
            <>New: {currency.newSinceGeneration.map((d) => d.title).join(', ')}. </>
          )}
          {currency.removedSinceGeneration.length > 0 && (
            <>Removed: {currency.removedSinceGeneration.map((d) => d.title).join(', ')}. </>
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

function ChecklistTab({ deliverable, isLight, onChange, onEditingChange, previewLocked = false }: ChecklistTabProps) {
  const [editing, setEditingRaw] = useState(!deliverable);
  const setEditing = (next: boolean) => {
    setEditingRaw(next);
    onEditingChange?.(next);
  };
  const [items, setItems] = useState<MockChecklistItem[]>(
    deliverable?.content.items ?? [],
  );

  // updated_at in the deps: grounded generation (PR-C1) mutates this row
  // under the SAME id, so keying on id alone would leave stale local items —
  // clicking Edit after a generation would show (and then Save would clobber
  // it with) pre-generation content. The workspace disables Generate/Revise
  // while editing, so this resync can never fire over unsaved edits.
  useEffect(() => {
    setEditing(!deliverable);
    setItems(deliverable?.content.items ?? []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deliverable?.id, deliverable?.updated_at]);

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
                    className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
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

      <div>{children}</div>

      {editing && (
        <div className={`flex items-center gap-2 pt-3 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'}`}>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
          >
            Save
          </button>
          {deliverable && (
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
