import { describe, it, expect } from 'vitest';
import { adaptDivergenceRow, sortDivergences } from '../divergenceAdapter';
import { validDivergenceRow as validRow } from './fixtures';

// =============================================================================
// divergenceAdapter — pure mapper. The load-bearing property is that a
// malformed row yields null rather than a partially-typed record: a divergence
// is a claim about the protocol, so a half-parsed one must never reach the UI.
// =============================================================================

describe('adaptDivergenceRow', () => {
  it('adapts a valid row, renaming class → divergence_class', () => {
    const r = adaptDivergenceRow(validRow);
    expect(r).not.toBeNull();
    expect(r?.divergence_class).toBe('window_mismatch');
    expect(r?.reading_a.verbatim).toBe(true);
    expect(r?.dispositions).toHaveLength(1);
  });

  it('returns null for malformed rows instead of a partially-typed record', () => {
    expect(adaptDivergenceRow(null)).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, class: 'made_up' })).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, reading_a: { source: 'nope' } })).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, status: 'archived' })).toBeNull();
  });

  it('drops malformed dispositions but keeps the record', () => {
    const r = adaptDivergenceRow({
      ...validRow,
      dispositions: [{ bogus: true }, ...validRow.dispositions],
    });
    expect(r?.dispositions).toHaveLength(1);
  });
});

describe('sortDivergences', () => {
  it('orders open work first, then by class consequence', () => {
    const mk = (over: Partial<typeof validRow>) => adaptDivergenceRow({ ...validRow, ...over })!;
    const sorted = sortDivergences([
      mk({ id: 'a', status: 'resolved' }),
      mk({ id: 'b', class: 'cohort_scope', visit_name: null }),
      mk({ id: 'c', class: 'window_mismatch' }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });
});
