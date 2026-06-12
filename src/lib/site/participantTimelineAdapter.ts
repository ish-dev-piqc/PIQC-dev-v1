import type { ChatDecision } from '../../types/orgs';
import type { SiteVisit } from './types';

// =============================================================================
// participantTimelineAdapter — pure merger of a participant's visit list +
// related chat decisions into a single reverse-chronological timeline.
//
// Used by the Timeline section of ParticipantProfileDrawer.
// =============================================================================

export type TimelineEvent =
  | { kind: 'visit'; date: string; visit: SiteVisit }
  | { kind: 'decision'; date: string; decision: ChatDecision };

/** Merge + sort. Visits keyed by `visit.date` ("yyyy-mm-dd"), decisions
 *  keyed by `decision.decided_at` (ISO timestamp). Newest first.
 *
 *  Pure — no Supabase / network / DOM imports. */
export function mergeParticipantTimeline(
  visits: SiteVisit[],
  decisions: ChatDecision[],
): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const v of visits) {
    events.push({ kind: 'visit', date: v.date, visit: v });
  }
  for (const d of decisions) {
    events.push({ kind: 'decision', date: d.decided_at, decision: d });
  }
  // Both date strings sort lexicographically because both are
  // ISO-prefixed yyyy-mm-dd. Compare full strings; ties broken
  // arbitrarily by id so the order is stable across renders.
  events.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    const aId = a.kind === 'visit' ? a.visit.id : a.decision.id;
    const bId = b.kind === 'visit' ? b.visit.id : b.decision.id;
    return aId.localeCompare(bId);
  });
  return events;
}
