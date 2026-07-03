import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import {
  MONITORING_SECTION_LABELS,
  groupBlocksBySection,
  type DeliverablePacketBlock,
  type MonitoringChecklistSectionKey,
} from '../../types/deliverables';
import { DeliverableBlockRow } from './DeliverableBlockRow';

// =============================================================================
// DeliverableBlockList — the deliverable's main surface. Groups packet blocks
// by section via groupBlocksBySection (stable MONITORING_SECTION_ORDER, empty
// sections hidden), renders each section as a collapsible card in the VEW
// phase-card style: header button with label + reviewed/total counter, rows in
// a divided list, and a quiet "+ Add item" footer per section.
//
// Phase-1 simplification (deliberate, vs VEW's defaultExpandedPhases
// heuristics): all sections start expanded — a monitoring-prep reviewer scans
// the whole draft top to bottom, so there's no "current phase" to spotlight.
//
// Pure presentation: block state lives in the parent (the sponsor panel
// orchestrates fetching + mutations); this component only groups and renders.
// =============================================================================

interface Props {
  blocks: DeliverablePacketBlock[];
  onMarkReviewed: (block: DeliverablePacketBlock) => void;
  onUnmarkReviewed: (block: DeliverablePacketBlock) => void;
  onFlag: (block: DeliverablePacketBlock) => void;
  onReject: (block: DeliverablePacketBlock) => void;
  onEdit: (block: DeliverablePacketBlock) => void;
  onAddNote: (block: DeliverablePacketBlock) => void;
  onShowSource: (block: DeliverablePacketBlock) => void;
  onDelete: (block: DeliverablePacketBlock) => void;
  onAddBlock: (sectionKey: MonitoringChecklistSectionKey) => void;
}

export function DeliverableBlockList({
  blocks,
  onMarkReviewed,
  onUnmarkReviewed,
  onFlag,
  onReject,
  onEdit,
  onAddNote,
  onShowSource,
  onDelete,
  onAddBlock,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const grouped = useMemo(() => groupBlocksBySection(blocks), [blocks]);

  // All expanded by default — track the collapsed exceptions.
  const [collapsed, setCollapsed] = useState<Set<MonitoringChecklistSectionKey>>(
    () => new Set(),
  );

  const toggleSection = (sectionKey: MonitoringChecklistSectionKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) next.delete(sectionKey);
      else next.add(sectionKey);
      return next;
    });
  };

  if (blocks.length === 0) {
    return (
      <div
        data-testid="deliverable-block-list-empty"
        className={`rounded-xl border px-4 py-8 text-center ${
          isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
        }`}
      >
        <p className="text-fg-body text-sm">No checklist items yet.</p>
        <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
          Generate the checklist to draft evidence-linked items from the protocol.
        </p>
      </div>
    );
  }

  return (
    <section
      data-testid="deliverable-block-list"
      aria-label="Deliverable draft blocks grouped by section"
      className="space-y-3"
    >
      {grouped.map(({ sectionKey, blocks: sectionBlocks }) => {
        const isOpen = !collapsed.has(sectionKey);

        return (
          <div
            key={sectionKey}
            data-testid={`deliverable-section-${sectionKey}`}
            data-section={sectionKey}
            data-open={isOpen}
            className={`rounded-xl border overflow-hidden ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
            }`}
          >
            <button
              type="button"
              onClick={() => toggleSection(sectionKey)}
              aria-expanded={isOpen}
              aria-controls={`deliverable-section-items-${sectionKey}`}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left ${
                isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? (
                  <ChevronDown size={14} className="text-fg-sub flex-shrink-0" aria-hidden />
                ) : (
                  <ChevronRight size={14} className="text-fg-sub flex-shrink-0" aria-hidden />
                )}
                <span className="text-fg-heading text-[15px] font-semibold tracking-tight truncate">
                  {MONITORING_SECTION_LABELS[sectionKey]}
                </span>
              </div>
              <span
                data-testid="deliverable-section-count"
                className={`text-xs font-medium tabular-nums flex-shrink-0 rounded-md px-1.5 py-0.5 ${
                  isLight ? 'text-fg-sub bg-[#F2F2F2]' : 'text-fg-sub bg-white/[0.05]'
                }`}
              >
                {sectionBlocks.length}
              </span>
            </button>

            {isOpen && (
              <>
                <ul
                  id={`deliverable-section-items-${sectionKey}`}
                  className={`divide-y ${
                    isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.04]'
                  }`}
                >
                  {sectionBlocks.map((block) => (
                    <DeliverableBlockRow
                      key={block.id}
                      block={block}
                      onMarkReviewed={onMarkReviewed}
                      onUnmarkReviewed={onUnmarkReviewed}
                      onFlag={onFlag}
                      onReject={onReject}
                      onEdit={onEdit}
                      onAddNote={onAddNote}
                      onShowSource={onShowSource}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>

                {/* Quiet per-section add affordance — reviewer-added blocks are
                    human_editorial and survive regeneration. */}
                <div
                  className={`border-t px-4 py-2 ${
                    isLight ? 'border-[#F2F2F2]' : 'border-white/[0.04]'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onAddBlock(sectionKey)}
                    data-testid="deliverable-section-add"
                    className={`inline-flex items-center gap-1 text-xs font-medium text-fg-sub rounded-md px-1.5 py-1 ${
                      isLight
                        ? 'hover:bg-[#F2F2F2] hover:text-fg-body'
                        : 'hover:bg-white/[0.04] hover:text-fg-body'
                    }`}
                  >
                    <Plus size={12} aria-hidden />
                    Add item
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}
