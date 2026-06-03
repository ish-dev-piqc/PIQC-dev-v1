import { describe, it, expect } from 'vitest';
import {
  detectImplausibleDay,
  expandAggregateVisitRow,
  reconcileVisitSequence,
} from '../visitScheduleRules.ts';

describe('detectImplausibleDay (#3a)', () => {
  it('flags an end-of-treatment visit dated implausibly early', () => {
    expect(detectImplausibleDay('EOT Visit', 14, 169)?.detection_reason).toBe('implausible_study_day');
    expect(detectImplausibleDay('End of Treatment (EOT) Visit', 0, 169)?.detection_reason).toBe('implausible_study_day');
    expect(detectImplausibleDay('Follow-up Assessment', 30, 360)?.detection_reason).toBe('implausible_study_day');
  });
  it('does NOT flag a plausibly-late end visit', () => {
    expect(detectImplausibleDay('EOT Visit', 169, 169)).toBeNull();
    expect(detectImplausibleDay('EOS Visit Month 24', 672, 672)).toBeNull();
  });
  it('flags a screening/baseline visit dated implausibly late, not an early one', () => {
    expect(detectImplausibleDay('Screening', -28, 169)).toBeNull();
    expect(detectImplausibleDay('Screening', 100, 169)?.detection_reason).toBe('implausible_study_day');
  });
  it('returns null for ordinary visits and degenerate scales', () => {
    expect(detectImplausibleDay('Treatment Visit 1', 1, 169)).toBeNull();
    expect(detectImplausibleDay('EOT Visit', 14, 0)).toBeNull();
  });
});

describe('expandAggregateVisitRow (#3b)', () => {
  it('expands an explicit visit↔week pairing (parses stated weeks, ×7)', () => {
    const r = expandAggregateVisitRow('Treatment Visits 2, 3, 4, 5, 6 (Weeks 2, 4, 6, 8, 10)');
    expect(r && 'expanded' in r && r.expanded).toEqual([
      { visit_name: 'Treatment Visit 2', study_day: 14 },
      { visit_name: 'Treatment Visit 3', study_day: 28 },
      { visit_name: 'Treatment Visit 4', study_day: 42 },
      { visit_name: 'Treatment Visit 5', study_day: 56 },
      { visit_name: 'Treatment Visit 6', study_day: 70 },
    ]);
  });
  it('handles a numeric range and a Days (×1) pairing', () => {
    const r = expandAggregateVisitRow('Treatment Visits 7-12 (Weeks 12, 14, 16, 18, 20, 22)');
    expect(r && 'expanded' in r && r.expanded.map((v) => v.study_day)).toEqual([84, 98, 112, 126, 140, 154]);
    const d = expandAggregateVisitRow('Visits 1, 2 (Days 1, 8)');
    expect(d && 'expanded' in d && d.expanded).toEqual([
      { visit_name: 'Visit 1', study_day: 1 },
      { visit_name: 'Visit 2', study_day: 8 },
    ]);
  });
  it('flags an aggregate it cannot expand (no mapping / count mismatch)', () => {
    const noMap = expandAggregateVisitRow('Treatment Visits 7-12');
    expect(noMap && 'flag' in noMap && noMap.flag.detection_reason).toBe('aggregate_visit_unexpanded');
    const mismatch = expandAggregateVisitRow('Treatment Visits 2, 3, 4 (Weeks 2, 4)');
    expect(mismatch && 'flag' in mismatch && mismatch.flag.detection_reason).toBe('aggregate_visit_unexpanded');
  });
  it('returns null for a single (non-aggregate) visit', () => {
    expect(expandAggregateVisitRow('Treatment Visit 1')).toBeNull();
    expect(expandAggregateVisitRow('Screening')).toBeNull();
  });
});

describe('reconcileVisitSequence (#4 deterministic)', () => {
  it('finds the missing Visit 5 & 6 in a numbered series', () => {
    const gaps = reconcileVisitSequence([
      'Treatment Visit 1', 'Treatment Visit 2', 'Treatment Visit 3', 'Treatment Visit 4',
      'Treatment Visit 7', 'Treatment Visit 8',
    ]);
    expect(gaps.map((g) => g.label)).toEqual([
      'Treatment Visit 5', 'Treatment Visit 6',
    ]);
  });
  it('reports no gaps when the series is complete (post-expansion)', () => {
    const names = Array.from({ length: 12 }, (_, i) => `Treatment Visit ${i + 1}`);
    expect(reconcileVisitSequence(names)).toEqual([]);
  });
  it('ignores un-numbered visits and single-member series', () => {
    expect(reconcileVisitSequence(['Screening', 'Randomization', 'EOT Visit'])).toEqual([]);
    expect(reconcileVisitSequence(['Treatment Visit 1'])).toEqual([]);
  });
  it('matches even on un-canonicalized cycle names', () => {
    const gaps = reconcileVisitSequence(['Cycle 1 Day 1', 'Cycle 3 Day 1']);
    expect(gaps.map((g) => g.label)).toEqual(['Cycle 2']);
  });
});
