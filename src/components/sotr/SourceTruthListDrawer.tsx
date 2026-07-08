import { useRef } from 'react';
import { X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import WorksheetItemsList from './WorksheetItemsList';
import { NoticeRail } from '../actions/NoticeRail';
import type { ExtractedItemRecord } from '../../types/sotr';

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
//
// Pick mode (B1): when `onPick` is provided, each row renders an "Attach"
// button alongside the existing "View Source" affordance. Row click still
// opens the per-item drawer — inspect-before-pick stays native. The Attach
// button calls onPick(item) and the host typically closes the drawer.
// =============================================================================

interface Props {
  studyId: string;
  /** Optional human-friendly study code used in the export filename. */
  studyCode?: string | null;
  onClose: () => void;
  /** When provided, rows render an "Attach" affordance for picker workflows. */
  onPick?: (item: ExtractedItemRecord) => void;
}

export default function SourceTruthListDrawer({
  studyId,
  studyCode,
  onClose,
  onPick,
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
      aria-label={onPick ? 'Pick a protocol source item' : 'Protocol source items'}
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
        className="relative w-full max-w-xl h-full bg-[#F8FAFC] dark:bg-[#020617] shadow-xl border-l border-[#E2E8F0] dark:border-white/5 overflow-y-auto"
      >
        <div className="sticky top-0 z-10 bg-[#F8FAFC]/95 dark:bg-[#020617]/95 backdrop-blur px-5 py-3.5 border-b border-[#E2E8F0] dark:border-white/5 flex items-center justify-between gap-3">
          <h2 className="text-fg-heading text-sm font-semibold">
            {onPick ? 'Pick a protocol source item' : 'Protocol source items'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close protocol source panel"
            className="inline-flex items-center justify-center w-7 h-7 rounded-md text-fg-sub hover:bg-[#E2E8F0] dark:hover:bg-white/[0.06]"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {/* Protocol Awareness Layer — "what PIQC noticed" above the item
              list, next to the evidence it cites (studyId IS protocol_id).
              Self-hiding: renders nothing when there are no notices. */}
          <NoticeRail protocolId={studyId} />
          <WorksheetItemsList studyId={studyId} studyCode={studyCode} onPick={onPick} />
        </div>
      </div>
    </div>
  );
}
