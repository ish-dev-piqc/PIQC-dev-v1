import { describe, it, expect } from 'vitest';
import {
  detectImplausibleDay,
  expandAggregateColumnHeader,
  expandAggregateVisitRow,
  reconcileVisitSequence,
} from '../visitScheduleRules.ts';

describe('detectImplausibleDay (#3a)', () => {
  it('flags an end-of-treatment visit dated at/near baseline in a long study', () => {
    expect(detectImplausibleDay('EOT Visit', 14, 169)?.detection_reason).toBe('implausible_study_day');
    expect(detectImplausibleDay('End of Treatment (EOT) Visit', 0, 169)?.detection_reason).toBe('implausible_study_day');
  });

  it('does NOT flag a legit mid-study EOT or any follow-up (long-tail studies)', () => {
    // EOT at month ~6 legitimately precedes follow-up to month 24 — not a gap.
    expect(detectImplausibleDay('EOT Visit', 169, 672)).toBeNull();
    expect(detectImplausibleDay('Follow-up Assessment (Month 9)', 270, 672)).toBeNull();
    expect(detectImplausibleDay('Follow-up Visits (Month 9, 12, 18, 24)', 270, 672)).toBeNull();
    // Short study: an EOT at day 14 is plausible when the study only runs ~28 days.
    expect(detectImplausibleDay('EOT Visit', 14, 28)).toBeNull();
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

describe('expandAggregateColumnHeader (#3b column-header form)', () => {
  it('expands a unit-led week list/range with stated days (×7)', () => {
    const r = expandAggregateColumnHeader('Weeks 2, 4, 6, 8');
    expect(r && 'expanded' in r && r.expanded).toEqual([
      { visit_name: 'Week 2', study_day: 14 },
      { visit_name: 'Week 4', study_day: 28 },
      { visit_name: 'Week 6', study_day: 42 },
      { visit_name: 'Week 8', study_day: 56 },
    ]);
    const rng = expandAggregateColumnHeader('Week 2-5');
    expect(rng && 'expanded' in rng && rng.expanded.map((v) => v.study_day)).toEqual([14, 21, 28, 35]);
  });

  it('expands a unit-led day list (×1)', () => {
    const r = expandAggregateColumnHeader('Days 1, 8, 15');
    expect(r && 'expanded' in r && r.expanded).toEqual([
      { visit_name: 'Day 1', study_day: 1 },
      { visit_name: 'Day 8', study_day: 8 },
      { visit_name: 'Day 15', study_day: 15 },
    ]);
  });

  it('FLAGS a label-led range/list with no stated day (never guesses the day)', () => {
    const range = expandAggregateColumnHeader('Dosing 3-6');
    expect(range && 'flag' in range && range.flag.detection_reason).toBe('aggregate_column_unexpanded');
    const list = expandAggregateColumnHeader('Dosing 10, 12');
    expect(list && 'flag' in list && list.flag.detection_reason).toBe('aggregate_column_unexpanded');
  });

  it('refuses intra-visit timing ranges and non-aggregates (no false expansion)', () => {
    expect(expandAggregateColumnHeader('2-4 h post-dose')).toBeNull();   // timing segment
    expect(expandAggregateColumnHeader('30 min post-dose')).toBeNull();
    expect(expandAggregateColumnHeader('Week 4')).toBeNull();            // single value
    expect(expandAggregateColumnHeader('Screening')).toBeNull();
    expect(expandAggregateColumnHeader('Day 1')).toBeNull();
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
