// =============================================================================
// SiteDataContext — shared in-memory cache for Site Mode data.
//
// Holds participants, visits, team, and documents scoped to the active
// protocol. Re-fetches when activeProtocol.id changes. Subscribes to
// postgres_changes on each table for realtime updates.
//
// Cross-protocol scope (activeProtocol === null): fetches all rows so the
// Reports / Today cross-protocol view has data.
//
// A "Demo data" toggle preserved for offline screenshots — when on, the
// `visits` stream is synthesised from MOCK_VISITS. Participants, team, and
// documents always come from Supabase.
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

// Mock-mode protocol-id mapping. The MOCK_VISITS fixture uses synthetic
// protocol IDs ("proto-001" etc); we map those back to a live protocol's
// code so single-protocol scoping still finds rows.
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
  // reports stat cards). Participants, team, and documents always come from
  // Supabase.
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

  // When the toggle is ON we synthesise a SiteVisit[] from MOCK_VISITS,
  // remapping the synthetic mock protocol IDs to whichever live protocol's
  // code matches so single-protocol scoping still produces rows.
  const visits: SiteVisit[] = useMemo(() => {
    if (!useMockCalendar) return realVisits;
    const codeToId: Record<string, string> = {};
    for (const p of protocols) {
      if (p.code) codeToId[p.code] = p.id;
    }
    return MOCK_VISITS.map((v) => {
      const code = MOCK_TO_CODE[v.protocolId];
      const remappedId = code && codeToId[code] ? codeToId[code] : v.protocolId;
      return {
        id: v.id,
        date: v.date,
        time: v.time,
        protocolId: remappedId,
        participantId: v.participantId,
        studyDay: v.studyDay,
        visitName: v.visitName,
        windowCloses: v.windowCloses,
        status: v.status,
        procedures: v.procedures,
        priorNote: v.priorNote,
        deviationReason: v.deviationReason,
      };
    });
  }, [useMockCalendar, realVisits, protocols]);

  // ---------------------------------------------------------------------------
  // Fetch on activeProtocol change. Use a ref so concurrent fetches don't
  // race when the user flips protocols quickly.
  // ---------------------------------------------------------------------------
  const fetchTokenRef = useRef(0);

  const refresh = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const pid = activeProtocol?.id ?? null;
      if (!pid) {
        // Cross-protocol scope — fetch all rows for surfaces that need
        // them (TodayTab All Protocols view, ReportsTab across protocols).
        // We do that by issuing the same per-protocol fetches across every
        // protocol in the list, then concatenating.
        const allParticipants: SiteParticipant[] = [];
        const allVisits: SiteVisit[] = [];
        const allTeam: SiteTeamMember[] = [];
        const allDocs: ProtocolDocument[] = [];
        for (const p of protocols) {
          const [pr, vr, tr, dr] = await Promise.all([
            fetchParticipants(p.id),
            fetchVisitsForProtocol(p.id),
            fetchTeamMembers(p.id),
            fetchProtocolDocuments(p.id),
          ]);
          if (pr.ok) allParticipants.push(...pr.data);
          if (vr.ok) allVisits.push(...vr.data);
          if (tr.ok) allTeam.push(...tr.data);
          if (dr.ok) allDocs.push(...dr.data);
        }
        if (token !== fetchTokenRef.current) return;
        setParticipants(allParticipants);
        setRealVisits(allVisits);
        setTeamMembers(allTeam);
        setDocuments(allDocs);
        return;
      }

      const [pr, vr, tr, dr] = await Promise.all([
        fetchParticipants(pid),
        fetchVisitsForProtocol(pid),
        fetchTeamMembers(pid),
        fetchProtocolDocuments(pid),
      ]);
      if (token !== fetchTokenRef.current) return;
      if (!pr.ok) throw new Error(pr.error);
      if (!vr.ok) throw new Error(vr.error);
      if (!tr.ok) throw new Error(tr.error);
      if (!dr.ok) throw new Error(dr.error);
      setParticipants(pr.data);
      setRealVisits(vr.data);
      setTeamMembers(tr.data);
      setDocuments(dr.data);
    } catch (e) {
      if (token !== fetchTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === fetchTokenRef.current) setLoading(false);
    }
  }, [activeProtocol?.id, protocols]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Realtime: one channel per active scope. Re-runs when scope changes.
  useEffect(() => {
    const channel = supabase.channel(`site-data-${activeProtocol?.id ?? 'all'}`);
    const pid = activeProtocol?.id ?? null;

    if (pid) {
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_participants', filter: `protocol_id=eq.${pid}` },
          () => refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_visits', filter: `protocol_id=eq.${pid}` },
          () => refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_team_members', filter: `protocol_id=eq.${pid}` },
          () => refresh(),
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'documents', filter: `protocol_id=eq.${pid}` },
          () => refresh(),
        );
    } else {
      // Cross-protocol scope — subscribe without filter; refresh fans out.
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_participants' }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_visits' }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_team_members' }, () => refresh())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => refresh());
    }

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeProtocol?.id, refresh]);

  return (
    <SiteDataContext.Provider
      value={{
        participants,
        visits,
        teamMembers,
        documents,
        loading,
        error,
        refresh,
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
