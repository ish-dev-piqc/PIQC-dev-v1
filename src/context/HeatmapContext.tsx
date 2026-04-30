import { createContext, useContext, useEffect, useState } from 'react';

// =============================================================================
// HeatmapContext — global toggle for the heatmap layer.
//
// Per the UX spec the layer is default ON and toggleable. Persists per-user
// via localStorage. Components consume `enabled` to decide whether to render
// HeatIndicator instances at all.
// =============================================================================

interface HeatmapContextValue {
  enabled: boolean;
  setEnabled: (next: boolean) => void;
  toggle: () => void;
}

const HEATMAP_STORAGE_KEY = 'piq-heatmap-v1';

const HeatmapContext = createContext<HeatmapContextValue>({
  enabled: true,
  setEnabled: () => {},
  toggle: () => {},
});

export function HeatmapProvider({ children }: { children: React.ReactNode }) {
  const [enabled, setEnabledState] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(HEATMAP_STORAGE_KEY);
      if (stored === 'off') return false;
      if (stored === 'on') return true;
    } catch {
      /* ignore */
    }
    // UX spec default: ON
    return true;
  });

  useEffect(() => {
    try {
      localStorage.setItem(HEATMAP_STORAGE_KEY, enabled ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  }, [enabled]);

  const setEnabled = (next: boolean) => setEnabledState(next);
  const toggle = () => setEnabledState((v) => !v);

  return (
    <HeatmapContext.Provider value={{ enabled, setEnabled, toggle }}>
      {children}
    </HeatmapContext.Provider>
  );
}

export function useHeatmap() {
  return useContext(HeatmapContext);
}
