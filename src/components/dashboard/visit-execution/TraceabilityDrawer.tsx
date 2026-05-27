import { useRef } from 'react';
import { X, FileText, MapPin, Quote, GitBranch } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useTheme } from '../../../context/ThemeContext';
import type { VisitExecutionItem } from '../../../types/visit-execution';

// =============================================================================
// TraceabilityDrawer — right-edge slide-in panel that answers
// "why is this requirement here?". Follows the SourceTruthDrawer pattern
// exactly: useOverlay (ESC + backdrop), useSwipeDismiss (mobile swipe-right),
// z-50, max-w-md panel. One instance owned by VisitExecutionTab, opens with
// the selected item or null.
//
// Sprint 1: renders the item's traceability object directly — SoA column,
// protocol section, protocol page, amendment version, and any cross-reference
// snippet derived from protocol_visit_templates.cross_references. No
// network fetch needed; the trace data ships inside the workspace.
//
// Polish-v2 (2026-05-27): tighter section label spacing, lighter footer
// disclaimer, page-citation line uses tabular-nums + better alignment with
// the section-name. Goal per feedback_vew_cognitive_load_test.md: each
// section reads as a single visual unit rather than label-plus-body-plus-
// gap-plus-label.
// =============================================================================

interface Props {
  item: VisitExecutionItem | null;
  onClose: () => void;
}

export default function TraceabilityDrawer({ item, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Don't subscribe ESC/backdrop unless the drawer is actually open.
  useOverlay({ isOpen: item !== null, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  if (!item) return null;

  const t = item.traceability;
  const hasAnyField =
    t.soa_column ||
    t.protocol_section ||
    t.protocol_page !== null ||
    t.amendment_version ||
    t.cross_reference_source_section ||
    t.cross_reference_snippet;

  return (
    <div
      data-testid="vew-traceability-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Protocol source for ${item.label}`}
    >
      <div
        data-testid="vew-traceability-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-md h-full overflow-y-auto shadow-xl border-l ${
          isLight
            ? 'bg-[#f5f7fa] border-[#e2e8ee]'
            : 'bg-[#0d1118] border-white/5'
        }`}
      >
        <div
          className={`sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-center justify-between gap-3 ${
            isLight
              ? 'bg-[#f5f7fa]/95 border-[#e2e8ee]'
              : 'bg-[#0d1118]/95 border-white/5'
          }`}
        >
          <div className="min-w-0">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
              Protocol source
            </p>
            <h2 className="text-fg-heading text-sm font-semibold truncate">
              {item.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close traceability panel"
            className={`inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              isLight
                ? 'text-fg-sub hover:bg-[#e2e8ee]'
                : 'text-fg-sub hover:bg-white/[0.06]'
            }`}
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {!hasAnyField && (
            <p className="text-fg-sub text-sm">
              No protocol source linkage available for this requirement yet.
              Source evidence will populate once the structured ingest extraction
              is connected.
            </p>
          )}

          {(t.protocol_section || t.protocol_page !== null) && (
            <Section icon={<FileText size={13} />} label="Protocol reference">
              {t.protocol_section && (
                <p className="text-fg-body text-sm">{t.protocol_section}</p>
              )}
              {t.protocol_page !== null && (
                <p className="text-fg-sub text-xs mt-0.5">
                  Page {t.protocol_page}
                </p>
              )}
            </Section>
          )}

          {t.soa_column && (
            <Section icon={<MapPin size={13} />} label="Schedule of Assessments">
              <p className="text-fg-body text-sm">Column {t.soa_column}</p>
            </Section>
          )}

          {t.amendment_version && (
            <Section icon={<GitBranch size={13} />} label="Protocol version">
              <p className="text-fg-body text-sm">{t.amendment_version}</p>
            </Section>
          )}

          {(t.cross_reference_source_section || t.cross_reference_snippet) && (
            <Section icon={<Quote size={13} />} label="From the protocol documents">
              {t.cross_reference_source_section && (
                <p className="text-fg-sub text-[11px] mb-1.5 tabular-nums">
                  <span className="text-fg-label uppercase tracking-wider font-semibold">
                    {t.cross_reference_source_section}
                  </span>
                  {t.cross_reference_page !== null && (
                    <span className="ml-1 text-fg-muted">· p.{t.cross_reference_page}</span>
                  )}
                </p>
              )}
              {t.cross_reference_snippet && (
                <blockquote
                  className={`text-fg-body text-sm leading-relaxed pl-3 border-l-2 ${
                    isLight ? 'border-[#cbd2db]' : 'border-white/10'
                  }`}
                >
                  {t.cross_reference_snippet}
                </blockquote>
              )}
            </Section>
          )}

          <p
            className={`mt-6 pt-4 border-t text-fg-muted text-[11px] leading-relaxed ${
              isLight ? 'border-[#e2e8ee]' : 'border-white/5'
            }`}
          >
            Final source-document verification is performed outside PIQC.
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
      {/* Polish-v2: label gap tightened (mb-1.5 → mb-1) so the label reads
          as belonging-to its body rather than floating above it. */}
      <div className="flex items-center gap-1.5 mb-1 text-fg-label">
        {icon}
        <h3 className="text-[10px] uppercase tracking-wider font-semibold">
          {label}
        </h3>
      </div>
      <div>{children}</div>
    </section>
  );
}
