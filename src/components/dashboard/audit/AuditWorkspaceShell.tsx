import { useEffect, useState } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit } from '../../../context/AuditContext';
import type { AuditStage, AuditWorkflowType } from '../../../types/audit';
import { STAGE_LABELS, AUDIT_TYPE_LABELS, AUDIT_STATUS_LABELS } from '../../../lib/audit/labels';
import { ChevronDown, Sparkles, FileSearch, Plus, GitBranch, AlertOctagon } from 'lucide-react';
import StageNav from './StageNav';
import AuditRequiredGate from './AuditRequiredGate';
import RiskSummaryPanel from './RiskSummaryPanel';
import SourceTruthListDrawer from '../../sotr/SourceTruthListDrawer';
import NewAuditDrawer from './onboarding/NewAuditDrawer';
import TraceabilityDrawer from './TraceabilityDrawer';
import IssuesCapaDrawer from './IssuesCapaDrawer';
import AuditChatPanel from './AuditChatPanel';
import PiqcDock from './PiqcDock';
import type { AuditChatMessage } from '../../../lib/audit/chatApi';
import { fetchReportDraft, upsertReportDraft } from '../../../lib/audit/reportApi';
import { usePiqcSignals } from '../../../hooks/usePiqcSignals';
import { stagesForWorkflow } from '../../../lib/audit/workflowStages';
import IntakeWorkspace from './stages/IntakeWorkspace';
import VendorEnrichmentWorkspace from './stages/VendorEnrichmentWorkspace';
import QuestionnaireReviewWorkspace from './stages/QuestionnaireReviewWorkspace';
import ScopeReviewWorkspace from './stages/ScopeReviewWorkspace';
import PreAuditDraftingWorkspace from './stages/PreAuditDraftingWorkspace';
import AuditConductWorkspace from './stages/AuditConductWorkspace';
import ReportDraftingWorkspace from './stages/ReportDraftingWorkspace';
import FinalReviewExportWorkspace from './stages/FinalReviewExportWorkspace';
import SiteIntakeWorkspace from './stages/investigator/SiteIntakeWorkspace';
import IsaStagePlaceholder from './stages/investigator/IsaStagePlaceholder';

// Dispatch table — (workflow_type, viewedStage) → component. Keying by workflow
// keeps vendor and investigator stage sets isolated: an ISA_* stage never
// resolves to a vendor component and vice versa. Investigator stages without a
// real workspace yet fall through to IsaStagePlaceholder (see the render below).
const STAGE_COMPONENTS: Record<
  AuditWorkflowType,
  Partial<Record<AuditStage, React.ComponentType>>
