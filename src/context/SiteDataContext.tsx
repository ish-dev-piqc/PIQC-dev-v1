// =============================================================================
// SiteDataContext — shared in-memory cache for Site Mode data.
//
// Holds participants, visits, team, and documents scoped to the active
// protocol. Re-fetches when activeProtocol.id changes or when the underlying
// SiteRepo swaps (demo toggle). Subscribes to:
//   - postgres_changes on each table in real mode
//   - demoStore in demo mode
//
// Cross-protocol scope (activeProtocol === null): fetches all rows so the
// Reports / Today cross-protocol view has data.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useProtocol } from './ProtocolContext';
import { useDemoMode } from './DemoModeContext';
import {
  fetchParticipants,
  fetchVisitsForProtocol,
  fetchTeamMembers,
  fetchProtocolDocuments,
  subscribeSiteRepo,
} from '../lib/site/siteApi';
import { getDemoStore } from '../lib/demo';
import type {
  SiteParticipant,
  SiteVisit,
  SiteTeamMember,
  ProtocolDocument,
} from '../lib/site/types';

// Enrich each visit's crossReferences with the document title, looked up
// against the documents we just fetched. The cross_references JSON stores
// document_id only — joining it client-side keeps the migration JSON small
// and avoids re-stamping titles into every visit row.
function enrichCrossRefs(visits: SiteVisit[], docs: ProtocolDocument[]): SiteVisit[] {
  if (visits.length === 0) return visits;
  const titleById = new Map(docs.map((d) => [d.id, d.title]));
  return visits.map((v) => {
    if (!v.crossReferences || v.crossReferences.length === 0) return v;
    const refs = v.crossReferences.map((r) => ({
      ...r,
      document_title:
        r.document_title ?? (r.document_id ? titleById.get(r.document_id) : undefined),
    }));
    return { ...v, crossReferences: refs };
  });
}

interface SiteDataContextValue {
  participants: SiteParticipant[];
  visits: SiteVisit[];
  teamMembers: SiteTeamMember[];
  documents: ProtocolDocument[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const SiteDataContext = createContext<SiteDataContextValue>({
  participants: [],
  visits: [],
  teamMembers: [],
  documents: [],
  loading: false,
  error: null,
  refresh: () => {},
});

export function SiteDataProvider({ children }: { children: React.ReactNode }) {
  const { activeProtocol, protocols } = useProtocol();
  const { demoActive } = useDemoMode();
  const [participants, setParticipants] = useState<SiteParticipant[]>([]);
  const [visits, setVisits] = useState<SiteVisit[]>([]);
  const [teamMembers, setTeamMembers] = useState<SiteTeamMember[]>([]);
  const [documents, setDocuments] = useState<ProtocolDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setVisits(enrichCrossRefs(allVisits, allDocs));
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
      setVisits(enrichCrossRefs(vr.data, dr.data));
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

  // Re-fetch when the active site repo swaps (demo toggle flipped). Without
  // this, flipping the toggle leaves cached data from the previous repo on
  // screen until the next protocol switch.
  useEffect(() => {
    return subscribeSiteRepo(() => refresh());
  }, [refresh]);

  // Realtime: in real mode, subscribe to Supabase postgres changes per scope.
  // In demo mode, subscribe to demoStore changes so mutations re-trigger
  // refresh without going through Supabase realtime (which the demo data
  // never hits anyway).
  useEffect(() => {
    if (demoActive) {
      return getDemoStore().subscribe(() => refresh());
    }

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
  }, [activeProtocol?.id, refresh, demoActive]);

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
      }}
    >
      {children}
    </SiteDataContext.Provider>
  );
}

export function useSiteData() {
  return useContext(SiteDataContext);
}
