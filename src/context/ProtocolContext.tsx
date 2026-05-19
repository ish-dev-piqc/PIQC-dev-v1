import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { fetchProtocols as fetchProtocolsApi, subscribeSiteRepo } from '../lib/site/siteApi';
import { useDemoMode } from './DemoModeContext';
import { getDemoStore } from '../lib/demo';

export interface Protocol {
  id: string;
  code: string;
  name: string;
  sponsor: string;
  phase: string;
  demoAnchorDate: string | null;  // protocols.demo_anchor_date — for visit projection
}

interface ProtocolContextValue {
  protocols: Protocol[];
  isLoading: boolean;
  // null = Home (cross-protocol scope). Non-null = scoped to this protocol.
  activeProtocol: Protocol | null;
  setActiveProtocol: (protocol: Protocol | null) => void;
}

const PROTOCOL_STORAGE_KEY = 'piq-protocol-v1';
const HOME_SENTINEL = 'home';

// rowToProtocol + the supabase select for protocols moved to realSiteRepo.
// This provider just calls fetchProtocols() and the active SiteRepo handles
// the rest (real → Supabase; demo → in-memory store).

// ---------------------------------------------------------------------------
// Context default (empty — provider always fills this in)
// ---------------------------------------------------------------------------
const ProtocolContext = createContext<ProtocolContextValue>({
  protocols: [],
  isLoading: false,
  activeProtocol: null,
  setActiveProtocol: () => {},
});

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const { demoActive } = useDemoMode();
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      return localStorage.getItem(PROTOCOL_STORAGE_KEY) ?? HOME_SENTINEL;
    } catch {
      return HOME_SENTINEL;
    }
  });

  // Persist active selection
  useEffect(() => {
    try {
      localStorage.setItem(PROTOCOL_STORAGE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  // Load protocols via the active SiteRepo (Supabase in real mode, demo store
  // in demo mode). Re-fetch on repo swap so flipping the demo toggle swaps
  // the picker contents immediately.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      const result = await fetchProtocolsApi();
      if (cancelled) return;
      if (!result.ok) {
        console.error('[ProtocolContext] fetch error:', result.error);
      } else {
        setProtocols(result.data);
      }
      setIsLoading(false);
    }

    load();
    const unsubRepoSwap = subscribeSiteRepo(load);

    // Realtime: Supabase channel in real mode, demoStore subscription in demo.
    let cleanupChannel: (() => void) | undefined;
    if (demoActive) {
      cleanupChannel = getDemoStore().subscribe(load);
    } else {
      const channel = supabase
        .channel('protocols-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'protocols' }, load)
        .subscribe();
      cleanupChannel = () => {
        supabase.removeChannel(channel);
      };
    }

    return () => {
      cancelled = true;
      unsubRepoSwap();
      cleanupChannel?.();
    };
  }, [demoActive]);

  // If the stored ID is no longer in the list after load, it resolves to null (Home).
  const activeProtocol =
    activeId === HOME_SENTINEL ? null : (protocols.find((p) => p.id === activeId) ?? null);

  const setActiveProtocol = (protocol: Protocol | null) => {
    setActiveId(protocol ? protocol.id : HOME_SENTINEL);
  };

  return (
    <ProtocolContext.Provider value={{ protocols, isLoading, activeProtocol, setActiveProtocol }}>
      {children}
    </ProtocolContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProtocol() {
  return useContext(ProtocolContext);
}
