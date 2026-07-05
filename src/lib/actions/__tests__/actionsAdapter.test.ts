import { describe, expect, it } from 'vitest';
import { adaptActionCard, adaptActionCards } from '../actionsAdapter';

// =============================================================================
// actionsAdapter — defensive mapping of action_cards_get JSON. Malformed
// entries are skipped, enum fields outside their CHECK constraints reject
// the entry, and the destination whitelist derives from DESTINATION_LABELS
// (regression discipline from the deliverables adapter: hand lists go stale).
// =============================================================================

const baseCard = {
  id: 'card-1',
  protocol_id: 'prot-1',
  deliverable_id: 'del-1',
  trigger_context: 'monitoring_prep',
  title: 'Plan monitoring travel',
  rationale:
    'A monitoring visit for this protocol will need focused preparation — 2 primary endpoints require source-data verification.',
  protocol_evidence_ids: ['ev-1', 'ev-2'],
  suggested_window: null,
  external_destination_type: 'travel',
  external_url_or_template: null,
  disclaimer:
    "Planning support only — PIQC does not book travel, set monitoring cadence, or direct site visits. Execution happens in your organization's systems.",
  status: 'suggested',
  created_at: '2026-07-04T12:00:00Z',
  updated_at: '2026-07-04T12:00:00Z',
};

describe('adaptActionCard', () => {
  it('round-trips a full card', () => {
    const card = adaptActionCard(baseCard);
    expect(card).not.toBeNull();
    expect(card?.trigger_context).toBe('monitoring_prep');
    expect(card?.protocol_evidence_ids).toEqual(['ev-1', 'ev-2']);
    expect(card?.external_url_or_template).toBeNull();
    expect(card?.suggested_window).toBeNull();
  });

  it('adapts EVERY destination type the labels map declares', () => {
    for (const destination of ['travel', 'lms', 'ctms', 'none'] as const) {
      const card = adaptActionCard({ ...baseCard, external_destination_type: destination });
      expect(card?.external_destination_type).toBe(destination);
    }
  });

  it('rejects unknown destination and status values', () => {
    expect(adaptActionCard({ ...baseCard, external_destination_type: 'jetpack' })).toBeNull();
    expect(adaptActionCard({ ...baseCard, status: 'approved' })).toBeNull();
  });

  it('rejects entries missing required prose (title / rationale / disclaimer)', () => {
    expect(adaptActionCard({ ...baseCard, title: null })).toBeNull();
    expect(adaptActionCard({ ...baseCard, rationale: 7 })).toBeNull();
    expect(adaptActionCard({ ...baseCard, disclaimer: undefined })).toBeNull();
  });

  it('degrades malformed optional fields instead of failing', () => {
    const card = adaptActionCard({
      ...baseCard,
      deliverable_id: 42,
      protocol_evidence_ids: ['ev-1', null, 9, ''],
      suggested_window: { start_iso: '2026-08-01' }, // missing end_iso
    });
    expect(card).not.toBeNull();
    expect(card?.deliverable_id).toBeNull();
    expect(card?.protocol_evidence_ids).toEqual(['ev-1']);
    expect(card?.suggested_window).toBeNull();
  });

  it('keeps a complete suggested_window when both bounds are present', () => {
    const card = adaptActionCard({
      ...baseCard,
      suggested_window: { start_iso: '2026-08-01', end_iso: '2026-08-03' },
    });
    expect(card?.suggested_window).toEqual({
      start_iso: '2026-08-01',
      end_iso: '2026-08-03',
    });
  });
});

describe('adaptActionCards', () => {
  it('skips malformed entries and keeps valid siblings', () => {
    const cards = adaptActionCards([baseCard, null, 42, { ...baseCard, id: null }]);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('card-1');
  });

  it('adapts a non-array payload to an empty list', () => {
    expect(adaptActionCards(null)).toEqual([]);
    expect(adaptActionCards({})).toEqual([]);
  });
});
