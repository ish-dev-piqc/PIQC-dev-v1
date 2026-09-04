import { ArrowRight } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { STAGE_LABELS } from '../../../../lib/audit/labels';
import { hasPassedStage } from '../../../../lib/audit/workflowStages';
import type { AuditStage } from '../../../../types/audit';

// =============================================================================
// StageTransitionCard — the "advance the audit" card for an UNGATED stage.
//
// The server (audit_mode_advance_audit_stage) permits exactly one step
// forward and gates only PRE_AUDIT_DRAFTING, AUDIT_CONDUCT and
// FINAL_REVIEW_EXPORT. The stages before those never had an advance control,
// so a vendor audit could not leave Intake from the UI. This card is the
// control for those stages; it mirrors the server rule and invents no gate
// of its own. The gated stages keep their inline, readout-driven cards
// (Scope review, Pre-audit drafting, Audit conduct, Report drafting) — this
// one copies their markup so the eight stages read alike.
//
// Three states, from the audit's real position (activeAudit.current_stage):
//   at the stage      → ready, button enabled
//   past the stage    → "already advanced", button disabled
//   ahead (the nav's one-ahead preview) → "not reached yet", disabled — the
//                       server refuses a +2 jump; the card just doesn't offer it
// The server's rejection, if any, surfaces from AuditContext.advanceStage as
// advanceStageError and renders inline (AUD-301 class: never a dead click).
// =============================================================================

interface StageTransitionCardProps {
  /** The stage whose workspace renders this card. */
  stage: AuditStage;
  /** The stage the button advances to — the pipeline's next stage. */
  nextStage: AuditStage;
}

export default function StageTransitionCard({ stage, nextStage }: StageTransitionCardProps) {
  const { theme } = useTheme();
  const { activeAudit, advanceStage, advanceStageError } = useAudit();
  const isLight = theme === 'light';

  if (!activeAudit) return null;

  const atThisStage = activeAudit.current_stage === stage;
  const alreadyAdvanced = hasPassedStage(activeAudit.workflow_type, activeAudit.current_stage, stage);

  const title = alreadyAdvanced
    ? 'Audit has already advanced past this stage'
    : atThisStage
    ? 'Ready to advance'
    : 'Preview — the audit has not reached this stage yet';
  const detail = alreadyAdvanced
    ? `Current stage: ${STAGE_LABELS[activeAudit.current_stage]}`
    : atThisStage
    ? 'No gate on this transition. Advancing records it in the audit history; this stage stays editable afterwards.'
    : 'The audit has not reached this stage yet — advance from its current stage first.';

  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1] disabled:hover:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:hover:bg-white/10 disabled:text-white/35';

  return (
    <div className={`${cardBg} border rounded-xl p-5`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            Stage transition
          </p>
          <p className="text-fg-heading text-sm font-semibold mt-1">{title}</p>
          <p className="text-fg-sub text-xs mt-1">{detail}</p>
        </div>
        <button
          type="button"
          onClick={() => advanceStage(nextStage)}
          disabled={!atThisStage}
          className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
        >
          Advance to {STAGE_LABELS[nextStage]}
          <ArrowRight size={14} />
        </button>
      </div>
      {advanceStageError && (
        <div
          role="alert"
          className={`text-xs px-3 py-2 mt-4 rounded-md border ${
            isLight
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-red-500/15 border-red-500/30 text-red-300'
          }`}
        >
          Couldn’t advance the stage: {advanceStageError}
        </div>
      )}
    </div>
  );
}