> = {
  VENDOR_AUDIT: {
    INTAKE: IntakeWorkspace,
    VENDOR_ENRICHMENT: VendorEnrichmentWorkspace,
    QUESTIONNAIRE_REVIEW: QuestionnaireReviewWorkspace,
    SCOPE_AND_RISK_REVIEW: ScopeReviewWorkspace,
    PRE_AUDIT_DRAFTING: PreAuditDraftingWorkspace,
    AUDIT_CONDUCT: AuditConductWorkspace,
    REPORT_DRAFTING: ReportDraftingWorkspace,
    FINAL_REVIEW_EXPORT: FinalReviewExportWorkspace,
  },
  INVESTIGATOR_SITE_AUDIT: {
    ISA_SITE_INTAKE: SiteIntakeWorkspace,
    // ISA_RISK_ASSESSMENT … ISA_EXPORT ship in later phases → placeholder.
  },
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
  // Traceability slide-over — the audit's seed→tree lineage. Cross-stage for
  // the same reason: provenance questions arise during any audit decision.
  const [traceabilityOpen, setTraceabilityOpen] = useState(false);
  // Issues & CAPA slide-over — triage findings into issues, draft each CAPA
  // through review to export. Cross-stage: issues surface during conduct
  // (Stage 6) but CAPAs are accepted/exported around Stages 7–8.
  const [issuesCapaOpen, setIssuesCapaOpen] = useState(false);
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
    setTraceabilityOpen(false);
    setIssuesCapaOpen(false);
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

  // Stage set is a function of the audit's workflow, not a global constant.
  // VENDOR_AUDIT resolves to the canonical 8 stages (behavior-preserving).
  const stages = stagesForWorkflow(activeAudit.workflow_type);

  const headerBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#0F172A] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const chipBg = isLight
    ? 'bg-brand-600/10 border-brand-600/20 text-brand-600'
    : 'bg-brand-600/15 border-brand-600/30 text-brand-300';

  return (
    <div className="flex-1 flex" style={{ minHeight: 0 }}>
      <StageNav
        stages={stages}
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
                {activeAudit.auditee_name} · {activeAudit.protocol_code}
                <span className="hidden sm:inline">
                  {' '}· {AUDIT_TYPE_LABELS[activeAudit.audit_type]} ·{' '}
                  {AUDIT_STATUS_LABELS[activeAudit.status]}
                </span>
              </p>
            </div>
            {/* flex-wrap: five labeled buttons overflow below md — wrapping
                beats clipping and keeps every label legible. This row is at
                its ceiling; grouping the record surfaces (Protocol source /
                Traceability / Issues & CAPA) is flagged decision-debt in
                plans/sixonelabs-piqc/audit-issue-capa.md. */}
            <div className="flex items-center gap-2 flex-wrap justify-end flex-shrink-0 self-start">
              {/* Mobile-only stage picker — replaces the StageNav rail below md: */}
              <MobileStagePicker
                stages={stages}
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
                    ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
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
                    ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                <FileSearch size={12} />
                Protocol source
              </button>
              {/* Traceability — the audit's seed→tree lineage. Read-only
                  provenance surface; peer of Protocol source (both answer
                  "where did this come from?" — source text vs record lineage). */}
              <button
                type="button"
                onClick={() => setTraceabilityOpen(true)}
                title="Trace every record in this audit back to its seed"
                data-testid="audit-traceability-button"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                  isLight
                    ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                <GitBranch size={12} />
                Traceability
              </button>
              {/* Issues & CAPA — the finding → issue → CAPA triage loop.
                  Draft-only surface: Accepted = ready to export; formal
                  finalization happens in the QMS. */}
              <button
                type="button"
                onClick={() => setIssuesCapaOpen(true)}
                title="Triage findings into issues and draft CAPAs for review"
                data-testid="audit-issues-capa-button"
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                  isLight
                    ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                    : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                }`}
              >
                <AlertOctagon size={12} />
                Issues &amp; CAPA
              </button>
              {/* PIQC is summoned from the PiqcDock (bottom-right). The old
                  header "Ask" button was deliberately removed in the rename +
                  skin pass: two summon paths = cognitive load violation, and
                  the dock is the more honest representation of PIQC's
                  on-shoulder presence. See PiqcDock for rationale. */}
              {/* Risk summary button — visible below xl where the right rail is
                  hidden. Vendor-workflow-only, like the rail it opens. */}
              {activeAudit.workflow_type === 'VENDOR_AUDIT' && (
                <button
                  type="button"
                  onClick={() => setSummaryDrawerOpen(true)}
                  className={`xl:hidden inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                    isLight
                      ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                      : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                  }`}
                >
                  <Sparkles size={12} />
                  Risk summary
                </button>
              )}
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
            const Workspace = STAGE_COMPONENTS[activeAudit.workflow_type]?.[viewedStage];
            // Investigator stages without a real workspace yet render a
            // walkable placeholder rather than a blank pane.
            if (!Workspace) {
              return <IsaStagePlaceholder stage={viewedStage} />;
            }
            return <Workspace />;
          })()}
        </div>
      </main>

      {/* Vendor risk summary rail — vendor-workflow-only: its copy ("why this
          vendor matters") and its generate action write vendor_risk_summary
          rows, which must never attach to an investigator site audit. The ISA
          risk surface lands with the ISA_RISK_ASSESSMENT phase. */}
      {activeAudit.workflow_type === 'VENDOR_AUDIT' && (
        <RiskSummaryPanel auditId={activeAudit.id} />
      )}

      {/* Mobile/tablet drawer variant — opens via the "Risk summary" header button */}
      {summaryDrawerOpen && activeAudit.workflow_type === 'VENDOR_AUDIT' && (
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

      {/* Traceability drawer — per-audit seed→tree lineage. Mounted only while
          open, same as the other slide-overs. */}
      {traceabilityOpen && (
        <TraceabilityDrawer
          audit={activeAudit}
          onClose={() => setTraceabilityOpen(false)}
        />
      )}

      {/* Issues & CAPA drawer — triage + draft-only CAPA review loop. */}
      {issuesCapaOpen && (
        <IssuesCapaDrawer
          audit={activeAudit}
          onClose={() => setIssuesCapaOpen(false)}
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
            } else if (
              kind === 'questionnaire_flagged' &&
              activeAudit.workflow_type === 'VENDOR_AUDIT'
            ) {
              // QUESTIONNAIRE_REVIEW is a vendor stage — never navigate an
              // investigator audit into a stage its pipeline doesn't contain.
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
          /* Write-back lands on Stage 7 (REPORT_DRAFTING) — a vendor stage.
             For investigator audits the prop is omitted, which hides the
             write-back affordance in the panel entirely; the ISA report
             gets its own write-back target when ISA_REPORT ships. */
          onAssistantWriteback={activeAudit.workflow_type !== 'VENDOR_AUDIT' ? undefined : async (kind, text) => {
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
  stages: readonly AuditStage[];
  currentStage: AuditStage;
  viewedStage: AuditStage;
  onSelectStage: (s: AuditStage) => void;
  isLight: boolean;
}

function MobileStagePicker({
  stages,
  currentStage,
  viewedStage,
  onSelectStage,
  isLight,
}: MobileStagePickerProps) {
  const currentIdx = stages.indexOf(currentStage);

  return (
    <div className="md:hidden flex-shrink-0 self-start relative">
      <select
        value={viewedStage}
        onChange={(e) => onSelectStage(e.target.value as AuditStage)}
        aria-label="Audit stage"
        className={`appearance-none text-xs font-semibold pl-3 pr-8 py-1.5 rounded-md border transition-colors cursor-pointer ${
          isLight
            ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
            : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
        }`}
      >
        {stages.map((s, idx) => {
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
          isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45'
        }`}
      />
    </div>
  );
}
