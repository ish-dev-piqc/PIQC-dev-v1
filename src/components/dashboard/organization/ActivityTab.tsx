import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, AlertCircle } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useOrg } from '../../../context/OrgContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { listOrgEvents } from '../../../lib/orgs/orgEventsApi';
import { listOrgMembersWithProfile } from '../../../lib/orgs/orgsApi';
import {
  describeOrgEvent,
  eventGroup,
  ORG_EVENT_GROUP_LABEL,
  type OrgEventGroup,
} from '../../../lib/orgs/orgEventsAdapter';
import type { OrgEvent } from '../../../types/orgs';

// =============================================================================
// ActivityTab — append-only feed of org membership / role / invite activity.
//
// Admin-only (the org_events RLS policy already gates rows; OrganizationPage
// hides the tab for non-admins so we don't waste a network round trip).
//
// v1 fetches on mount + manual refresh. No realtime sub — events are slow,
// the tab isn't a primary surface, and the user can hit Refresh.
// =============================================================================

const PAGE_SIZE = 50;
const ALL_GROUPS: OrgEventGroup[] = ['members', 'roles', 'invites', 'access'];

function firstName(full: string): string {
  return full.split(/\s+/)[0] || full;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 30) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.round(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)}h ago`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function ActivityTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const { activeOrg } = useOrg();
  const { protocols } = useProtocol();

  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Member name lookup — populated alongside the first fetch. Used by
  // describeOrgEvent so we can render "Kiara promoted Karl…" instead of UUIDs.
  const [nameByUserId, setNameByUserId] = useState<Map<string, string>>(new Map());
  // Filter state — empty set means "all groups." Persisted in component
  // state only (not localStorage) since filters are scratch.
  const [activeGroups, setActiveGroups] = useState<Set<OrgEventGroup>>(new Set());

  const orgId = activeOrg?.id ?? null;

  const refresh = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);
    setError(null);
    const [eventsRes, membersRes] = await Promise.all([
      listOrgEvents(orgId, { limit: PAGE_SIZE }),
      listOrgMembersWithProfile(orgId),
    ]);
    if (!eventsRes.ok) {
      setError(eventsRes.error);
      setLoading(false);
      return;
    }
    setEvents(eventsRes.data);
    setHasMore(eventsRes.data.length === PAGE_SIZE);
    if (membersRes.ok) {
      setNameByUserId(
        new Map(membersRes.data.map((m) => [m.user_id, firstName(m.name)])),
      );
    }
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!orgId || events.length === 0 || loadingMore) return;
    setLoadingMore(true);
    const cursor = events[events.length - 1].created_at;
    const res = await listOrgEvents(orgId, { limit: PAGE_SIZE, before: cursor });
    if (res.ok) {
      setEvents((prev) => [...prev, ...res.data]);
      setHasMore(res.data.length === PAGE_SIZE);
    } else {
      setError(res.error);
    }
    setLoadingMore(false);
  }, [orgId, events, loadingMore]);

  // Memoized name + protocol resolvers passed to describeOrgEvent.
  const protocolCodeById = useMemo(() => {
    const m = new Map<string, string>();
    protocols.forEach((p) => m.set(p.id, p.code));
    return m;
  }, [protocols]);

  const describeCtx = useMemo(
    () => ({
      userName: (uid: string | null) =>
        uid ? nameByUserId.get(uid) ?? 'Someone' : 'Someone',
      protocolCode: (pid: string | null) =>
        pid ? protocolCodeById.get(pid) ?? 'a protocol' : '',
    }),
    [nameByUserId, protocolCodeById],
  );

  const filteredEvents = useMemo(() => {
    if (activeGroups.size === 0) return events;
    return events.filter((e) => {
      const g = eventGroup(e);
      return g !== null && activeGroups.has(g);
    });
  }, [events, activeGroups]);

  const toggleGroup = (g: OrgEventGroup) => {
    setActiveGroups((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  // Theme primitives.
  const borderClass = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const rowHoverClass = isLight ? 'hover:bg-[#0F172A]/[0.02]' : 'hover:bg-white/[0.02]';
  const chipActiveClass = isLight
    ? 'bg-brand-600/[0.10] text-brand-600 border-brand-600/30'
    : 'bg-brand-300/[0.15] text-brand-300 border-brand-300/30';
  const chipInactiveClass = isLight
    ? 'text-[#334155]/70 border-[#E2E8F0] hover:bg-[#0F172A]/[0.03]'
    : 'text-[#CBD5E1]/70 border-white/10 hover:bg-white/[0.03]';
  const refreshClass = isLight
    ? 'text-[#334155]/70 hover:text-[#0F172A] hover:bg-[#0F172A]/[0.05]'
    : 'text-[#CBD5E1]/70 hover:text-white hover:bg-white/[0.05]';

  if (!orgId) {
    return (
      <div className="text-fg-sub text-sm">No active organization.</div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-fg-label text-[10px] uppercase tracking-wider font-semibold">
            <Activity size={11} />
            Draft activity
          </div>
          <p className="text-fg-sub text-xs mt-1 max-w-xl leading-relaxed">
            Working log of member, role, invite, and access changes. Visible to admins. This is a draft surface — not a formal audit trail, since trigger failures can produce gaps.
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md ${refreshClass} disabled:opacity-50`}
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        {ALL_GROUPS.map((g) => {
          const active = activeGroups.has(g);
          return (
            <button
              key={g}
              type="button"
              onClick={() => toggleGroup(g)}
              className={`text-[11px] font-medium rounded-full border px-3 py-1 ${
                active ? chipActiveClass : chipInactiveClass
              }`}
            >
              {ORG_EVENT_GROUP_LABEL[g]}
            </button>
          );
        })}
        {activeGroups.size > 0 && (
          <button
            type="button"
            onClick={() => setActiveGroups(new Set())}
            className="text-[11px] text-fg-sub hover:text-fg-body underline-offset-2 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error band */}
      {error && (
        <div className={`flex items-center gap-2 text-xs text-red-500 px-3 py-2 rounded-md border ${borderClass}`}>
          <AlertCircle size={12} />
          {error}
        </div>
      )}

      {/* Feed */}
      {loading && events.length === 0 ? (
        <div className="text-fg-sub text-xs">Loading…</div>
      ) : filteredEvents.length === 0 ? (
        <div className={`px-4 py-8 rounded-md border ${borderClass} text-center`}>
          <p className="text-fg-body text-sm">
            {events.length === 0 ? 'No activity yet.' : 'No events match the active filters.'}
          </p>
          {events.length === 0 && (
            <p className="text-fg-sub text-xs mt-1">
              Member changes, invites, and access approvals will show here.
            </p>
          )}
        </div>
      ) : (
        <ul className={`divide-y ${borderClass} rounded-md border ${borderClass}`}>
          {filteredEvents.map((ev) => (
            <li key={ev.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 ${rowHoverClass}`}>
              <p className="text-fg-body text-sm leading-snug">
                {describeOrgEvent(ev, describeCtx)}
              </p>
              <span className="flex-shrink-0 text-fg-sub text-[11px] tabular-nums" title={new Date(ev.created_at).toLocaleString()}>
                {relativeTime(ev.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Load more — only shows when the current filtered list has rows. */}
      {hasMore && events.length > 0 && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className={`text-xs px-3 py-1.5 rounded-md border ${borderClass} ${refreshClass} disabled:opacity-50`}
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
