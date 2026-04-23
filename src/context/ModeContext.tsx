import { createContext, useContext, useEffect, useState } from 'react';

export type DashboardMode = 'site' | 'audit';

interface ModeContextValue {
  mode: DashboardMode;
  setMode: (mode: DashboardMode) => void;
}

const MODE_STORAGE_KEY = 'piq-mode-v1';

const ModeContext = createContext<ModeContextValue>({
  mode: 'site',
  setMode: () => {},
});

export function ModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<DashboardMode>(() => {
    try {
      const stored = localStorage.getItem(MODE_STORAGE_KEY);
      return stored === 'audit' ? 'audit' : 'site';
    } catch {
      return 'site';
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, [mode]);

  const setMode = (next: DashboardMode) => setModeState(next);

  return (
    <ModeContext.Provider value={{ mode, setMode }}>
      {children}
    </ModeContext.Provider>
  );
}

export function useMode() {
  return useContext(ModeContext);
}
