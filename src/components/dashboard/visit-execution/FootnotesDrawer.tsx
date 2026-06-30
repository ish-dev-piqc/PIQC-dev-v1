import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, BookMarked, AlertTriangle, FileText } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useTheme } from '../../../context/ThemeContext';
import { fetchSoaFootnotes } from '../../../lib/visit-execution/visitExecutionApi';
import type { SoaFootnote } from '../../../types/visit-execution';

// =============================================================================
// FootnotesDrawer — display-only Schedule-of-Activities footnotes.
//
// Right-edge drawer (mirrors EditLogDrawer / TraceabilityDrawer: useOverlay +
// useSwipeDismiss + a max-w-md panel). Shows the SoA footnote legends
// ("a. … b. … c. …") pulled verbatim from `chunks` via the
// get_protocol_soa_footnotes RPC — grouped by SoA section. NO structuring or
// linkage to procedures: it just surfaces the timing/condition/cohort caveats
// the grid parser drops so a coordinator can read them.
// =============================================================================

interface Props {
  protocolId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function FootnotesDrawer({ protocolId, isOpen, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [footnotes, setFootnotes] = useState<SoaFootnote[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Stable close — useOverlay keeps onClose in its deps; an inline arrow would
  // churn the focus-trap setup (the Sprint 4b lesson the other drawers follow).
  const guardedClose = useCallback(() => onClose(), [onClose]);

  useOverlay({ isOpen, onClose: guardedClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose: guardedClose });

  // Load on open; clear on close. cancelled-flag pattern (same as EditLogDrawer).
  useEffect(() => {
    if (!isOpen) {
      setFootnotes([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setFootnotes([]);
    fetchSoaFootnotes(protocolId).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setFootnotes(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, protocolId]);

  if (!isOpen) return null;

  // Group footnote chunks by SoA section (input order preserved by the RPC).
  const groups: { section: string; items: SoaFootnote[] }[] = [];
  for (const f of footnotes) {
    const last = groups[groups.length - 1];
    if (last && last.section === f.section) last.items.push(f);
    else groups.push({ section: f.section, items: [f] });
  }

  return (
    <div
      data-testid="vew-footnotes-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Schedule of Activities footnotes"
    >
      <div
        data-testid="vew-footnotes-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={guardedClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-md h-full flex flex-col shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Header */}
        <div
          className={`sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-start justify-between gap-3 ${
            isLight ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]' : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <BookMarked size={11} aria-hidden />
              Schedule of Activities
            </p>
            <h2 className="text-fg-heading text-sm font-semibold truncate mt-0.5">Footnotes</h2>
          </div>
          <button
            type="button"
            onClick={guardedClose}
            aria-label="Close drawer"
            className={`flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              isLight
                ? 'text-fg-sub hover:bg-[#E2E8F0] hover:text-fg-body'
                : 'text-fg-sub hover:bg-white/[0.06] hover:text-fg-body'
            }`}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-fg-sub text-xs">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Loading footnotes…
            </div>
          )}

          {loadError && (
            <div
              role="alert"
              data-testid="vew-footnotes-error"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
                isLight
                  ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
                  : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
              }`}
            >
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span className="flex-1 leading-relaxed">Couldn't load footnotes: {loadError}</span>
            </div>
          )}

          {!loading && !loadError && footnotes.length === 0 && (
            <p className="text-fg-sub text-xs leading-relaxed">
              No Schedule-of-Activities footnotes found for this protocol. Footnote details
              (timing windows, conditions, cohort caveats) may still be searchable in the Ask tab.
            </p>
          )}

          {groups.map((g, gi) => (
            <section key={`${g.section}-${gi}`} data-testid="vew-footnotes-group">
              {g.section && (
                <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-1.5">
                  {g.section}
                </p>
              )}
              <div className="space-y-2">
                {g.items.map((f, fi) => (
                  <div
                    key={fi}
                    className={`rounded-md border px-3 py-2.5 ${
                      isLight ? 'bg-white border-[#E2E8F0]' : 'bg-white/[0.02] border-white/5'
                    }`}
                  >
                    {f.page != null && (
                      <p className="text-fg-muted text-[10px] flex items-center gap-1 mb-1">
                        <FileText size={10} aria-hidden /> p. {f.page}
                      </p>
                    )}
                    <p className="text-fg-body text-xs leading-relaxed whitespace-pre-wrap">
                      {f.content}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
