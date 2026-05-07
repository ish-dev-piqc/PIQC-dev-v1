// =============================================================================
// SiteDataContext — shared in-memory cache for Site Mode data.
//
// Holds participants, visits, team, and documents scoped to the active
// protocol. Re-fetches when activeProtocol.id changes. Subscribes to
// postgres_changes on each table for realtime updates.
//
// Cross-protocol scope (activeProtocol === null): fetches all rows so the
// Reports / Today cross-protocol view has data.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useProtocol } from './ProtocolContext';
import {
  fetchParticipants,
  fetchVisitsForProtocol,
  fetchTeamMembers,
  fetchProtocolDocuments,
} from '../lib/site/siteApi';
import type {
  SiteParticipant,
  SiteVisit,
  SiteTeamMember,
  ProtocolDocument,
} from '../lib/site/types';
import { MOCK_VISITS } from '../lib/mockCalendarData';

const MOCK_TOGGLE_KEY = 'piq-site-mock-calendar-v1';

// When the demo toggle is ON, the visits stream comes from this in-memory
// fixture. The mock array uses participant codes (P-0019 etc) and mock
// protocol IDs (proto-001 etc) so the calendar UI can colour and label them
// without DB joins.
//
// Map mock protocol IDs to live protocol codes so single-protocol scoping
// still shows mock data when active protocol matches a known mock series.
const MOCK_TO_CODE: Record<string, string> = {
  'proto-001': 'BRIGHTEN-2',
  'proto-002': 'CARDIAC-7',
  'proto-003': 'IMMUNE-14',
};

interface SiteDataContextValue {
  participants: SiteParticipant[];
  visits: SiteVisit[];
  teamMembers: SiteTeamMember[];
  documents: ProtocolDocument[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  // Demo toggle — controls only the visits stream (calendar / visits list /
  // reports stat cards). Participants, team, and documents are always live.
  useMockCalendar: boolean;
  setUseMockCalendar: (v: boolean) => void;
}

const SiteDataContext = createContext<SiteDataContextValue>({
  participants: [],
  visits: [],
  teamMembers: [],
  documents: [],
  loading: false,
  error: null,
  refresh: () => {},
  useMockCalendar: false,
  setUseMockCalendar: () => {},
});

export function SiteDataProvider({ children }: { children: React.ReactNode }) {
  const { activeProtocol, protocols } = useProtocol();
  const [participants, setParticipants] = useState<SiteParticipant[]>([]);
  const [realVisits, setRealVisits] = useState<SiteVisit[]>([]);
  const [teamMembers, setTeamMembers] = useState<SiteTeamMember[]>([]);
  const [documents, setDocuments] = useState<ProtocolDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [useMockCalendar, setUseMockCalendarState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(MOCK_TOGGLE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const setUseMockCalendar = useCallback((v: boolean) => {
    setUseMockCalendarState(v);
    try {
      localStorage.setItem(MOCK_TOGGLE_KEY, v ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  // When toggle is ON: synthesise a SiteVisit[] from MOCK_VISITS, optionally
  // remapping mock protocolIds to the active protocol's UUID so that
  // tab-level filtering by activeProtocol.id still finds rows.
  const visits: SiteVisit[] = useMemo(() => {
    if (!useMockCalendar) return realVisits;
    const codeToId: Record<string, string> = {};
    for (const p of protocols) codeToId[p.code] = p.id;
    return MOCK_VISITS.map((v) => {
      const code = MOCK_TO_CODE[v.protocolId];
      const remappedId = code ? codeToId[code] ?? v.protocolId : v.protocolId;
      return { ...v, protocolId: remappedId };
    });
  }, [useMockCalendar, realVisits, protocols]);

  // Track the latest in-flight load so stale results don't overwrite newer ones
  // when the user switches protocols quickly.
  const loadIdRef = useRef(0);

  const load = useCallback(async () => {
    const myId = ++loadIdRef.current;
    setLoading(true);
    setError(null);

    // Cross-protocol scope: fetch across every protocol the user can see.
    const targetIds = activeProtocol ? [activeProtocol.id] : protocols.map((p) => p.id);

    if (targetIds.length === 0) {
      setParticipants([]);
      setRealVisits([]);
      setTeamMembers([]);
      setDocuments([]);
      setLoading(false);
      return;
    }

    const results = await Promise.all(
      targetIds.flatMap((pid) => [
        fetchParticipants(pid),
        fetchVisitsForProtocol(pid),
        fetchTeamMembers(pid),
        fetchProtocolDocuments(pid),
      ]),
    );

    // Stale-result guard.
    if (myId !== loadIdRef.current) return;

    const errors: string[] = [];
    const allParticipants: SiteParticipant[] = [];
    const allVisits: SiteVisit[] = [];
    const allTeam: SiteTeamMember[] = [];
    const allDocs: ProtocolDocument[] = [];

    results.forEach((r, idx) => {
      if (!r.ok) {
        errors.push(r.error);
        return;
      }
      const slot = idx % 4;
      if (slot === 0) allParticipants.push(...(r.data as SiteParticipant[]));
      else if (slot === 1) allVisits.push(...(r.data as SiteVisit[]));
      else if (slot === 2) allTeam.push(...(r.data as SiteTeamMember[]));
      else allDocs.push(...(r.data as ProtocolDocument[]));
    });

    setParticipants(allParticipants);
    setRealVisits(allVisits);
    setTeamMembers(allTeam);
    setDocuments(allDocs);
    setError(errors.length > 0 ? errors.join('; ') : null);
    setLoading(false);
  }, [activeProtocol, protocols]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: one channel per active scope. Re-runs when scope changes.
  useEffect(() => {
    const targetIds = activeProtocol ? [activeProtocol.id] : protocols.map((p) => p.id);
    if (targetIds.length === 0) return;

    const channel = supabase.channel(`site-data-${activeProtocol?.id ?? 'all'}`);

    // For each protocol in scope, subscribe to its slice of every site_* table.
    // Filtering server-side keeps us from getting events for unrelated protocols.
    for (const pid of targetIds) {
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_participants', filter: `protocol_id=eq.${pid}` },
          () => load(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_visits', filter: `protocol_id=eq.${pid}` },
          () => load(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_team_members', filter: `protocol_id=eq.${pid}` },
          () => load(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'documents', filter: `protocol_id=eq.${pid}` },
          () => load(),
        );
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // load is wrapped in useCallback with the same deps, so this is fine.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProtocol, protocols]);

  return (
    <SiteDataContext.Provider
      value={{
        participants,
        visits,
        teamMembers,
        documents,
        loading,
        error,
        refresh: load,
        useMockCalendar,
        setUseMockCalendar,
      }}
    >
      {children}
    </SiteDataContext.Provider>
  );
}

export function useSiteData() {
  return useContext(SiteDataContext);
}
