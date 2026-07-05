import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchActionCards,
  setActionCardStatus,
  syncActionCards,
} from '../../lib/actions/actionsApi';
import type { ActionCardRecord } from '../../types/actions';
import { ActionCard } from './ActionCard';

// =============================================================================
// ActionCardRail — ambient strip of suggested next actions for one protocol.
// The rail owns its own data flow (sync → fetch via actionsApi); ActionCard
// stays pure presentation.
//
// Silent-with-signal discipline — this is an ambient surface, so it never
// competes for attention:
//   - loading renders nothing (no spinner), zero visible cards renders
//     nothing (no empty-state box) — the rail simply isn't there.
//   - sync is best-effort: a sync failure logs an error message and the rail
//     still fetches whatever cards already exist. Never card bodies in logs.
//
// Visibility: only an explicit 'dismissed' hides a card. 'acted' cards stay
// visible with the link still available — 'acted' is a click record, not a
// completed state (Decision 5): PIQC never claims the external action
// happened, so the handoff must remain reachable on the next visit.
//
// Race guards (DeliverablePanel precedent):
//   - fetchTokenRef orders fetches that already started — only the latest
//     applies its result.
//   - the effect's `cancelled` flag stops a stale sync → fetch chain from
//     STARTING a fetch after the effect re-ran (the token alone can't).
//   - protocolIdRef drops a dismiss → refetch chain that resolves after a
//     protocol switch.
// =============================================================================

interface Props {
  protocolId: string;
  /** Opaque change token — any value change re-runs the sync → fetch chain.
   *  The intelligence tab passes its active deliverable chip, so switching
   *  deliverables (incl. right after a generate) refreshes the rail. */
  refreshKey: string | number;
}

export function ActionCardRail({ protocolId, refreshKey }: Props) {
  const [cards, setCards] = useState<ActionCardRecord[]>([]);

  // Monotonic token: only the latest fetch applies its result.
  const fetchTokenRef = useRef(0);

  // Current protocol, readable from stale closures (dismiss → refetch guard).
  const protocolIdRef = useRef(protocolId);
  useEffect(() => {
    protocolIdRef.current = protocolId;
  }, [protocolId]);

  const loadCards = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const result = await fetchActionCards(protocolId);
    if (token !== fetchTokenRef.current) return;
    if (!result.ok) {
      // Degrade silently: last-known-good cards stay on screen; a fresh
      // mount just stays hidden. Error message only — never card bodies.
      console.error('[actions] fetch_failed', { protocolId, error: result.error });
      return;
    }
    setCards(result.data);
  }, [protocolId]);

  // Tracks protocol switches so the previous protocol's cards drop
  // immediately (no cross-protocol bleed while the new fetch runs) — while a
  // same-protocol refreshKey bump keeps the current cards on screen, so a
  // regenerate never blinks the rail out and back.
  const lastProtocolRef = useRef<string | null>(null);

  useEffect(() => {
    if (lastProtocolRef.current !== protocolId) {
      lastProtocolRef.current = protocolId;
      setCards([]);
    }

    let cancelled = false;
    void (async () => {
      // Best-effort sync: fire, tolerate failure — cards that already exist
      // still render even when sync can't run.
      const sync = await syncActionCards(protocolId);
      if (!sync.ok) {
        console.error('[actions] sync_failed', { protocolId, error: sync.error });
      }
      if (cancelled) return;
      await loadCards();
    })();

    return () => {
      cancelled = true;
    };
  }, [protocolId, refreshKey, loadCards]);

  const dismissCard = useCallback(
    async (card: ActionCardRecord) => {
      const pid = protocolId;
      const result = await setActionCardStatus(card.id, 'dismissed');
      if (protocolIdRef.current !== pid) return;
      if (!result.ok) {
        // The card simply stays — no error banner on an ambient surface.
        console.error('[actions] dismiss_failed', { cardId: card.id, error: result.error });
        return;
      }
      // No optimistic removal — refetch so the rail shows the server's truth.
      await loadCards();
    },
    [protocolId, loadCards],
  );

  const recordActed = useCallback((card: ActionCardRecord) => {
    // Fire-and-forget: never block or delay the navigation to the external
    // tool. 'acted' has no v1 render effect (acted cards stay visible), so
    // there is nothing to refetch for; a failure only loses the click record.
    void setActionCardStatus(card.id, 'acted').then((result) => {
      if (!result.ok) {
        console.error('[actions] acted_record_failed', {
          cardId: card.id,
          error: result.error,
        });
      }
    });
  }, []);

  const visibleCards = cards.filter((c) => c.status !== 'dismissed');

  // Self-hiding: the rail is ambient — no spinner, no empty-state box.
  if (visibleCards.length === 0) return null;

  return (
    <section
      data-testid="action-card-rail"
      aria-label="Suggested next actions"
      className="space-y-3"
    >
      {visibleCards.map((card) => (
        <ActionCard
          key={card.id}
          card={card}
          onDismiss={(c) => void dismissCard(c)}
          onFollowLink={recordActed}
        />
      ))}
    </section>
  );
}
