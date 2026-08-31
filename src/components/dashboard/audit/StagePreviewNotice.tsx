import { Eye } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { type AuditStage } from '../../../types/audit';
import { STAGE_LABELS } from '../../../lib/audit/labels';

// =============================================================================
// StagePreviewNotice — banner shown by a stage workspace when the auditor is
// previewing it one stage ahead of the audit's actual position (the nav allows
// exactly current+1). The workspace pairs this with hasReachedStage() from
// lib/audit/workflowStages: notice up, mutating actions and mount-time writes
// off. Copy matches ScopeReviewWorkspace's readout-driven guard string family.
// =============================================================================

interface StagePreviewNoticeProps {
  /** The audit's actual workflow position (activeAudit.current_stage). */
  currentStage: AuditStage;
}

export default function StagePreviewNotice({ currentStage }: StagePreviewNoticeProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  return (
    <div
      role="status"
      className={`flex items-start gap-2 text-xs px-3 py-2 mb-4 rounded-md border ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-800'
          : 'bg-amber-500/10 border-amber-500/25 text-amber-200'
      }`}
    >
      <Eye size={14} className="flex-shrink-0 mt-0.5" />
      <span>
        The audit has not reached this stage yet — this is a preview. Actions here
        are disabled until you advance from {STAGE_LABELS[currentStage]}.
      </span>
    </div>
  );
}
