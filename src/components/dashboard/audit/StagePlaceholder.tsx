import { Construction } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { AuditStage } from '../../../types/audit';
import { STAGE_LABELS, STAGE_DESCRIPTIONS } from '../../../lib/audit/labels';

// =============================================================================
// StagePlaceholder — generic "coming soon" content for an audit stage.
//
// Used by the shell while individual stage workspaces are being built out.
// Phase A: the shell renders this for every stage. Phase B (task #31 + Phase
// B per-stage tasks) replaces this with per-stage components.
// =============================================================================

interface StagePlaceholderProps {
  stage: AuditStage;
}

export default function StagePlaceholder({ stage }: StagePlaceholderProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const iconBg = isLight
    ? 'bg-[#4a6fa5]/10 border-[#4a6fa5]/20 text-[#4a6fa5]'
    : 'bg-[#4a6fa5]/15 border-[#4a6fa5]/30 text-[#6e8fb5]';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className={`${cardBg} border rounded-xl p-8`}>
        <div className={`inline-flex items-center justify-center w-12 h-12 rounded-2xl border mb-4 ${iconBg}`}>
          <Construction size={20} />
        </div>
        <p className={`${mutedColor} text-[11px] uppercase tracking-wider font-semibold mb-1`}>
          Stage workspace
        </p>
        <h3 className={`${headingColor} font-semibold text-lg mb-2`}>
          {STAGE_LABELS[stage]}
        </h3>
        <p className={`${subColor} text-sm leading-relaxed`}>
          {STAGE_DESCRIPTIONS[stage]} The workspace for this stage is being built —
          this surface lands when its Phase B port completes.
        </p>
      </div>
    </div>
  );
}
