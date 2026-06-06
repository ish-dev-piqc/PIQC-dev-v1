import { describe, expect, it } from 'vitest';
import { mergeParticipantTimeline } from '../participantTimelineAdapter';
import type { ChatDecision } from '../../../types/orgs';
import type { SiteVisit } from '../types';

// =============================================================================
// participantTimelineAdapter — verify merge-order, empty input, and stable
// sort by id when dates tie.
// =============================================================================

const visit = (over: Partial<SiteVisit> = {}): SiteVisit => ({
  id: over.id ?? 'v-1',
  date: over.date ?? '2026-06-01',
  protocolId: 'p-1',
  participantId: 'P-0001',
  studyDay: 5,
  visitName: 'Week 1',
  status: 'completed',
  ...over,
});

const decision = (over: Partial<ChatDecision> = {}): ChatDecision => ({
  id: over.id ?? 'd-1',
  title: over.title ?? 'Pause enrollment',
  rationale: over.rationale ?? null,
  org_id: over.org_id ?? null,
  protocol_id: over.protocol_id ?? 'p-1',
  source_org_message_id: over.source_org_message_id ?? null,
  source_protocol_message_id: over.source_protocol_message_id ?? null,
  decided_by_user_id: over.decided_by_user_id ?? null,
  decided_at: over.decided_at ?? '2026-06-02',
  created_by_user_id: over.created_by_user_id ?? null,
  created_at: over.created_at ?? '2026-06-02',
});

describe('mergeParticipantTimeline', () => {
  it('returns an empty array for two empty inputs', () => {
    expect(mergeParticipantTimeline([], [])).toEqual([]);
  });

  it('returns only visit events when decisions empty', () => {
    const out = mergeParticipantTimeline([visit()], []);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('visit');
  });

  it('returns only decision events when visits empty', () => {
    const out = mergeParticipantTimeline([], [decision()]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('decision');
  });

  it('sorts newest first across both kinds', () => {
    const out = mergeParticipantTimeline(
      [
        visit({ id: 'v-old', date: '2026-05-01' }),
        visit({ id: 'v-new', date: '2026-06-05' }),
      ],
      [decision({ id: 'd-mid', decided_at: '2026-06-01' })],
    );
    expect(out.map((e) => (e.kind === 'visit' ? e.visit.id : e.decision.id))).toEqual([
      'v-new',
      'd-mid',
      'v-old',
    ]);
  });

  it('is stable by id when dates tie', () => {
    const out = mergeParticipantTimeline(
      [visit({ id: 'v-z', date: '2026-06-01' })],
      [decision({ id: 'd-a', decided_at: '2026-06-01' })],
    );
    // Same date — sort by id ascending. 'd-a' < 'v-z'.
    expect(out[0].kind === 'decision' ? out[0].decision.id : '').toBe('d-a');
  });
});
