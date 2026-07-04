import { Hammer } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import type { AuditStage } from '../../../../../types/audit';
import { STAGE_LABELS, STAGE_DESCRIPTIONS } from '../../../../../lib/audit/labels';

// =============================================================================
// IsaStagePlaceholder — center pane for Investigator Site Audit stages whose
// workspace ships in a later phase (risk assessment, scope builder, prep,
// conduct, report, export). The stage nav is fully walkable in Phase 1; each
// unbuilt stage explains what it will do rather than rendering blank.
// =============================================================================

export default function IsaStagePlaceholder({ stage }: { stage: AuditStage }) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    // Same container scale as the vendor stage workspaces (p-6 max-w-4xl) so
    // the pane doesn't narrow when navigating between built and unbuilt stages.
    <div className="p-6 max-w-4xl mx-auto">
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
    </div>
  );
}
