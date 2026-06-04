import { describe, it, expect } from 'vitest';
import { dedupeVisitTemplateRowsByQuality, pickTemplateForVisit, staleTemplateIds, visitMatchKey } from '../visitTemplateDedup.ts';

// =============================================================================
// visitMatchKey — the schedule-entry ↔ visit-template match key. Locks the
// regression where the template side used the canonicalized stored name and the
// lookup side used the raw extraction name, so parenthetical-named visits
// (Treatment Visit N (Day 1, Cycle N)) silently lost all their procedures.
// =============================================================================
describe('visitMatchKey (schedule ↔ template match)', () => {
  it('keys a raw extraction name and its canonical template name IDENTICALLY', () => {
    // This assertion would have failed the instant #2 canonicalized the stored name.
    expect(visitMatchKey('Treatment Visit 1 (Day 1, Cycle 1)', 1)).toBe(
      visitMatchKey('Treatment Visit 1', 1),
    );
    expect(visitMatchKey('Treatment Visit 7 (Day 1, Cycle 7)', 85)).toBe(
      visitMatchKey('Treatment Visit 7', 85),
    );
  });

  it('is idempotent (canonical name in → same key)', () => {
    expect(visitMatchKey('Treatment Visit 2', 15)).toBe(visitMatchKey('Treatment Visit 2', 15));
  });

  it('keeps genuinely different visits distinct', () => {
    expect(visitMatchKey('Treatment Visit 1', 1)).not.toBe(visitMatchKey('Treatment Visit 2', 1));
    expect(visitMatchKey('Treatment Visit 1', 1)).not.toBe(visitMatchKey('Treatment Visit 1', 15));
    // A semantic parenthetical is NOT stripped, so it stays its own visit.
    expect(visitMatchKey('Treatment Visit 1 (PK substudy)', 1)).not.toBe(
      visitMatchKey('Treatment Visit 1', 1),
    );
  });

  it('is case- and whitespace-insensitive (symmetric on both sides)', () => {
    expect(visitMatchKey('  Screening  ', -28)).toBe(visitMatchKey('screening', -28));
  });
});

// =============================================================================
// visitTemplateDedup — quality-winner selection for duplicate visit rows.
// This is the Feature-C fix that makes Visit Prep store the SAME visit instance
// the Protocol tab renders (the windowed inline-section copy), instead of the
// old "last occurrence wins" which could keep the sparse SoA-table copy.
// =============================================================================

function row(over: Partial<Parameters<typeof dedupeVisitTemplateRowsByQuality>[0][number]> = {}) {
  return {
    visit_name: 'Visit 1',
    study_day: 1,
    window_minus_days: 0,
    window_plus_days: 0,
    procedures: [] as string[],
    ...over,
  };
}

describe('dedupeVisitTemplateRowsByQuality', () => {
  it('keeps a single row unchanged', () => {
    const out = dedupeVisitTemplateRowsByQuality([row({ procedures: ['A'] })]);
    expect(out).toHaveLength(1);
    expect(out[0].procedures).toEqual(['A']);
  });

  it('collapses duplicate (visit_name, study_day) to one row', () => {
    const out = dedupeVisitTemplateRowsByQuality([row(), row()]);
    expect(out).toHaveLength(1);
  });

  it('prefers the instance WITH a window over a window-less duplicate', () => {
    // Sparse SoA copy first (no window), rich inline copy second (windowed) —
    // last-wins would have kept neither preference; quality-winner keeps inline.
    const sparse = row({ window_minus_days: 0, window_plus_days: 0, procedures: ['x'] });
    const inline = row({ window_minus_days: 2, window_plus_days: 2, procedures: ['x', 'y', 'z'] });
    const out = dedupeVisitTemplateRowsByQuality([sparse, inline]);
    expect(out).toHaveLength(1);
    expect(out[0].window_plus_days).toBe(2);
    expect(out[0].procedures).toEqual(['x', 'y', 'z']);
  });

  it('keeps the windowed instance even when it comes FIRST (order-independent)', () => {
    const inline = row({ window_minus_days: 1, window_plus_days: 1, procedures: ['a', 'b'] });
    const sparse = row({ window_minus_days: 0, window_plus_days: 0, procedures: ['a'] });
    const out = dedupeVisitTemplateRowsByQuality([inline, sparse]);
    expect(out[0].window_minus_days).toBe(1);
    expect(out[0].procedures).toEqual(['a', 'b']);
  });

  it('breaks a window tie by procedure count', () => {
    const few = row({ window_plus_days: 1, procedures: ['a'] });
    const many = row({ window_plus_days: 1, procedures: ['a', 'b', 'c'] });
    const out = dedupeVisitTemplateRowsByQuality([few, many]);
    expect(out[0].procedures).toEqual(['a', 'b', 'c']);
  });

  it('does NOT merge same-name visits on different study days', () => {
    const out = dedupeVisitTemplateRowsByQuality([
      row({ visit_name: 'Unscheduled', study_day: 14 }),
      row({ visit_name: 'Unscheduled', study_day: 28 }),
    ]);
    expect(out).toHaveLength(2);
  });
});

