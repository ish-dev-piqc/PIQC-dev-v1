import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

// =============================================================================
// ConfirmLeaveModal — shown by App.tsx's guarded-navigate handler when the
// user tries to switch modes (or workspace home, or sponsor) while there's
// unsaved work somewhere on the page. "Stay here" is the safe default
// emphasis; "Discard and leave" is the destructive primary.
// =============================================================================

interface ConfirmLeaveModalProps {
  /** Human-readable list of what's dirty — shown so the user knows what
   *  they're about to lose. From the DirtyStateContext registry. */
  dirtyLabels: string[];
  onStay: () => void;
  onLeave: () => void;
}

export default function ConfirmLeaveModal({
  dirtyLabels,
  onStay,
  onLeave,
}: ConfirmLeaveModalProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onStay();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onStay]);

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/40"
        onClick={onStay}
        aria-hidden="true"
      />
      <div className="fixed inset-0 z-[61] flex items-center justify-center p-4 pointer-events-none">
        <div
          className={`pointer-events-auto w-full max-w-sm rounded-lg border shadow-xl p-5 ${
            isLight
              ? 'bg-white border-[#E2E8F0]'
              : 'bg-[#0B1220] border-white/10'
          }`}
          role="dialog"
          aria-label="Confirm leaving"
        >
          <div className="flex items-start gap-3 mb-3">
            <span
              className="flex-shrink-0 mt-0.5"
              style={{ color: '#BA7517' }}
              aria-hidden="true"
            >
              <AlertTriangle size={20} />
            </span>
            <div className="min-w-0">
              <h2 className="text-fg-heading text-sm font-semibold mb-1">
                Leave without saving?
              </h2>
              <p className="text-fg-sub text-xs leading-relaxed">
                You have unsaved work in:
              </p>
              <ul className="text-fg-body text-xs mt-1.5 ml-3 list-disc">
                {dirtyLabels.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
              <p className="text-fg-sub text-xs mt-2 leading-relaxed">
                Switching modes will discard these changes.
              </p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <button
              type="button"
              onClick={onStay}
              autoFocus
              className={`text-xs font-medium px-3 py-1.5 rounded-md border ${
                isLight
                  ? 'border-[#E2E8F0] text-[#0F172A] hover:bg-[#0F172A]/[0.04]'
                  : 'border-white/10 text-white hover:bg-white/[0.04]'
              }`}
            >
              Stay here
            </button>
            <button
              type="button"
              onClick={onLeave}
              className="text-xs font-medium px-3 py-1.5 rounded-md text-white"
              style={{ background: '#BA7517' }}
            >
              Discard and leave
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
