import { useRef } from 'react';
import { AlertTriangle, FileText, GitBranch, Quote, X } from 'lucide-react';
import { useOverlay } from '../../hooks/useOverlay';
import { useSwipeDismiss } from '../../hooks/useSwipeDismiss';
import { useTheme } from '../../context/ThemeContext';
import {
  CONFIDENCE_LABELS,
  type DeliverablePacketBlock,
} from '../../types/deliverables';

// =============================================================================
// DeliverableTraceabilityDrawer — right-edge slide-in that answers "where in
// the protocol does this block come from?". Mirrors the VEW TraceabilityDrawer
// chrome exactly (useOverlay ESC/backdrop, useSwipeDismiss, z-50, max-w-md).
//
// No fetching: every field it renders (source_quote, source_section,
// source_page_number, confidence_state) was denormalized onto the block by
// the SECURITY DEFINER generate RPC — the drawer never joins SOTR tables.
// The protocol version lives on the packet (not the block), so the panel
// owner passes it down alongside the block.
//
// Parents should only open this for blocks with evidence (the row hides
// "View source" otherwise), but the drawer degrades gracefully with an
// explanatory empty state — framing/human blocks carry no provenance by
// design, and the drawer must never fabricate any.
// =============================================================================

interface Props {
  open: boolean;
  onClose: () => void;
  block: DeliverablePacketBlock | null;
  /** From DeliverablePacket.protocol_version — packet-level, not block-level. */
  protocolVersion?: string | null;
  /** Section labels for the mounted artifact type (drawer is artifact-agnostic). */
  sectionLabels: Record<string, string>;
}

export function DeliverableTraceabilityDrawer({
  open,
  onClose,
  block,
  protocolVersion = null,
  sectionLabels,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const isOpen = open && block !== null;

  // Don't subscribe ESC/backdrop unless the drawer is actually open.
  useOverlay({ isOpen, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  if (!isOpen || !block) return null;

  const sectionLabel = sectionLabels[block.section_key] ?? block.section_key;

  const hasAnyField =
    block.source_quote !== null ||
    block.source_section !== null ||
    block.source_page_number !== null ||
    block.confidence_state !== null ||
    protocolVersion !== null;

  const confidenceTone = (() => {
    switch (block.confidence_state) {
      case 'low':
        return isLight ? 'text-amber-700' : 'text-amber-400';
      case 'needs_review':
        return isLight ? 'text-rose-700' : 'text-rose-400';
      default:
        return 'text-fg-body';
    }
  })();

  return (
    <div
      data-testid="deliverable-traceability-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Protocol source for item in ${sectionLabel}`}
    >
      <div
        data-testid="deliverable-traceability-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-md h-full overflow-y-auto shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        <div
          className={`sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-center justify-between gap-3 ${
            isLight
              ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]'
              : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="min-w-0">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Protocol source
            </p>
            <h2 className="text-fg-heading text-sm font-semibold truncate">
              {block.display_text}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close traceability panel"
            className={`inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              isLight ? 'text-fg-sub hover:bg-[#E2E8F0]' : 'text-fg-sub hover:bg-white/[0.06]'
            }`}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {!hasAnyField && (
            <p className="text-fg-sub text-sm">
              No protocol source linkage for this item. PIQC framing and human
              notes carry no protocol provenance by design — only protocol
              facts do.
            </p>
          )}

          {block.source_quote && (
            <Section icon={<Quote size={13} />} label="Quoted from protocol">
              <blockquote
                data-testid="deliverable-source-quote"
                className={`text-fg-body text-sm italic leading-relaxed pl-3 border-l-2 ${
                  isLight ? 'border-[#CBD5E1]' : 'border-white/10'
                }`}
              >
                “{block.source_quote}”
              </blockquote>
            </Section>
          )}

          {(block.source_section !== null || block.source_page_number !== null) && (
            <Section icon={<FileText size={13} />} label="Protocol reference">
              {block.source_section && (
                <p className="text-fg-body text-sm">{block.source_section}</p>
              )}
              {block.source_page_number !== null && (
                <p className="text-fg-sub text-xs mt-0.5 tabular-nums">
                  Page {block.source_page_number}
                </p>
              )}
            </Section>
          )}

          {protocolVersion && (
            <Section icon={<GitBranch size={13} />} label="Protocol version">
              <p className="text-fg-body text-sm">{protocolVersion}</p>
            </Section>
          )}

          {block.confidence_state !== null && (
            <Section icon={<AlertTriangle size={13} />} label="Extraction confidence">
              <p
                data-testid="deliverable-traceability-confidence"
                className={`text-sm ${confidenceTone}`}
              >
                {CONFIDENCE_LABELS[block.confidence_state]}
              </p>
            </Section>
          )}

          <p
            className={`mt-6 pt-4 border-t text-fg-muted text-[11px] leading-relaxed ${
              isLight ? 'border-[#E2E8F0]' : 'border-white/5'
            }`}
          >
            This is a draft aid. Final verification against the protocol
            document is performed outside PIQC.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-1.5 mb-1 text-fg-label">
        {icon}
        <h3 className="text-[10px] uppercase tracking-wider font-semibold">{label}</h3>
      </div>
      <div>{children}</div>
    </section>
  );
}
