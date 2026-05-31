import { describe, it, expect } from 'vitest';
import { dedupeVisitTemplateRowsByQuality } from '../visitTemplateDedup.ts';

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
