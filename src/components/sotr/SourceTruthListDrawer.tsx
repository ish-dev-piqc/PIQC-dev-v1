import { useRef } from 'react';
import { X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import WorksheetItemsList from './WorksheetItemsList';

// =============================================================================
// SourceTruthListDrawer — right-edge slide-over hosting WorksheetItemsList.
//
// Mode-agnostic: callers pass studyId (and optional studyCode for export
// filenames). The drawer renders the full list of extracted worksheet items
// grouped by field_type; clicking a row opens the per-item SourceTruthDrawer
// (z-50) which correctly stacks on top of this drawer (z-40).
//
// Closes via ESC, backdrop click, or right-swipe (mobile). One step wider
// than the per-item drawer (max-w-xl vs max-w-md) to host a single-column
// list without dominating the stage workspace behind the backdrop.
//
// Audit Mode uses this from AuditWorkspaceShell to give the auditor cross-stage
// access to "what did the parser see, and where in the PDF did it come from?"
// without leaving the active stage workspace.
// =============================================================================

interface Props {
  studyId: string;
  /** Optional human-friendly study code used in the export filename. */
  studyCode?: string | null;
  onClose: () => void;
}

export default function SourceTruthListDrawer({
  studyId,
  studyCode,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  return (
    <div
      data-testid="sotr-list-drawer"
      // z-40 so the per-item SourceTruthDrawer (z-50) opened from a row click
      // stacks on top correctly.
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Protocol source items"
    >
      {/* Backdrop */}
      <div
        data-testid="sotr-list-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* Panel — max-w-xl: one step wider than the per-item SourceTruthDrawer
          (max-w-md), enough room for a single-column list without dominating
          the stage workspace behind the backdrop. */}
      <div
        ref={panelRef}
        {...swipe}
        className="relative w-full max-w-xl h-full bg-[#f5f7fa] dark:bg-[#0d1118] shadow-xl border-l border-[#e2e8ee] dark:border-white/5 overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-[#f5f7fa]/95 dark:bg-[#0d1118]/95 backdrop-blur px-5 py-3.5 border-b border-[#e2e8ee] dark:border-white/5 flex items-center justify-between gap-3">
          <h2 className="text-fg-heading text-sm font-semibold">Protocol source items</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close protocol source panel"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-sub hover:bg-[#e2e8ee] dark:hover:bg-white/[0.06]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5">
          <WorksheetItemsList studyId={studyId} studyCode={studyCode} />
        </div>
      </div>
    </div>
  );
}
