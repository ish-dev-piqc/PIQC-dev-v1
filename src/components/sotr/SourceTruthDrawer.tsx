import { useRef } from 'react';
import { X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import { useWorksheetItemEvidence } from '../../hooks/useWorksheetItemEvidence';
import SourceTruthPanel, {
  SourceTruthLoading,
  SourceTruthError,
} from './SourceTruthPanel';

// =============================================================================
// SourceTruthDrawer — right-edge drawer that hosts SourceTruthPanel.
//
// Mode-agnostic: takes studyId + worksheetItemId and an optional itemLabel
// (the extracted value text) to display in the panel header. Closes via
// ESC, backdrop click, or right-swipe (mobile). z-index 50 — sits below
// any subsequent stacking drawer (PR-1 pattern: VisitDetailDrawer is z-40,
// ParticipantProfileDrawer is z-60).
// =============================================================================

interface Props {
  studyId: string;
  worksheetItemId: string;
  itemLabel?: string | null;
  onClose: () => void;
}

export default function SourceTruthDrawer({
  studyId,
  worksheetItemId,
  itemLabel,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  const evidence = useWorksheetItemEvidence(studyId, worksheetItemId);

  return (
    <div
      data-testid="sotr-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Source evidence panel"
    >
      {/* Backdrop */}
      <div
        data-testid="sotr-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        {...swipe}
        className="relative w-full max-w-md h-full bg-[#f5f7fa] dark:bg-[#0d1118] shadow-xl border-l border-[#e2e8ee] dark:border-white/5 overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-[#f5f7fa]/95 dark:bg-[#0d1118]/95 backdrop-blur px-5 py-3.5 border-b border-[#e2e8ee] dark:border-white/5 flex items-center justify-between gap-3">
          <h2 className="text-fg-heading text-sm font-semibold">Source Truth</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close source panel"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-sub hover:bg-[#e2e8ee] dark:hover:bg-white/[0.06]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5">
          {evidence.status === 'loading' && <SourceTruthLoading />}
          {evidence.status === 'error' && (
            <SourceTruthError onRetry={evidence.retry} />
          )}
          {evidence.status === 'success' && (
            <SourceTruthPanel
              itemLabel={itemLabel}
              data={evidence.data}
              studyId={studyId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
