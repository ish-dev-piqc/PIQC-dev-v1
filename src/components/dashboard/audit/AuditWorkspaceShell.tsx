import { useEffect, useState } from 'react';
import { useTheme } from '../../../context/ThemeContext';
import { useAudit } from '../../../context/AuditContext';
import type { AuditStage } from '../../../types/audit';
import { STAGE_LABELS, AUDIT_TYPE_LABELS, AUDIT_STATUS_LABELS } from '../../../lib/audit/labels';
import { ChevronDown, Sparkles } from 'lucide-react';
import StageNav from './StageNav';
import AuditRequiredGate from './AuditRequiredGate';
import RiskSummaryPanel from './RiskSummaryPanel';
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
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // Reset viewedStage to the audit's current stage whenever the active audit changes.
  const [viewedStage, setViewedStage] = useState<AuditStage>(
    activeAudit?.current_stage ?? 'INTAKE',
  );
  // Mobile/tablet drawer for the risk summary panel (visible below xl).
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);

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
            in each stage component individually without touching the shell. */}
        <div className="flex-1 overflow-y-auto" style={{ minHeight: 0 }}>
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
