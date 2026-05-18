import { useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit } from '../../../context/AuditContext';
import type { AuditStage } from '../../../types/audit';
import { STAGE_LABELS, AUDIT_TYPE_LABELS, AUDIT_STATUS_LABELS } from '../../../lib/audit/labels';
import { ChevronDown, Sparkles, FileSearch, Plus } from 'lucide-react';
import StageNav from './StageNav';
import AuditRequiredGate from './AuditRequiredGate';
import RiskSummaryPanel from './RiskSummaryPanel';
import SourceTruthListDrawer from '../../sotr/SourceTruthListDrawer';
import NewAuditDrawer from './onboarding/NewAuditDrawer';
import AuditChatPanel from './AuditChatPanel';
import PiqcDock from './PiqcDock';
import type { AuditChatMessage } from '../../../lib/audit/chatApi';
import { fetchReportDraft, upsertReportDraft } from '../../../lib/audit/reportApi';
import { fetchPiqcThread, savePiqcThread } from '../../../lib/audit/piqcThreadApi';
import { usePiqcSignals } from '../../../hooks/usePiqcSignals';
import { AUDIT_STAGES } from '../../../types/audit';
import IntakeWorkspace from './stages/IntakeWorkspace';
import VendorEnrichmentWorkspace from './stages/VendorEnrichmentWorkspace';
import QuestionnaireReviewWorkspace from './stages/QuestionnaireReviewWorkspace';
import ScopeReviewWorkspace from './stages/ScopeReviewWorkspace';
import PreAuditDraftingWorkspace from './stages/PreAuditDraftingWorkspace';
import AuditConductWorkspace from './stages/AuditConductWorkspace';
import ReportDraftingWorkspace from './stages/ReportDraftingWorkspace';
import FinalReviewExportWorkspace from './stages/FinalReviewExportWorkspace';

// Dispatch table — viewedStage → component. Phase B replaces each entry's
// internals as that stage gets ported. The shell itself stays unchanged.
const STAGE_COMPONENTS: Record<AuditStage, React.ComponentType> = {
  INTAKE: IntakeWorkspace,
  VENDOR_ENRICHMENT: VendorEnrichmentWorkspace,
  QUESTIONNAIRE_REVIEW: QuestionnaireReviewWorkspace,
  SCOPE_AND_RISK_REVIEW: ScopeReviewWorkspace,
  PRE_AUDIT_DRAFTING: PreAuditDraftingWorkspace,
  AUDIT_CONDUCT: AuditConductWorkspace,
  REPORT_DRAFTING: ReportDraftingWorkspace,
  FINAL_REVIEW_EXPORT: FinalReviewExportWorkspace,
};

// =============================================================================
// AuditWorkspaceShell — 3-pane layout for Audit Mode.
//
//   Left   : StageNav (audit progress + navigation)
//   Center : per-stage workspace (placeholder in Phase A; real impls in Phase B)
//   Right  : RiskSummaryPanel (why this vendor matters)
//
// When no audit is selected, renders AuditRequiredGate as the full content.
//
// Internal state:
//   viewedStage — which stage the user is currently looking at. Defaults to
//   activeAudit.current_stage, but the user can navigate to any unlocked
//   stage via StageNav. This is separate from the audit's actual workflow
//   position — Phase B will add transition controls to advance current_stage.
// =============================================================================

