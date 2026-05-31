import { useRef } from 'react';
import { X, Database } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useTheme } from '../../../context/ThemeContext';
import ProtocolTab from '../site/ProtocolTab';

// =============================================================================
// ProtocolDrawer — the former "Protocol" tab, now opened as a wide right-edge
// drawer from inside Visit Prep. Follows the TraceabilityDrawer/SourceTruthDrawer
// pattern (useOverlay + useSwipeDismiss, z-50) but uses a wider panel
// (max-w-3xl) because ProtocolTab is a full scrolling page (metadata + schedule
// + WorksheetItemsList), not a narrow detail panel.
//
// ProtocolTab is fully self-contained (pure ProtocolContext + SiteDataContext),
// so it drops in unchanged. The panel is overflow-hidden and ProtocolTab owns
// its own scroll so there's a single scrollbar.
// =============================================================================

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ProtocolDrawer({ isOpen, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  useOverlay({ isOpen, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  if (!isOpen) return null;

  return (
    <div
      data-testid="protocol-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Protocol details"
    >
      <div
        data-testid="protocol-drawer-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-3xl h-full flex flex-col shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        <div
          className={`flex-shrink-0 sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-center justify-between gap-3 ${
            isLight ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]' : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="min-w-0 flex items-center gap-2">
            <Database size={15} className="text-brand-300 flex-shrink-0" />
            <h2 className="text-fg-heading text-sm font-semibold truncate">Protocol</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close protocol panel"
            className={`inline-flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              isLight ? 'text-fg-sub hover:bg-[#E2E8F0]' : 'text-fg-sub hover:bg-white/[0.06]'
            }`}
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <ProtocolTab />
        </div>
      </div>
    </div>
  );
}
