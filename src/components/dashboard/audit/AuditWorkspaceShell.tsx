import { useCallback, useEffect, useState } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit } from '../../../context/AuditContext';
import type { AuditStage, AuditWorkflowType } from '../../../types/audit';
import { STAGE_LABELS, AUDIT_TYPE_LABELS, AUDIT_STATUS_LABELS } from '../../../lib/audit/labels';
import { ChevronDown, ChevronLeft, ChevronRight, Sparkles, FileSearch, Plus, GitBranch, AlertOctagon, Paperclip, FolderOpen, History } from 'lucide-react';
import StageNav from './StageNav';
import AuditRequiredGate from './AuditRequiredGate';
import RiskSummaryPanel from './RiskSummaryPanel';
import SourceTruthListDrawer from '../../sotr/SourceTruthListDrawer';
import NewAuditDrawer from './onboarding/NewAuditDrawer';
import TraceabilityDrawer from './TraceabilityDrawer';
import IssuesCapaDrawer from './IssuesCapaDrawer';
import EvidenceDrawer from './EvidenceDrawer';
import HistoryDrawer from './HistoryDrawer';
import RescheduleAuditPopover from './RescheduleAuditPopover';
import { EvidenceOpenContext } from './evidenceDrawerContext';
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
import IsaConductWorkspace from './stages/investigator/IsaConductWorkspace';
import IsaReportWorkspace from './stages/investigator/IsaReportWorkspace';
import IsaStagePlaceholder from './stages/investigator/IsaStagePlaceholder';

