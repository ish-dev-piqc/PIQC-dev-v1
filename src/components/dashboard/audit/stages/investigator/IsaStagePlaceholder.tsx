import { Hammer } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { useAudit } from '../../../../../context/AuditContext';
import type { AuditStage } from '../../../../../types/audit';
import { STAGE_LABELS, STAGE_DESCRIPTIONS } from '../../../../../lib/audit/labels';
import { hasReachedStage, stagesForWorkflow } from '../../../../../lib/audit/workflowStages';
import StagePreviewNotice from '../../StagePreviewNotice';
import StageTransitionCard from '../StageTransitionCard';

// =============================================================================
// IsaStagePlaceholder — center pane for Investigator Site Audit stages whose
// workspace ships later (today: Audit prep, Review & export). The stage nav
// is fully walkable; each unbuilt stage explains what it will do rather than
// rendering blank.
//
// A placeholder is also a stage the audit has to pass THROUGH: the ISA
// advance RPC permits every +1 step with no content gate, so the placeholder
// mounts the shared StageTransitionCard toward the next stage in the ISA
// pipeline (Audit prep → Audit conduct) — without it the built stages behind
// it are unreachable. The terminal stage has no successor and no card.
// Viewed one ahead, the house preview notice sits above the card's ahead
// state, as on every built stage (the card's terse "Advance from X first."
// presumes the notice has explained the preview).
// =============================================================================

export default function IsaStagePlaceholder({ stage }: { stage: AuditStage }) {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const isLight = theme === 'light';

  // Successor from the pipeline resolver, never a hand-kept map. A stage
  // outside the active workflow (or the last one) has none → no card.
  const stages: readonly AuditStage[] = activeAudit
    ? stagesForWorkflow(activeAudit.workflow_type)
    : [];
  const idx = stages.indexOf(stage);
  const nextStage = idx >= 0 && idx + 1 < stages.length ? stages[idx + 1] : null;
  const hasReached =
    !!activeAudit && hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, stage);

  return (
    // Same container scale as the vendor stage workspaces (p-6 max-w-4xl) so
    // the pane doesn't narrow when navigating between built and unbuilt stages.
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {activeAudit && !hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
      <div
        className={`rounded-lg border border-dashed px-6 py-8 text-center ${
          isLight ? 'bg-white border-[#CBD5E1]' : 'bg-white/[0.02] border-white/15'
        }`}
      >
        <div
          className={`inline-flex items-center justify-center w-10 h-10 rounded-full mb-3 ${
            isLight ? 'bg-brand-600/10 text-brand-600' : 'bg-brand-300/10 text-brand-300'
          }`}
        >
          <Hammer size={18} />
        </div>
        <h2 className="text-fg-heading text-base font-semibold">{STAGE_LABELS[stage]}</h2>
        <p className="text-fg-sub text-sm mt-1.5 max-w-md mx-auto">{STAGE_DESCRIPTIONS[stage]}</p>
        {/* "Not available yet", not roadmap vocabulary — "phase" is reserved
            for clinical-trial phases in user-facing copy. */}
        <p className="text-fg-muted text-xs mt-3">This workspace isn't available yet.</p>
      </div>
      {nextStage && <StageTransitionCard stage={stage} nextStage={nextStage} />}
    </div>
  );
}