// =============================================================================
// staleTemplateIds — idempotent re-ingest prune. Given a document's already-
// stored templates + the freshly-extracted (kept) batch, returns the ids that
// are no longer present and should be deleted, so non-deterministic Reducto
// naming can't accumulate a new variant row per re-ingest.
// =============================================================================

const stored = (id: string, visit_name: string, study_day: number) => ({ id, visit_name, study_day });

describe('staleTemplateIds', () => {
  it('flags a prior-run variant of a re-extracted visit (the accumulation bug)', () => {
    // Same day-1 visit, re-extracted under a different name → old row is stale.
    const existing = [stored('old', 'Treatment Visit 1 (Week 0)', 1)];
    const kept = [row({ visit_name: 'Treatment Visit 1', study_day: 1 })];
    expect(staleTemplateIds(existing, kept)).toEqual(['old']);
  });

  it('keeps a visit that persists unchanged (so its id + requirements + edits survive)', () => {
    const existing = [stored('s1', 'Screening', -28)];
    const kept = [row({ visit_name: 'Screening', study_day: -28 })];
    expect(staleTemplateIds(existing, kept)).toEqual([]);
  });

  it('returns only the stale ids from a mixed set', () => {
    const existing = [
      stored('a', 'Visit A', 1),
      stored('b', 'Visit B', 14),
      stored('c', 'Visit C (old name)', 28),
    ];
    const kept = [row({ visit_name: 'Visit B', study_day: 14 })];
    expect(staleTemplateIds(existing, kept).sort()).toEqual(['a', 'c']);
  });

  it('treats the same name on a different study_day as stale (key includes the day)', () => {
    const existing = [stored('x', 'Unscheduled', 14)];
    const kept = [row({ visit_name: 'Unscheduled', study_day: 28 })];
    expect(staleTemplateIds(existing, kept)).toEqual(['x']);
  });

  it('no existing rows → nothing to prune', () => {
    expect(staleTemplateIds([], [row()])).toEqual([]);
  });
});

// =============================================================================
// pickTemplateForVisit — collision-safe lookup (workstream C). When two
// templates share one visitMatchKey, disambiguate by exact name instead of the
// old last-write-wins Map that silently dropped one visit's procedures.
// =============================================================================
describe('pickTemplateForVisit (collision-safe lookup)', () => {
  it('returns the only template when there is no collision', () => {
    const r = pickTemplateForVisit([{ visit_name: 'Treatment Visit 7', id: 'a' }], 'Treatment Visit 7');
    expect(r.pick?.id).toBe('a');
    expect(r.collided).toBe(false);
  });

  it('disambiguates a collision by EXACT raw name, flagging the collision', () => {
    const bucket = [
      { visit_name: 'Visit 2', id: 'a' },
      { visit_name: 'Baseline Visit 2', id: 'b' },
    ];
    const r = pickTemplateForVisit(bucket, 'Baseline Visit 2');
    expect(r.pick?.id).toBe('b'); // not the first (last-write-wins would have dropped it)
    expect(r.collided).toBe(true);
  });

  it('falls back to canonical match, then first, on a collision', () => {
    const bucket = [
      { visit_name: 'Treatment Visit 1', id: 'a' },
      { visit_name: 'Treatment Visit 1 (Cycle 1)', id: 'b' },
    ];
    // raw "Treatment Visit 1 (Day 1, Cycle 1)" canonicalizes to "Treatment Visit 1" → matches 'a'
    const r = pickTemplateForVisit(bucket, 'Treatment Visit 1 (Day 1, Cycle 1)');
    expect(r.pick?.id).toBe('a');
    expect(r.collided).toBe(true);
  });

  it('returns null for an empty bucket', () => {
    expect(pickTemplateForVisit([], 'Anything').pick).toBeNull();
  });
});