// Dispatch table — (workflow_type, viewedStage) → component. Keying by workflow
// keeps vendor and investigator stage sets isolated: an ISA_* stage never
// resolves to a vendor component and vice versa. Investigator stages without a
// real workspace yet fall through to IsaStagePlaceholder (see the render below).
//
// EVERY workspace listed here is reachable one stage AHEAD of the audit's
// position (the nav allows current+1). A new workspace MUST derive
// hasReachedStage(...) and, while previewing, render StagePreviewNotice and
// suppress its mutating actions and mount-time writes — see any sibling for
// the pattern. Nothing enforces this mechanically (yet); forget it and the
// preview silently writes.
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
    ISA_CONDUCT: IsaConductWorkspace,
    ISA_REPORT: IsaReportWorkspace,
    // ISA_RISK_ASSESSMENT / ISA_SCOPE_BUILDER / ISA_PREP / ISA_EXPORT ship in
    // later phases → placeholder.
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
  const { activeAudit, audits, setActiveAudit, refresh } = useAudit();
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
  // Source evidence slide-over — the audit's evidence register. Cross-stage:
  // evidence (most importantly the vendor's returned questionnaire file)
  // arrives by email at any stage and gets filed the moment it lands.
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  // Stable identity: handed to stage workspaces via EvidenceOpenContext.
  const openEvidence = useCallback(() => setEvidenceOpen(true), []);
  // Audit history slide-over — the audit-level delta trail ('AUDIT' deltas:
  // stage advances, reschedules, evidence attach/remove). Before PR-UX1 these
  // deltas were written but had no UI surface.
  const [auditHistoryOpen, setAuditHistoryOpen] = useState(false);
  // Records menu (header IA pass) — one dropdown for the record
  // surfaces. Transient UI: closes on selection, Escape, outside click,
  // and audit switch.
  const [recordsOpen, setRecordsOpen] = useState(false);
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
    setEvidenceOpen(false);
    setAuditHistoryOpen(false);
    setRecordsOpen(false);
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

  // Prev/next stepping for the header chevrons. Same lock rule as StageNav and
  // MobileStagePicker: anything ≤ current+1 is navigable, beyond is locked.
  const viewedIdx = stages.indexOf(viewedStage);
  const currentIdx = stages.indexOf(activeAudit.current_stage);
  const prevStage = viewedIdx > 0 ? stages[viewedIdx - 1] : null;
  const nextStage =
    viewedIdx >= 0 && viewedIdx < stages.length - 1 ? stages[viewedIdx + 1] : null;
  // Locked iff stepping forward would pass current+1 — i.e. already viewing
  // ahead of current.
  const nextLocked = nextStage !== null && viewedIdx > currentIdx;

  const headerBg = isLight
    ? 'bg-white border-[#E2E8F0]'
    : 'bg-[#0F172A] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const chipBg = isLight
    ? 'bg-brand-600/10 border-brand-600/20 text-brand-600'
    : 'bg-brand-600/15 border-brand-600/30 text-brand-300';
  // Shared by both stage-step chevrons.
  const stepBtnOn = isLight
    ? 'text-[#334155] hover:bg-[#0F172A]/[0.04]'
    : 'text-[#CBD5E1] hover:bg-white/[0.04]';
  const stepBtnOff = `${mutedColor} opacity-40 cursor-default`;

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
                {/* Prev/next stepping — the literal "back and forth". Adjacent
                    stage names ride the buttons (visible ≥lg, always in the
                    accessible name); disabled at the pipeline ends and at the
                    current+1 lock. */}
                <button
                  type="button"
                  disabled={!prevStage}
                  onClick={() => prevStage && setViewedStage(prevStage)}
                  aria-label={prevStage ? `Previous stage: ${STAGE_LABELS[prevStage]}` : 'No previous stage'}
                  title={prevStage ? `Previous: ${STAGE_LABELS[prevStage]}` : undefined}
                  className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-md transition-colors ${
                    prevStage ? stepBtnOn : stepBtnOff
                  }`}
                >
                  <ChevronLeft size={14} />
                  {prevStage && (
                    <span className={`hidden lg:inline text-[11px] ${mutedColor} max-w-[9rem] truncate`}>
                      {STAGE_LABELS[prevStage]}
                    </span>
                  )}
                </button>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] uppercase tracking-wider font-semibold ${chipBg}`}>
                  {STAGE_LABELS[viewedStage]}
                </span>
                <button
                  type="button"
                  disabled={!nextStage || nextLocked}
                  onClick={() => nextStage && !nextLocked && setViewedStage(nextStage)}
                  aria-label={
                    !nextStage
                      ? 'No next stage'
                      : nextLocked
                      ? 'Next stage locked until the audit advances'
                      : `Next stage: ${STAGE_LABELS[nextStage]}`
                  }
                  title={
                    !nextStage
                      ? undefined
                      : nextLocked
                      ? 'Locked until the audit advances'
                      : `Next: ${STAGE_LABELS[nextStage]}`
                  }
                  className={`inline-flex items-center gap-1 px-1 py-0.5 rounded-md transition-colors ${
                    nextStage && !nextLocked ? stepBtnOn : stepBtnOff
                  }`}
                >
                  {nextStage && !nextLocked && (
                    <span className={`hidden lg:inline text-[11px] ${mutedColor} max-w-[9rem] truncate`}>
                      {STAGE_LABELS[nextStage]}
                    </span>
                  )}
                  <ChevronRight size={14} />
                </button>
                {/* Position cue for <md, where the StageNav rail (which carries
                    "N of M") is hidden. viewedIdx guard: for one paint after a
                    cross-workflow audit switch, viewedStage belongs to the old
                    pipeline (indexOf -1) until the snap effect fires. */}
                {viewedIdx >= 0 && (
                  <span className={`md:hidden text-[11px] ${mutedColor}`}>
                    Stage {viewedIdx + 1} of {stages.length}
                  </span>
                )}
                {/* Off-current indicator as an ACTION (all breakpoints). Replaces
                    dead "Viewing earlier stage" text that was hidden below sm and
                    wrong when previewing ahead. */}
                {viewedIdx >= 0 && viewedStage !== activeAudit.current_stage && (
                  <button
                    type="button"
                    onClick={() => setViewedStage(activeAudit.current_stage)}
                    className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md border transition-colors ${
                      isLight
                        ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                        : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Direction-aware: current is forward of a past view,
                        behind an ahead preview. */}
                    {viewedIdx < currentIdx ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
                    Back to current stage
                  </button>
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
              {/* Date line — visible at every breakpoint (mobile included);
                  the date itself is the reschedule affordance. */}
              <RescheduleAuditPopover
                audit={activeAudit}
                isLight={isLight}
                onRescheduled={refresh}
              />
            </div>
            {/* The grouping pass landed: the record surfaces (Protocol
                source / Traceability / Issues & CAPA / Evidence / Audit
                history) live in the Records dropdown, so the row is stage
                picker (mobile) · New audit · Records · Risk summary
                (xl-hidden, vendor). flex-wrap kept for narrow viewports.
                A new always-on button here should justify itself against
                the menu first. */}
            <div className="flex items-center gap-2 flex-wrap justify-end flex-shrink-0 self-start">
              {/* Mobile-only stage picker — replaces the StageNav rail below md: */}
              <MobileStagePicker
                stages={stages}
                currentStage={activeAudit.current_stage}
                viewedStage={viewedStage}
                onSelectStage={setViewedStage}
                isLight={isLight}
              />
              {/* New-audit drawer trigger — reachable on any stage so
                  returning auditors can start a new audit without leaving
                  the workspace. */}
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
              {/* Records — one dropdown for the record surfaces (all
                  answer "show me this audit's records/provenance"). Drawer
                  state and mounts are unchanged — this is trigger-only IA.
                  Lightweight local menu pattern: backdrop for outside click,
                  wrapper Escape — deliberately NOT useOverlay (its scroll
                  lock + focus trap are drawer semantics). */}
              <div
                className="relative flex-shrink-0"
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setRecordsOpen(false);
                }}
              >
                <button
                  type="button"
                  onClick={() => setRecordsOpen((o) => !o)}
                  aria-haspopup="menu"
                  aria-expanded={recordsOpen}
                  title="Protocol source, traceability, issues & CAPA, evidence, history"
                  data-testid="audit-records-button"
                  className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors ${
                    isLight
                      ? 'bg-white border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
                      : 'bg-[#0F172A] border-white/[0.08] text-[#CBD5E1] hover:bg-white/[0.04]'
                  }`}
                >
                  <FolderOpen size={12} />
                  Records
                  <ChevronDown size={12} className={recordsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
                </button>
                {recordsOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setRecordsOpen(false)} />
                    <div
                      role="menu"
                      aria-label="Audit records"
                      className={`absolute right-0 top-full mt-1 z-40 w-60 rounded-lg border shadow-lg py-1 ${
                        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
                      }`}
                    >
                      {/* Protocol source — the `disabled` branch is defensive:
                          audits.protocol_id is NOT NULL per schema
                          (20260427120000), so this state is unreachable today.
                          Kept as cheap insurance, same as the button it
                          replaces — do not refactor away without revisiting
                          the schema constraint. */}
                      <button
                        type="button"
                        role="menuitem"
                        disabled={!activeAudit.protocol_id}
                        onClick={() => {
                          setRecordsOpen(false);
                          setProtocolSourceOpen(true);
                        }}
                        title={
                          activeAudit.protocol_id
                            ? 'View what the parser extracted from the protocol PDF'
                            : 'No protocol associated with this audit'
                        }
                        data-testid="audit-protocol-source-button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                          isLight ? 'text-[#334155] hover:bg-[#F8FAFC]' : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                        }`}
                      >
                        <FileSearch size={12} />
                        Protocol source
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecordsOpen(false);
                          setTraceabilityOpen(true);
                        }}
                        title="Trace every record in this audit back to its seed"
                        data-testid="audit-traceability-button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors ${
                          isLight ? 'text-[#334155] hover:bg-[#F8FAFC]' : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                        }`}
                      >
                        <GitBranch size={12} />
                        Traceability
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecordsOpen(false);
                          setIssuesCapaOpen(true);
                        }}
                        title="Triage findings into issues and draft CAPAs for review"
                        data-testid="audit-issues-capa-button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors ${
                          isLight ? 'text-[#334155] hover:bg-[#F8FAFC]' : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                        }`}
                      >
                        <AlertOctagon size={12} />
                        Issues &amp; CAPA
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecordsOpen(false);
                          setEvidenceOpen(true);
                        }}
                        title="Attach and manage source evidence for this audit"
                        data-testid="audit-evidence-button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors ${
                          isLight ? 'text-[#334155] hover:bg-[#F8FAFC]' : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                        }`}
                      >
                        <Paperclip size={12} />
                        Evidence
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setRecordsOpen(false);
                          setAuditHistoryOpen(true);
                        }}
                        title="Audit-level change history: stage moves, reschedules, evidence"
                        data-testid="audit-history-button"
                        className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors ${
                          isLight ? 'text-[#334155] hover:bg-[#F8FAFC]' : 'text-[#CBD5E1] hover:bg-white/[0.04]'
                        }`}
                      >
                        <History size={12} />
                        Audit history
                      </button>
                    </div>
                  </>
                )}
              </div>
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
          <EvidenceOpenContext.Provider value={openEvidence}>
          {(() => {
            // REPORT_DRAFTING is specialized so the shell can hand it the
            // transient PIQC write-back landing notice. Every other stage
            // dispatches through the no-props record below. Further
            // shell-injected state goes through a dedicated context, never
            // by growing this if-ladder — EvidenceOpenContext (wrapping this
            // dispatch) is the pattern to copy. Migrating landingNotice into
            // a context of its own is deliberately out of scope here.
            if (activeAudit.workflow_type === 'VENDOR_AUDIT' && viewedStage === 'REPORT_DRAFTING') {
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
          </EvidenceOpenContext.Provider>
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

      {/* Evidence drawer — the audit's source evidence register. */}
      {evidenceOpen && (
        <EvidenceDrawer
          audit={activeAudit}
          onClose={() => setEvidenceOpen(false)}
        />
      )}

      {/* Audit history drawer — the 'AUDIT' delta trail (stage advances,
          reschedules, evidence attach/remove). Generic HistoryDrawer, first
          mounted at the audit level in PR-UX1. */}
      {auditHistoryOpen && (
        <HistoryDrawer
          objectType="AUDIT"
          objectId={activeAudit.id}
          title={activeAudit.audit_name}
          subTitle="Audit · change history"
          onClose={() => setAuditHistoryOpen(false)}
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
            if (!result.ok) {
              throw new Error(
                `Could not save to Stage 7: ${result.error} Try again, or copy the text manually.`,
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
    // Visible "Stage" label (wrapping <label> also names the select — the old
    // aria-label-only control read as an unlabeled dropdown).
    <label className="md:hidden flex-shrink-0 self-start flex items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wider font-semibold text-fg-label">
        Stage
      </span>
      <span className="relative">
        <select
          value={viewedStage}
          onChange={(e) => onSelectStage(e.target.value as AuditStage)}
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
      </span>
    </label>
  );
}
