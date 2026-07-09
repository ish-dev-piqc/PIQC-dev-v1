import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchNotices,
  setNoticeStatus,
  syncNotices,
} from '../../lib/actions/actionsApi';
import type { NoticeRecord } from '../../types/actions';
import { NoticeCard } from './NoticeCard';

// =============================================================================
// NoticeRail — ambient "what PIQC noticed" strip for one protocol, the Action
// Layer rail's sibling. Owns its own data flow (sync → fetch via actionsApi);
// NoticeCard stays pure presentation.
//
// Unlike ActionCardRail there is NO deliverable dependency — notices surface
// the moment a protocol parses, so refreshKey is optional (a mount that has no
// change token still syncs once on protocol change).
//
// Silent-with-signal discipline — this is an ambient surface, never competing
// for attention:
//   - loading renders nothing (no spinner), zero visible notices renders
//     nothing (no empty-state box) — the rail simply isn't there.
//   - sync is best-effort: a failure logs and the rail still fetches whatever
//     notices already exist. Never notice bodies in logs (SENSITIVE).
//
// Visibility: only an explicit 'dismissed' hides a notice. There is no 'acted'
// state — a notice is an observation, not a handoff.
//
// Race guards (ActionCardRail precedent):
//   - fetchTokenRef orders fetches — only the latest applies its result.
//   - the effect's `cancelled` flag stops a stale sync → fetch chain from
//     STARTING a fetch after the effect re-ran.
//   - protocolIdRef drops a dismiss → refetch chain that resolves after a
//     protocol switch.
// =============================================================================

interface Props {
  protocolId: string;
  /** Optional opaque change token — any value change re-runs the sync → fetch
   *  chain. Notices need no deliverable chip, so this is usually omitted; pass
   *  it only when an external event (e.g. a re-parse) should refresh the rail. */
  refreshKey?: string | number;
}

export function NoticeRail({ protocolId, refreshKey }: Props) {
  const [notices, setNotices] = useState<NoticeRecord[]>([]);

  // Monotonic token: only the latest fetch applies its result.
  const fetchTokenRef = useRef(0);

  // Current protocol, readable from stale closures (dismiss → refetch guard).
  const protocolIdRef = useRef(protocolId);
  useEffect(() => {
    protocolIdRef.current = protocolId;
  }, [protocolId]);

  const loadNotices = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const result = await fetchNotices(protocolId);
    if (token !== fetchTokenRef.current) return;
    if (!result.ok) {
      // Degrade silently: last-known-good notices stay; a fresh mount stays
      // hidden. Error message only — never notice bodies.
      console.error('[notices] fetch_failed', { protocolId, error: result.error });
      return;
    }
    setNotices(result.data);
  }, [protocolId]);

  // Tracks protocol switches so the previous protocol's notices drop
  // immediately (no cross-protocol bleed while the new fetch runs) — while a
  // same-protocol refreshKey bump keeps the current notices on screen.
  const lastProtocolRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastProtocolRef.current !== protocolId) {
      lastProtocolRef.current = protocolId;
      setNotices([]);
    }

    let cancelled = false;
    void (async () => {
      // Best-effort sync: fire, tolerate failure — notices that already exist
      // still render even when sync can't run.
      const sync = await syncNotices(protocolId);
      if (!sync.ok) {
        console.error('[notices] sync_failed', { protocolId, error: sync.error });
      }
      if (cancelled) return;
      await loadNotices();
    })();

    return () => {
      cancelled = true;
    };
  }, [protocolId, refreshKey, loadNotices]);

  const dismissNotice = useCallback(
    async (notice: NoticeRecord) => {
      const pid = protocolId;
      const result = await setNoticeStatus(notice.id, 'dismissed');
      if (protocolIdRef.current !== pid) return;
      if (!result.ok) {
        // The notice simply stays — no error banner on an ambient surface.
        console.error('[notices] dismiss_failed', { noticeId: notice.id, error: result.error });
        return;
      }
      // No optimistic removal — refetch so the rail shows the server's truth.
      await loadNotices();
    },
    [protocolId, loadNotices],
  );

  const visibleNotices = notices.filter((n) => n.status !== 'dismissed');

  // Self-hiding: the rail is ambient — no spinner, no empty-state box.
  if (visibleNotices.length === 0) return null;

  return (
    <section
      data-testid="notice-rail"
      aria-label="What PIQC noticed"
      className="space-y-3"
    >
      {visibleNotices.map((notice) => (
        <NoticeCard
          key={notice.id}
          notice={notice}
          onDismiss={(n) => void dismissNotice(n)}
        />
      ))}
    </section>
  );
}
