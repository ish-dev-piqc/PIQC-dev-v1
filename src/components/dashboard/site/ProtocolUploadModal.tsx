import { useRef } from 'react';
import { X } from 'lucide-react';
import { UploadForm } from '../KnowledgeBase';
import { useTheme } from '../../../context/ThemeContext';
import { useOverlay } from '../../../hooks/useOverlay';

// =============================================================================
// ProtocolUploadModal — opened from the Navbar protocol picker's "Upload
// protocol" entry. Replaces the previous manual AddProtocolModal. Wraps the
// existing UploadForm in a modal shell so the user can upload a new protocol
// (or an amendment / supplementary doc) without leaving their current tab.
//
// New protocols: leave the picker on "No protocol — auto-link from extracted
// fields" so the ingest function's B2.4 path creates the protocols row inline
// from Reducto's extracted metadata.
//
// Amendments / supplementary docs (IB, lab manual, pharmacy manual): pick the
// existing protocol so Phase B cross-reference fan-out can link them.
// =============================================================================

interface ProtocolUploadModalProps {
  onClose: () => void;
}

export default function ProtocolUploadModal({ onClose }: ProtocolUploadModalProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const overlay = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });

  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';

  return (
    <div
      ref={overlay}
      onClick={(e) => {
        if (e.target === overlay.current) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/40 flex items-start sm:items-center justify-center p-4 overflow-y-auto animate-fade-in"
    >
      <div
        ref={panelRef}
        className={`w-full max-w-2xl ${bg} border ${border} rounded-2xl shadow-xl my-8 animate-fade-in`}
      >
        <div className={`flex items-center justify-between px-5 py-4 border-b ${border}`}>
          <div>
            <h2 className={`${headingColor} font-semibold text-base`}>Upload protocol</h2>
            <p className={`${subColor} text-xs mt-0.5`}>
              We parse the PDF and populate Site Mode automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${subColor} hover:opacity-75 ml-4 flex-shrink-0`}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5">
          <UploadForm isLight={isLight} onSuccess={onClose} />
        </div>
      </div>
    </div>
  );
}
