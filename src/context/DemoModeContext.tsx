import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { setSiteRepo } from '../lib/site/siteApi';
import { realSiteRepo } from '../lib/site/repos/realSiteRepo';
import { demoSiteRepo } from '../lib/site/repos/demoSiteRepo';

// =============================================================================
// DemoModeContext — server-gated demo toggle.
//
// Two ingredients:
//   - localBit: user's local preference, persisted in localStorage. Defaults
//     to OFF so flagged users don't accidentally pitch live data.
//   - canUseDemo: derived from useAuth().profile.is_demo_user. Server is the
//     source of truth; if an admin revokes the flag, demoActive auto-falsifies
//     instantly regardless of the local bit.
//
// Effective `demoActive = localBit && canUseDemo`. setDemoActive(true) is a
// no-op for non-flagged users, so non-demo accounts cannot flip the bit even
// if they manage to render the toggle.
// =============================================================================

const STORAGE_KEY = 'piq-demo-active-v1';

interface DemoModeContextValue {
  demoActive: boolean;
  setDemoActive: (next: boolean) => void;
  canUseDemo: boolean;
}

const DemoModeContext = createContext<DemoModeContextValue>({
  demoActive: false,
  setDemoActive: () => {},
  canUseDemo: false,
});

export function DemoModeProvider({ children }: { children: React.ReactNode }) {
  const { profile } = useAuth();
  const canUseDemo = profile?.is_demo_user === true;

  const [localBit, setLocalBit] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, localBit ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [localBit]);

  const setDemoActive = useCallback(
    (next: boolean) => {
      if (next && !canUseDemo) return; // non-flagged users cannot enable
      setLocalBit(next);
    },
    [canUseDemo],
  );

  const demoActive = localBit && canUseDemo;

  // Flip the siteApi dispatcher whenever effective demoActive changes.
  // Subscribers (SiteDataContext, ProtocolContext) react via subscribeSiteRepo
  // and refresh their cached state.
  useEffect(() => {
    setSiteRepo(demoActive ? demoSiteRepo : realSiteRepo);
  }, [demoActive]);

  const value = useMemo<DemoModeContextValue>(
    () => ({ demoActive, setDemoActive, canUseDemo }),
    [demoActive, setDemoActive, canUseDemo],
  );

  return <DemoModeContext.Provider value={value}>{children}</DemoModeContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDemoMode() {
  return useContext(DemoModeContext);
}
