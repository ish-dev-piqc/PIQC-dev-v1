import { createContext, useContext, useEffect, useRef, useState } from 'react';
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
  timezone: string | null;        // protocols.timezone — IANA name. null = browser TZ fallback
}

interface ProtocolContextValue {
  protocols: Protocol[];
  isLoading: boolean;
  // null = Home (cross-protocol scope). Non-null = scoped to this protocol.
  activeProtocol: Protocol | null;
  setActiveProtocol: (protocol: Protocol | null) => void;
  // Explicit refetch for callers that just mutated a protocol and can't wait
  // on the postgres_changes channel — same rationale as SiteDataContext's
  // refresh(): realtime has been intermittently unreliable for INSERTs.
  refresh: () => void;
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
  refresh: () => {},
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

  // Guards against stale fetches clobbering fresh ones. When the demo toggle
  // flips, the effect re-runs load() while the active repo is still the real
  // one (the child effect fires before DemoModeProvider's setSiteRepo), then a
  // second load() runs after the swap. The real fetch (slow Supabase) can
  // resolve AFTER the demo fetch (fast in-memory) and overwrite the demo list.
  // A monotonic token means only the latest load() applies its result.
  const fetchTokenRef = useRef(0);
  const loadRef = useRef<() => void>(() => {});

  // Load protocols via the active SiteRepo (Supabase in real mode, demo store
  // in demo mode). Re-fetch on repo swap so flipping the demo toggle swaps
  // the picker contents immediately.
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const token = ++fetchTokenRef.current;
      setIsLoading(true);
      const result = await fetchProtocolsApi();
      if (cancelled || token !== fetchTokenRef.current) return;
      if (!result.ok) {
        console.error('[ProtocolContext] fetch error:', result.error);
      } else {
        setProtocols(result.data);
      }
      setIsLoading(false);
    }

    loadRef.current = load;
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

  const refresh = () => loadRef.current();

  return (
    <ProtocolContext.Provider value={{ protocols, isLoading, activeProtocol, setActiveProtocol, refresh }}>
      {children}
    </ProtocolContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProtocol() {
  return useContext(ProtocolContext);
}
