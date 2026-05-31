// =============================================================================
// OrgContext — global org list + active selection + per-active-protocol
// membership/requests/guests cache.
//
// Responsibilities:
//   - Loads the caller's org memberships once on mount (refreshed on auth
//     change via Supabase's session listener at the App root).
//   - Persists active-org selection to localStorage so single-org users get
//     the right scope on reload, and multi-org users keep their last pick.
//   - Caches protocol_members / access_requests / guests for the currently
//     active protocol (from ProtocolContext). Re-fetches on protocol switch.
//   - Subscribes to postgres_changes on the three tables, filtered by
//     active protocol_id, to keep the cache live.
//
// Realtime lives here per CLAUDE.md's "Realtime in context only" rule.
// Components consume via useOrg() and never touch supabase directly.
// =============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { useProtocol } from './ProtocolContext';
import {
  listMyOrgs,
  listMyProtocolMemberships,
  listProtocolAccessRequests,
  listProtocolGuests,
  listProtocolMembers,
} from '../lib/orgs/orgsApi';
import type {
  OrgWithMembership,
  ProtocolAccessRequest,
  ProtocolGuest,
  ProtocolMember,
} from '../types/orgs';

const ACTIVE_ORG_STORAGE_KEY = 'piq-active-org-v1';

interface OrgContextValue {
  /** Auth user id, or null when signed out. Useful for "am I the coordinator?" checks. */
  currentUserId: string | null;

  myOrgs: OrgWithMembership[];
  activeOrg: OrgWithMembership | null;
  setActiveOrg: (orgId: string) => void;

  /** Members of the currently-active protocol (from ProtocolContext). Empty if no active protocol. */
  protocolMembers: ProtocolMember[];
  /** Pending+resolved access requests for the active protocol. Coordinator-visible only. */
  accessRequests: ProtocolAccessRequest[];
  /** Guests for the active protocol. Coordinator-visible only. */
  guests: ProtocolGuest[];
  /** owner_org_id of the currently-active protocol (read from DB; not exposed on Protocol type). */
  protocolOwnerOrgId: string | null;
  /** Set of protocol_ids the current user is an explicit `protocol_members` row of.
   *  Used by the Navbar protocol picker to split "Your protocols" vs "Available in your org". */
  myProtocolIds: Set<string>;

  loading: boolean;
  error: string | null;
  /** Force a re-fetch of orgs + active-protocol scope. */
  refresh: () => void;
}

const OrgContext = createContext<OrgContextValue>({
  currentUserId: null,
  myOrgs: [],
  activeOrg: null,
  setActiveOrg: () => {},
  protocolMembers: [],
  accessRequests: [],
  guests: [],
  protocolOwnerOrgId: null,
  myProtocolIds: new Set<string>(),
  loading: false,
  error: null,
  refresh: () => {},
});

