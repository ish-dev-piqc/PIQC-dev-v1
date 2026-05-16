import { useEffect, useState } from 'react';
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
import { useWorksheetReviewCount } from '../../../hooks/useWorksheetReviewCount';
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
  // F-2: bump on drawer close so the badge picks up newly reviewed items
  // without forcing a remount. Increment-only token; identity matters, value
  // doesn't.
  const [reviewCountToken, setReviewCountToken] = useState(0);
  const reviewCount = useWorksheetReviewCount(
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
  }, [activeAudit?.id]);

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
              <button
                type="button"
                onClick={() => setProtocolSourceOpen(true)}
                disabled={!activeAudit.protocol_id}
                title={
                  activeAudit.protocol_id
                    ? reviewCount.data && reviewCount.data.awaitingReview > 0
                      ? `${reviewCount.data.awaitingReview} parsed item${
                          reviewCount.data.awaitingReview === 1 ? '' : 's'
                        } awaiting your review`
                      : 'View what the parser extracted from the protocol PDF'
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
                {/* Review-queue badge — only shown when there's something to do.
                    Amber, not blue: amber reads as "action needed" in the
                    design system. Calm, not alarming; the auditor decides
                    when to click in. */}
                {reviewCount.data && reviewCount.data.awaitingReview > 0 && (
                  <span
                    data-testid="audit-protocol-source-review-badge"
                    className={`ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-semibold leading-none border ${
                      isLight
                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                        : 'bg-amber-500/[0.08] border-amber-500/30 text-amber-300'
                    }`}
                    aria-label={`${reviewCount.data.awaitingReview} awaiting review`}
                  >
                    {reviewCount.data.awaitingReview}
                  </span>
                )}
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
      <PiqcDock onOpen={() => setChatOpen(true)} hidden={chatOpen} />

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
