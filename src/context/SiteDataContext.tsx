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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

  // The cross-protocol (activeProtocol === null) branch fans out over the whole
  // protocols list. We must NOT put `protocols` in refresh's dep array: its
  // array identity changes on every ProtocolContext load() (including unrelated,
  // org-wide realtime-triggered reloads via the unfiltered protocols-changes
  // channel), which would churn refresh's identity and needlessly re-run the
  // fetch + realtime-resubscribe effects below — even when scoped to a single
  // protocol that didn't change.
  //
  // Instead: depend on a content-stable `protocolIds` key (only changes when the
  // actual set of protocol ids changes, which is the only thing the cross-scope
  // branch reads from each protocol), and read the *live* array through a ref at
  // call time so the fan-out always sees current data (staleness-safe).
  const protocolsRef = useRef(protocols);
  protocolsRef.current = protocols;
  const protocolIds = useMemo(() => protocols.map((p) => p.id).join(','), [protocols]);

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
        // A protocol whose fetches partially fail must not silently vanish
        // from the merged view — that renders indistinguishable from "this
        // protocol has no visits". Track failures and surface an aggregate
        // error alongside the partial data (the single-protocol branch below
        // already throws → setError; this keeps the two branches honest).
        let failedProtocols = 0;
        // Read live protocols via ref — see protocolsRef note above.
        for (const p of protocolsRef.current) {
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
          if (!pr.ok || !vr.ok || !tr.ok || !dr.ok) failedProtocols++;
        }
        if (token !== fetchTokenRef.current) return;
        setParticipants(allParticipants);
        setVisits(enrichCrossRefs(allVisits, allDocs));
        setTeamMembers(allTeam);
        setDocuments(allDocs);
        if (failedProtocols > 0) {
          setError(
            `${failedProtocols} of ${protocolsRef.current.length} protocols failed to load — data shown may be incomplete`,
          );
        }
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
    // protocolsRef.current is read (not protocols) so unrelated array-identity
    // churn doesn't recreate refresh; protocolIds tracks the one thing the
    // cross-scope fan-out actually depends on (the set of ids).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProtocol?.id, protocolIds]);

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

    // Coalesce bursts of realtime events into one refresh. A bulk write
    // (CSV import, batch visit materialization) emits one event per row;
    // without a debounce each event fires a full refetch cycle — in
    // cross-protocol scope that's 4×protocols queries per event. The
    // fetchTokenRef guard already prevents stale state writes; this stops
    // the redundant network fan-out itself.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => refresh(), 300);
    };

    if (pid) {
      channel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_participants', filter: `protocol_id=eq.${pid}` },
          debouncedRefresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_visits', filter: `protocol_id=eq.${pid}` },
          debouncedRefresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'site_team_members', filter: `protocol_id=eq.${pid}` },
          debouncedRefresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'documents', filter: `protocol_id=eq.${pid}` },
          debouncedRefresh,
        );
    } else {
      // Cross-protocol scope — subscribe without filter; refresh fans out.
      channel
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_participants' }, debouncedRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_visits' }, debouncedRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'site_team_members' }, debouncedRefresh)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, debouncedRefresh);
    }

    channel.subscribe();
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
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