export default function AuditWorkspaceShell() {
  const { theme } = useTheme();
  const { activeAudit, audits, setActiveAudit } = useAudit();
  const isLight = theme === 'light';

  // Reset viewedStage to the audit's current stage whenever the active audit changes.
  const [viewedStage, setViewedStage] = useState<AuditStage>(
    activeAudit?.current_stage ?? 'INTAKE',
  );
  // Mobile/tablet drawer for the risk summary panel (visible below xl).
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  // Cross-stage Protocol-source slide-over (SOTR). Available on every stage
  // because source verification can be needed during any audit decision.
  const [protocolSourceOpen, setProtocolSourceOpen] = useState(false);
  // New-audit drawer — reachable from the header on any stage so returning
  // auditors can start a new audit without leaving the workspace.
  const [newAuditOpen, setNewAuditOpen] = useState(false);
  const [pendingNewAuditId, setPendingNewAuditId] = useState<string | null>(null);
  // F-3: Audit-mode chat panel. Open/close is UI state; the thread itself
  // is owned by the shell so it survives drawer close while the same audit
  // stays active. Keyed per audit id — switching audits clears the prior
  // thread (see useEffect on activeAudit?.id below) to prevent context bleed.
  const [chatOpen, setChatOpen] = useState(false);
  const [chatThreads, setChatThreads] = useState<Record<string, AuditChatMessage[]>>({});
  // Transient acknowledgment that a PIQC chat write-back just landed text on
  // Stage 7. Surfaces as a dismissible inline note inside REPORT_DRAFTING so
  // the auditor's arrival on Stage 7 reads as ONE continuous PIQC moment
  // (chat → land → review), not two disconnected events (chat closed →
  // alone on Stage 7 with new text from nowhere).
  //
  // Lifecycle:
  //   - Set inside onAssistantWriteback after the upsert returns.
  //   - Cleared when the auditor dismisses the note, or when the active
  //     audit changes (see useEffect on activeAudit?.id), or when the
  //     auditor navigates away from REPORT_DRAFTING (see useEffect on
  //     viewedStage). Never persisted — pure UX cue.
  //
  // Single-entry: a second write-back before dismissal replaces the
  // previous notice. Both writes still land in the DB; only the most
  // recent gets the landing acknowledgment.
  const [pendingWritebackNotice, setPendingWritebackNotice] = useState<
    { field: 'executive_summary' | 'conclusions'; at: number } | null
  >(null);
  // Refresh token bumped on SOTR drawer close so PIQC's dock dot picks up
  // newly reviewed items without forcing a remount. Increment-only token;
  // identity matters, value doesn't.
  //
  // Pre-#77: an additional useWorksheetReviewCount fetch drove an amber
  // badge on the Protocol-source button. The badge duplicated PIQC's dock
  // signal (two amber surfaces, one fact), so the header badge + its
  // hook were retired (the hook is gone from the codebase entirely).
  // PIQC's usePiqcSignals fetches the SOTR count internally — single
  // fetch, one surface, no cognitive-load redundancy.
  const [reviewCountToken, setReviewCountToken] = useState(0);

  // PIQC ambient signals (v1: SOTR review queue + questionnaire-flagged
  // responses). Reuses reviewCountToken as the single "audit just changed"
  // refresh trigger.
  const piqcSignals = usePiqcSignals(
    activeAudit?.id ?? null,
    activeAudit?.protocol_id ?? null,
    reviewCountToken,
  );

  useEffect(() => {
    if (!pendingNewAuditId) return;
    const next = audits.find((a) => a.id === pendingNewAuditId);
    if (next) {
      setActiveAudit(next);
      setPendingNewAuditId(null);
    }
  }, [pendingNewAuditId, audits, setActiveAudit]);

  // Close the protocol-source drawer if the active audit changes mid-session.
  // Same boundary for the chat panel — and clear the per-audit thread for
  // any audit that is NOT currently active, so an auditor doesn't accumulate
  // stale threads in memory across a long session of switching audits. We
  // intentionally keep the active audit's thread (if any) untouched so a
  // mid-switch re-render doesn't drop work.
  useEffect(() => {
    setProtocolSourceOpen(false);
    setChatOpen(false);
    setChatThreads((prev) => {
      if (!activeAudit) return {};
      const keep = prev[activeAudit.id];
      return keep ? { [activeAudit.id]: keep } : {};
    });
    // Clear the landing notice on audit switch. It was scoped to the
    // previous audit's Stage 7 work; surfacing it on a different audit
    // would be a category error (the new audit didn't receive PIQC's
    // text). Never lives across audits.
    setPendingWritebackNotice(null);
  }, [activeAudit?.id]);

  // PIQC thread persistence (PR #83) — hydrate the panel from
  // `piqc_thread_messages` when an audit is activated, debounce-save
  // on changes.
  //
  // `activeAuditHydrated` is STATE (not a ref) because the panel
  // needs it as a prop to gate the empty-state primer + signals
  // block during the hydration window. Refs don't trigger re-renders;
  // a stale-prop pass would leave the panel forever in "unknown
  // hydration" state. State changes trigger one extra render per
  // audit switch — acceptable.
  //
  // `skipNextThreadSaveRef` stays a ref — it's a single-shot guard
  // used inside the save effect only; no render needs it.
  //
  // Reset-on-switch is critical: the cross-audit cleanup effect
  // above drops in-memory threads on switch, so we MUST re-fetch on
  // return; treating "hydrated" as session-wide would skip the
  // re-fetch and let a subsequent debounce-save write an empty
  // state over real persisted history (silent data loss).
  //
  // Merge-on-race: if the auditor manages to commit a turn during
  // the fetch window (rare but real), we merge — persisted history
  // first, their typed state after. Same doctrine as PR #82's no-
  // clobber: auditor work never gets silently overwritten by an
  // async PIQC operation.
  const [activeAuditHydrated, setActiveAuditHydrated] = useState(false);
  const skipNextThreadSaveRef  = useRef(false);
  useEffect(() => {
    setActiveAuditHydrated(false);
    if (!activeAudit) return;
    const auditId = activeAudit.id;

    // Already populated in-memory (e.g. same audit re-render). Treat
    // as already hydrated — the in-memory snapshot is fresher than
    // anything the DB has, so we don't re-fetch.
    const existing = chatThreads[auditId];
    if (existing && existing.length > 0) {
      setActiveAuditHydrated(true);
      return;
    }

    let cancelled = false;
    fetchPiqcThread(auditId).then((res) => {
      if (cancelled) return;
      // Silent-degrade on Result<T> error variant — treat as "no
      // prior thread." The fail() helper inside piqcThreadApi already
      // logged the cause; we just need to mark hydrated so saves can
      // resume.
      const msgs = res.ok ? res.data : [];
      setChatThreads((prev) => {
        const inMemory = prev[auditId] ?? [];
        if (inMemory.length > 0 && msgs.length > 0) {
          // Race: auditor sent a turn while we were fetching. Merge —
          // persisted history first, their new turn(s) after. The
          // save effect will fire shortly and persist the merged
          // state; don't skip-next-save (we want the merge written).
          return { ...prev, [auditId]: [...msgs, ...inMemory] };
        }
        if (msgs.length > 0) {
          // Pure hydration. The next save-effect run is the echo of
          // what we just fetched — skip it to avoid a wasted RPC.
          skipNextThreadSaveRef.current = true;
          return { ...prev, [auditId]: msgs };
        }
        // No persisted thread + no in-memory state. Nothing to apply.
        return prev;
      });
      setActiveAuditHydrated(true);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // chatThreads is read from closure intentionally — we only want to
    // check what's in memory at the moment of audit switch, not re-run
    // the fetch every time chatThreads mutates (the save effect handles
    // that downstream).
  }, [activeAudit?.id]);

  // Debounced thread save. Fires 750ms after the last change to the
  // active audit's thread; cleanup cancels in-flight timers so a fast
  // optimistic-then-final commit only produces ONE write (the final).
  // Gated on hydration so a pre-fetch send can't overwrite history.
  // All errors swallowed inside savePiqcThread — persistence failures
  // stay quiet (dev console + Supabase logs) and never surface as an
  // interrupting toast.
  useEffect(() => {
    if (!activeAudit) return;
    if (!activeAuditHydrated) return;
    if (skipNextThreadSaveRef.current) {
      skipNextThreadSaveRef.current = false;
      return;
    }
    const auditId = activeAudit.id;
    const messages = chatThreads[auditId] ?? [];
    const t = window.setTimeout(() => {
      savePiqcThread(auditId, messages);
    }, 750);
    return () => window.clearTimeout(t);
  }, [activeAudit?.id, chatThreads, activeAuditHydrated]);

  // Clear the landing notice when the auditor leaves REPORT_DRAFTING.
  // The notice's whole job is to bridge the chat → Stage 7 moment; once
  // the auditor has navigated away, the bridge is no longer relevant.
  // If they come back, the field is already saved (or in DRAFT) and the
  // source chip carries the provenance — they don't need a re-greeting.
  useEffect(() => {
    if (viewedStage !== 'REPORT_DRAFTING') setPendingWritebackNotice(null);
  }, [viewedStage]);

  // Snap the viewed stage to the audit's current_stage when the active audit
  // (or its workflow position) changes. We intentionally depend on the
  // primitive id/stage values rather than the full activeAudit object —
  // depending on the object would clobber the user's stage navigation any
  // time the parent re-rendered with a new reference.
  useEffect(() => {
    if (activeAudit) setViewedStage(activeAudit.current_stage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudit?.id, activeAudit?.current_stage]);

  if (!activeAudit) {
    return (
      <div className="flex-1 flex flex-col" style={{ minHeight: 0 }}>
        <AuditRequiredGate />
      </div>
    );
  }

  const headerBg = isLight
    ? 'bg-white border-[#e2e8ee]'
    : 'bg-[#131a22] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const chipBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';

  return (
    <div className="flex-1 flex" style={{ minHeight: 0 }}>
      <StageNav
        currentStage={activeAudit.current_stage}
        viewedStage={viewedStage}
        onSelectStage={setViewedStage}
      />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Audit context header — shows what audit + stage you're in */}
        <div className={`flex-shrink-0 border-b ${headerBg} px-4 sm:px-6 py-3`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-wider font-semibold ${chipBg}`}>
                  {STAGE_LABELS[viewedStage]}
                </span>
                {viewedStage !== activeAudit.current_stage && (
                  <span className={`text-[11px] ${mutedColor} hidden sm:inline`}>
                    Viewing earlier stage
                  </span>
                )}
              </div>
              <h2 className={`${headingColor} font-semibold text-base truncate`}>
                {activeAudit.audit_name}
              </h2>
              <p className={`${subColor} text-xs mt-0.5 truncate`}>
                {activeAudit.vendor_name} · {activeAudit.protocol_code}
                <span className="hidden sm:inline">
                  {' '}· {AUDIT_TYPE_LABELS[activeAudit.audit_type]} ·{' '}
                  {AUDIT_STATUS_LABELS[activeAudit.status]}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 self-start">
              {/* Mobile-only stage picker — replaces the StageNav rail below md: */}
              <MobileStagePicker
                currentStage={activeAudit.current_stage}
                viewedStage={viewedStage}
                onSelectStage={setViewedStage}
                isLight={isLight}
              />
              {/* Protocol source button — visible on every viewport.
                  The auditor needs source-of-truth verification across all
                  stages, not just where the right rail collapses.
                  The `disabled` branch is defensive — audits.protocol_id is
                  NOT NULL per schema (20260427120000_audit_mode_phase_1_schema),
                  so this state is unreachable today. Kept as cheap insurance
                  against future partial-fetch or data-migration failure modes;
                  do not refactor away without revisiting the schema constraint. */}
              <button
                type="button"
                onClick={() => setNewAuditOpen(true)}
                title="Start a new audit"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                  isLight
                    ? 'bg-white border-[#dce4ed] text-[#374152] hover:bg-[#f5f7fa]'
                    : 'bg-[#131a22] border-white/[0.08] text-[#d2d7e0] hover:bg-white/[0.04]'
                }`}
              >
                <Plus size={12} />
                New audit
              </button>
              {/* Protocol source — pure navigation affordance.
                  Previously carried an amber review-queue badge that
                  duplicated PIQC's dock dot (both surfaced the same SOTR
                  backlog signal). The badge was retired in PR #77 so PIQC
                  owns SOTR signaling exclusively — single intelligence
                  surface, no double-amber-affordance violation of the
                  cognitive-load doctrine.
                  The SOTR count now flows through usePiqcSignals (which
                  fetches the count itself) → dock dot + panel "Worth a
                  look:" + "Take me there →" shortcut. Hover tooltip kept
                  its always-on copy (no per-count branching) — hover is
                  not a visual conflict with the dock. */}
              <button
                type="button"
                onClick={() => setProtocolSourceOpen(true)}
                disabled={!activeAudit.protocol_id}
                title={
                  activeAudit.protocol_id
                    ? 'View what the parser extracted from the protocol PDF'
                    : 'No protocol associated with this audit'
                }
                data-testid="audit-protocol-source-button"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  isLight
                    ? 'bg-white border-[#dce4ed] text-[#374152] hover:bg-[#f5f7fa]'
                    : 'bg-[#131a22] border-white/[0.08] text-[#d2d7e0] hover:bg-white/[0.04]'
                }`}
              >
                <FileSearch size={12} />
                Protocol source
              </button>
              {/* PIQC is summoned from the PiqcDock (bottom-right). The old
                  header "Ask" button was deliberately removed in the rename +
                  skin pass: two summon paths = cognitive load violation, and
                  the dock is the more honest representation of PIQC's
                  on-shoulder presence. See PiqcDock for rationale. */}
              {/* Risk summary button — visible below xl where the right rail is hidden */}
              <button
                type="button"
                onClick={() => setSummaryDrawerOpen(true)}
                className={`xl:hidden inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                  isLight
                    ? 'bg-white border-[#dce4ed] text-[#374152] hover:bg-[#f5f7fa]'
                    : 'bg-[#131a22] border-white/[0.08] text-[#d2d7e0] hover:bg-white/[0.04]'
                }`}
              >
                <Sparkles size={12} />
                Risk summary
              </button>
            </div>
          </div>
        </div>

        {/* Stage workspace content — dispatched by viewedStage. Phase B fills
            in each stage component individually without touching the shell.
            Bottom padding (pb-20 ≈ 80px) reserves clearance for the PiqcDock
            at bottom-right so a stage workspace's final row(s) don't sit
            underneath the dock. Without this, dense stages (AuditConduct
            classification grid, ReportDrafting two-column editor) would
            force the auditor to scroll past the dock to read content. */}
        <div className="flex-1 overflow-y-auto pb-20" style={{ minHeight: 0 }}>
          {(() => {
            // REPORT_DRAFTING is specialized so the shell can hand it the
            // transient PIQC write-back landing notice. Every other stage
            // dispatches through the no-props record below. If a second
            // stage ever needs shell-injected state, hoist this into a
            // dedicated context rather than growing the if-ladder.
            if (viewedStage === 'REPORT_DRAFTING') {
              return (
                <ReportDraftingWorkspace
                  landingNotice={pendingWritebackNotice}
                  onDismissLandingNotice={() => setPendingWritebackNotice(null)}
                />
              );
            }
            const Workspace = STAGE_COMPONENTS[viewedStage];
            return <Workspace />;
          })()}
        </div>
      </main>

      <RiskSummaryPanel auditId={activeAudit.id} />

      {/* Mobile/tablet drawer variant — opens via the "Risk summary" header button */}
      {summaryDrawerOpen && (
        <RiskSummaryPanel
          auditId={activeAudit.id}
          variant="drawer"
          onClose={() => setSummaryDrawerOpen(false)}
        />
      )}

      {/* Cross-stage Protocol-source drawer — SOTR worksheet items for the
          audit's underlying protocol. Same drawer surface from every stage. */}
      {protocolSourceOpen && activeAudit.protocol_id && (
        <SourceTruthListDrawer
          studyId={activeAudit.protocol_id}
          studyCode={activeAudit.protocol_code || null}
          onClose={() => {
            setProtocolSourceOpen(false);
            // Refresh the shell badge in case the auditor reviewed items
            // during this drawer session.
            setReviewCountToken((n) => n + 1);
          }}
        />
      )}

      {/* PIQC dock — persistent bottom-right affordance. The shoulder.
          Hidden while the chat panel is open so it doesn't fight the
          slide-over animation. Always mounted otherwise — that's the
          point of an on-shoulder presence. */}
      <PiqcDock
        onOpen={() => setChatOpen(true)}
        hidden={chatOpen}
        hasSignals={piqcSignals.signals.length > 0}
      />

      {/* PIQC chat panel. Mount only while open so the backdrop + focus
          traps aren't in the DOM during normal stage work. Thread state
          is owned by the shell, keyed per audit id. */}
      {chatOpen && (
        <AuditChatPanel
          auditId={activeAudit.id}
          messages={chatThreads[activeAudit.id] ?? []}
          onMessagesChange={(next) =>
            setChatThreads((prev) => ({ ...prev, [activeAudit.id]: next }))
          }
          onClose={() => setChatOpen(false)}
          /* hydrated — true once `piqc_thread_messages` fetch has
             landed (or been skipped because in-memory was already
             populated). Suppresses the panel's empty-state primer +
             "Worth a look:" signals during the hydration window so
             a returning auditor doesn't see a flash of the wrong
             greeting before their thread snaps in. PR #83. */
          hydrated={activeAuditHydrated}
          /* viewedStage — what the auditor is LOOKING at, not necessarily the
             audit's workflow position. Lets PIQC bias relevance ("you're in
             Stage 6, here's what I'd look at next") even when the auditor
             revisits an earlier stage. */
          viewedStage={viewedStage}
          /* signals — surface in the empty state so opening the panel
             from a dot-on-dock answers "what did you notice?" immediately. */
          signals={piqcSignals.signals}
          /* onSignalAction — closes the panel + routes the auditor to the
             matching surface. Removes 4 manual steps (close panel → find
             header button → open drawer → review) into one click. This is
             the move from "smart notification" to "smart partner."
             Routing today:
               - sotr_awaiting_review  → open the Protocol-source drawer
               - questionnaire_flagged → navigate viewedStage to
                                         QUESTIONNAIRE_REVIEW
             A future signal kind needs a new branch here; if the routing
             grows past ~4 cases, hoist into a stage-resolver helper. */
          onSignalAction={(kind) => {
            setChatOpen(false);
            if (kind === 'sotr_awaiting_review') {
              setProtocolSourceOpen(true);
            } else if (kind === 'questionnaire_flagged') {
              setViewedStage('QUESTIONNAIRE_REVIEW');
            }
          }}
          /* Earned write-back (PR #78). The auditor opens an inline
             confirm on a PIQC reply ("Use in exec summary →"), confirms,
             and we land the text on Stage 7.

             Why refetch-or-bail before upsert: audit_mode_upsert_report_draft
             takes BOTH fields. Writing exec summary requires the current
             conclusions text to be preserved verbatim. Refetching here
             reads the freshest values from the DB; if it returns null
             (RLS denial / network blip), we throw rather than send a
             stale or empty conclusions field that would clobber the
             other field. Same pattern PR #69 + #72 used for auto-fire.

             Source flip: the destination field is tagged 'llm'; the
             other field's source is omitted (null), which the RPC
             treats as "preserve current value" per the migration's
             COALESCE-preserve rule.

             After the upsert returns, close the panel and navigate
             viewedStage to REPORT_DRAFTING. Stage 7 re-fetches on
             mount; the auditor sees PIQC's text in the textarea,
             reviews + edits + saves (flipping source to 'auditor_edited'
             per PR #72's contract on any text change). */
          onAssistantWriteback={async (kind, text) => {
            // Refetch is best-effort — null is a legitimate state when the
            // audit hasn't entered Stage 7 yet (no report_draft_objects row
            // exists). In that case we go through the RPC's INSERT path with
            // explicit 'templated' source on the OTHER field so its
            // provenance reads correctly: PIQC drafted exec summary; the
            // unwritten conclusions stays template-empty until someone
            // writes it. Without the explicit source, the RPC defaults to
            // 'auditor_edited' (per the INSERT-path COALESCE in
            // 20260516020000_audit_mode_conclusions_llm.sql) which would
            // mislabel an empty field as auditor work.
            const current = await fetchReportDraft(activeAudit.id);
            const reason = `Inserted from PIQC chat (${kind === 'executive_summary' ? 'exec summary' : 'conclusions'})`;
            const isFreshInsert = current === null;

            let result;
            if (kind === 'executive_summary') {
              result = await upsertReportDraft(
                activeAudit.id,
                text,
                current?.conclusions ?? '',
                reason,
                'llm',
                // Fresh insert → tag the empty conclusions as 'templated' so
                // its provenance is honest. Existing row → undefined preserves
                // whatever the conclusions source currently is.
                isFreshInsert ? 'templated' : undefined,
              );
            } else {
              result = await upsertReportDraft(
                activeAudit.id,
                current?.executive_summary ?? '',
                text,
                reason,
                isFreshInsert ? 'templated' : undefined,
                'llm',
              );
            }
            if (!result) {
              throw new Error(
                'Could not save to Stage 7. Try again, or copy the text manually.',
              );
            }
            // Set the landing-notice BEFORE flipping viewedStage so Stage 7's
            // mount sees the notice on first paint — no flash of "no notice"
            // followed by "notice appears." The notice is keyed to (field, at)
            // so two writes to the same field still re-trigger a fresh
            // acknowledgment (Date.now identity).
            setPendingWritebackNotice({ field: kind, at: Date.now() });
            setChatOpen(false);
            setViewedStage('REPORT_DRAFTING');
          }}
        />
      )}

      {/* New-audit drawer — reachable from the header on every stage so a
          returning auditor can start a fresh audit without backing out of the
          active one. */}
      {newAuditOpen && (
        <NewAuditDrawer
          onClose={() => setNewAuditOpen(false)}
          onCreated={(newAuditId) => {
            setPendingNewAuditId(newAuditId);
            setNewAuditOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// MobileStagePicker — replaces the StageNav rail below md:.
// ============================================================================
interface MobileStagePickerProps {
  currentStage: AuditStage;
  viewedStage: AuditStage;
  onSelectStage: (s: AuditStage) => void;
  isLight: boolean;
}

function MobileStagePicker({
  currentStage,
  viewedStage,
  onSelectStage,
  isLight,
}: MobileStagePickerProps) {
  const currentIdx = AUDIT_STAGES.indexOf(currentStage);

  return (
    <div className="md:hidden flex-shrink-0 self-start relative">
      <select
        value={viewedStage}
        onChange={(e) => onSelectStage(e.target.value as AuditStage)}
        aria-label="Audit stage"
        className={`appearance-none text-xs font-semibold pl-3 pr-8 py-1.5 rounded-md border transition-colors cursor-pointer ${
          isLight
            ? 'bg-white border-[#dce4ed] text-[#374152] hover:bg-[#f5f7fa]'
            : 'bg-[#131a22] border-white/[0.08] text-[#d2d7e0] hover:bg-white/[0.04]'
        }`}
      >
        {AUDIT_STAGES.map((s, idx) => {
          // Mirror StageNav locking: anything > current+1 is unreachable.
          const locked = idx > currentIdx + 1;
          return (
            <option key={s} value={s} disabled={locked}>
              {idx + 1}. {STAGE_LABELS[s]}
              {locked ? ' 🔒' : idx === currentIdx ? ' ← current' : ''}
            </option>
          );
        })}
      </select>
      <ChevronDown
        size={12}
        className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 ${
          isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45'
        }`}
      />
    </div>
  );
}