export function OrgProvider({ children }: { children: React.ReactNode }) {
  const { activeProtocol } = useProtocol();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [myOrgs, setMyOrgs] = useState<OrgWithMembership[]>([]);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(ACTIVE_ORG_STORAGE_KEY);
  });

  // Hydrate the auth user id once on mount + on session changes.
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setCurrentUserId(data.user?.id ?? null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      setCurrentUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const [protocolMembers, setProtocolMembers] = useState<ProtocolMember[]>([]);
  const [accessRequests, setAccessRequests] = useState<ProtocolAccessRequest[]>([]);
  const [guests, setGuests] = useState<ProtocolGuest[]>([]);
  const [myProtocolIds, setMyProtocolIds] = useState<Set<string>>(new Set());

  // Load the set of protocols the current user is an explicit member of.
  // Refreshes on auth change. No realtime for v1 — if a coordinator adds
  // you mid-session, you'll see it after the next page refresh.
  useEffect(() => {
    if (!currentUserId) {
      setMyProtocolIds(new Set());
      return;
    }
    let cancelled = false;
    listMyProtocolMemberships().then((res) => {
      if (cancelled) return;
      if (res.ok) setMyProtocolIds(new Set(res.data));
    });
    return () => {
      cancelled = true;
    };
  }, [currentUserId]);
  const [protocolOwnerOrgId, setProtocolOwnerOrgId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Race-guard so a fast protocol switch doesn't apply stale results.
  const fetchTokenRef = useRef(0);

  // ---------------------------------------------------------------------------
  // Load the org list once. The auth session listener at the App root remounts
  // OrgProvider on sign-in/sign-out, so we don't need to subscribe here.
  // ---------------------------------------------------------------------------
  const refreshOrgs = useCallback(async () => {
    const res = await listMyOrgs();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setMyOrgs(res.data);

    // Auto-pick the single org if there's exactly one and nothing's stored.
    if (res.data.length === 1 && !activeOrgId) {
      setActiveOrgIdState(res.data[0].id);
    } else if (activeOrgId && !res.data.some((o) => o.id === activeOrgId)) {
      // Stored org is gone (user removed or org deleted). Clear.
      setActiveOrgIdState(null);
    }
  }, [activeOrgId]);

  useEffect(() => {
    refreshOrgs();
  }, [refreshOrgs]);

  // ---------------------------------------------------------------------------
  // Per-active-protocol fetch. Re-runs on protocol switch.
  // ---------------------------------------------------------------------------
  const refreshProtocolScope = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const pid = activeProtocol?.id ?? null;
    if (!pid) {
      setProtocolMembers([]);
      setAccessRequests([]);
      setGuests([]);
      setProtocolOwnerOrgId(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [mr, ar, gr, ownerOrg] = await Promise.all([
        listProtocolMembers(pid),
        listProtocolAccessRequests(pid),
        listProtocolGuests(pid),
        supabase.from('protocols').select('owner_org_id').eq('id', pid).single(),
      ]);
      if (token !== fetchTokenRef.current) return;

      if (!mr.ok) throw new Error(mr.error);
      // Access requests + guests are coordinator-visible only; RLS returns
      // empty for non-coordinators rather than erroring, so we accept ok=true
      // with empty data. Real errors still propagate.
      if (!ar.ok) throw new Error(ar.error);
      if (!gr.ok) throw new Error(gr.error);
      if (ownerOrg.error) throw new Error(ownerOrg.error.message);

      setProtocolMembers(mr.data);
      setAccessRequests(ar.data);
      setGuests(gr.data);
      setProtocolOwnerOrgId(
        (ownerOrg.data as { owner_org_id: string | null } | null)?.owner_org_id ?? null,
      );
    } catch (e) {
      if (token !== fetchTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === fetchTokenRef.current) setLoading(false);
    }
  }, [activeProtocol?.id]);

  useEffect(() => {
    refreshProtocolScope();
  }, [refreshProtocolScope]);

  // ---------------------------------------------------------------------------
  // Realtime — subscribe to the three tables filtered by active protocol_id.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const pid = activeProtocol?.id;
    if (!pid) return;

    const channel = supabase.channel(`orgs-${pid}`);
    channel
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'protocol_members', filter: `protocol_id=eq.${pid}` },
        () => refreshProtocolScope(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'protocol_access_requests', filter: `protocol_id=eq.${pid}` },
        () => refreshProtocolScope(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'protocol_guests', filter: `protocol_id=eq.${pid}` },
        () => refreshProtocolScope(),
      );

    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeProtocol?.id, refreshProtocolScope]);

  // ---------------------------------------------------------------------------
  // setActiveOrg — persist to localStorage so multi-org users keep their pick.
  // ---------------------------------------------------------------------------
  const setActiveOrg = useCallback((orgId: string) => {
    setActiveOrgIdState(orgId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
  }, []);

  const refresh = useCallback(() => {
    refreshOrgs();
    refreshProtocolScope();
  }, [refreshOrgs, refreshProtocolScope]);

  const activeOrg = myOrgs.find((o) => o.id === activeOrgId) ?? null;

  return (
    <OrgContext.Provider
      value={{
        currentUserId,
        myOrgs,
        activeOrg,
        setActiveOrg,
        protocolMembers,
        accessRequests,
        guests,
        protocolOwnerOrgId,
        myProtocolIds,
        loading,
        error,
        refresh,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}

export function useOrg() {
  return useContext(OrgContext);
}
