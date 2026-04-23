import { createContext, useContext, useEffect, useState } from 'react';

export interface Protocol {
  id: string;
  code: string;
  name: string;
  sponsor: string;
  phase: string;
}

interface ProtocolContextValue {
  protocols: Protocol[];
  // null = Home (cross-protocol scope). Non-null = scoped to this protocol.
  activeProtocol: Protocol | null;
  setActiveProtocol: (protocol: Protocol | null) => void;
}

const PROTOCOL_STORAGE_KEY = 'piq-protocol-v1';
const HOME_SENTINEL = 'home';

// Mock protocols — will be replaced with real data from Supabase later.
const MOCK_PROTOCOLS: Protocol[] = [
  {
    id: 'proto-001',
    code: 'BRIGHTEN-2',
    name: 'BRIGHTEN-2: Phase 3 Oncology Study',
    sponsor: 'Helix Therapeutics',
    phase: 'Phase 3',
  },
  {
    id: 'proto-002',
    code: 'CARDIAC-7',
    name: 'CARDIAC-7: Heart Failure Intervention',
    sponsor: 'NovaCardio',
    phase: 'Phase 2b',
  },
  {
    id: 'proto-003',
    code: 'IMMUNE-14',
    name: 'IMMUNE-14: Autoimmune Biologic Trial',
    sponsor: 'Veridex Bio',
    phase: 'Phase 2',
  },
];

const ProtocolContext = createContext<ProtocolContextValue>({
  protocols: MOCK_PROTOCOLS,
  activeProtocol: null,
  setActiveProtocol: () => {},
});

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(PROTOCOL_STORAGE_KEY);
      if (stored === HOME_SENTINEL) return HOME_SENTINEL;
      if (stored && MOCK_PROTOCOLS.some((p) => p.id === stored)) return stored;
    } catch {
      /* ignore */
    }
    return HOME_SENTINEL;
  });

  useEffect(() => {
    try {
      localStorage.setItem(PROTOCOL_STORAGE_KEY, activeId);
    } catch {
      /* ignore */
    }
  }, [activeId]);

  const activeProtocol =
    activeId === HOME_SENTINEL ? null : MOCK_PROTOCOLS.find((p) => p.id === activeId) ?? null;

  const setActiveProtocol = (protocol: Protocol | null) => {
    setActiveId(protocol ? protocol.id : HOME_SENTINEL);
  };

  return (
    <ProtocolContext.Provider
      value={{
        protocols: MOCK_PROTOCOLS,
        activeProtocol,
        setActiveProtocol,
      }}
    >
      {children}
    </ProtocolContext.Provider>
  );
}

export function useProtocol() {
  return useContext(ProtocolContext);
}
