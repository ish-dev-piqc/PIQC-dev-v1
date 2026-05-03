import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

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

const PHASE_LABELS: Record<string, string> = {
  PHASE_1:       'Phase 1',
  PHASE_1_2:     'Phase 1/2',
  PHASE_2:       'Phase 2',
  PHASE_2_3:     'Phase 2/3',
  PHASE_3:       'Phase 3',
  PHASE_4:       'Phase 4',
  NOT_APPLICABLE: 'N/A',
};

function phaseLabel(raw: string | null | undefined): string {
  return raw ? (PHASE_LABELS[raw] ?? raw) : '';
}

// ---------------------------------------------------------------------------
// Row shape returned by the Supabase query
// ---------------------------------------------------------------------------
interface ProtocolRow {
  id: string;
  study_number: string | null;
  title: string;
  sponsor: string;
  protocol_versions: { clinical_trial_phase: string; status: string }[];
}

function rowToProtocol(row: ProtocolRow): Protocol {
  const activeVersion = row.protocol_versions.find((v) => v.status === 'ACTIVE');
  return {
    id: row.id,
    code: row.study_number ?? '',
    name: row.title,
    sponsor: row.sponsor,
    phase: phaseLabel(activeVersion?.clinical_trial_phase),
  };
}

// ---------------------------------------------------------------------------
// Context default (empty — provider always fills this in)
// ---------------------------------------------------------------------------
const ProtocolContext = createContext<ProtocolContextValue>({
  protocols: [],
  activeProtocol: null,
  setActiveProtocol: () => {},
});

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
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

  // Fetch protocols + realtime subscription
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase
        .from('protocols')
        .select('id, study_number, title, sponsor, protocol_versions(clinical_trial_phase, status)')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[ProtocolContext] fetch error:', error);
        return;
      }
      if (data) setProtocols((data as unknown as ProtocolRow[]).map(rowToProtocol));
    }

    load();

    const channel = supabase
      .channel('protocols-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'protocols' }, () => {
        load();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // If the stored ID is no longer in the list after load, it resolves to null (Home).
  const activeProtocol =
    activeId === HOME_SENTINEL ? null : (protocols.find((p) => p.id === activeId) ?? null);

  const setActiveProtocol = (protocol: Protocol | null) => {
    setActiveId(protocol ? protocol.id : HOME_SENTINEL);
  };

  return (
    <ProtocolContext.Provider value={{ protocols, activeProtocol, setActiveProtocol }}>
      {children}
    </ProtocolContext.Provider>
  );
}

export function useProtocol() {
  return useContext(ProtocolContext);
}
