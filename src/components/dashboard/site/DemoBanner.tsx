import { Beaker, RotateCcw, X } from 'lucide-react';
import { useDemoMode } from '../../../context/DemoModeContext';
import { useTheme } from '../../../context/ThemeContext';
import { getDemoStore } from '../../../lib/demo';

// =============================================================================
// DemoBanner — sits below the Navbar whenever demo mode is active. Surfaces
// two actions:
//   - Reset: wipes session-stored mutations and re-seeds fixtures. Useful
//     mid-pitch if the demoer accidentally deleted something or wants a
//     clean slate before the next viewer.
//   - Exit: flips demoActive off; the toggle remains accessible in the
//     navbar dropdown to re-enable.
// =============================================================================

export default function DemoBanner() {
  const { demoActive, setDemoActive } = useDemoMode();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  if (!demoActive) return null;

  const handleReset = () => {
    getDemoStore().reset();
  };

  const handleExit = () => {
    setDemoActive(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full px-4 py-2 flex items-center justify-center gap-3 text-xs font-medium ${
        isLight
          ? 'bg-amber-500/15 border-b border-amber-500/30 text-amber-900'
          : 'bg-amber-500/15 border-b border-amber-400/30 text-amber-200'
      }`}
    >
      <Beaker size={14} className="flex-shrink-0" />
      <span>
        <span className="font-semibold">Demo mode</span> — sample data only. Mutations don't
        persist across sessions.
      </span>
      <div className="flex items-center gap-1 ml-2">
        <button
          onClick={handleReset}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
            isLight
              ? 'border-amber-600/30 hover:bg-amber-500/20'
              : 'border-amber-400/30 hover:bg-amber-400/20'
          }`}
          title="Wipe demo mutations and re-seed fixtures"
        >
          <RotateCcw size={11} />
          Reset
        </button>
        <button
          onClick={handleExit}
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors ${
            isLight
              ? 'border-amber-600/30 hover:bg-amber-500/20'
              : 'border-amber-400/30 hover:bg-amber-400/20'
          }`}
          title="Exit demo mode"
        >
          <X size={11} />
          Exit
        </button>
      </div>
    </div>
  );
}
