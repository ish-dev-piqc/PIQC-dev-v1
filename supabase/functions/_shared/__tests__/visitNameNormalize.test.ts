import { describe, it, expect } from 'vitest';
import { canonicalVisitName, normalizeVisitName } from '../visitNameNormalize.ts';
// The Vite-side mirror — imported here so a single test asserts the two
// runtime copies stay byte-identical (they can't share an import).
import {
  canonicalVisitName as canonicalVite,
  normalizeVisitName as normalizeVite,
} from '../../../../src/lib/sotr/visitNameNormalize.ts';

// =============================================================================
// visitNameNormalize — strip pure time/cycle parentheticals so Reducto's
// name-variants collapse, while keeping semantic parentheticals. Conservative:
// a false collapse (merging two real visits) is worse than a false split.
// =============================================================================

describe('canonicalVisitName (stored display)', () => {
  it('strips pure time/cycle parentheticals — the variant-collapse fix', () => {
    expect(canonicalVisitName('Treatment Visit 1 (Cycle 1 Day 1)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visit 1 (Day 1, Cycle 1)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visit 1 (Week 0)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visits 2, 3, 4, 5, 6 (Weeks 2, 4, 6, 8, 10)'))
      .toBe('Treatment Visits 2, 3, 4, 5, 6');
  });

  it('preserves case and KEEPS semantic parentheticals', () => {
    expect(canonicalVisitName('Visit 7 (PK substudy)')).toBe('Visit 7 (PK substudy)');
    expect(canonicalVisitName('Screening (Unscheduled)')).toBe('Screening (Unscheduled)');
    expect(canonicalVisitName('EOT Visit')).toBe('EOT Visit');
    expect(canonicalVisitName('Follow-up (±3 days)')).toBe('Follow-up (±3 days)');
  });

  it('collapses whitespace, trims, handles null/empty', () => {
    expect(canonicalVisitName('  Treatment   Visit 1  (Week 0) ')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('')).toBe('');
    expect(canonicalVisitName(null)).toBe('');
    expect(canonicalVisitName(undefined)).toBe('');
  });
});

describe('normalizeVisitName (dedup/lookup key)', () => {
  it('collapses the four day-1 variants to one key', () => {
    const k = normalizeVisitName('Treatment Visit 1');
    expect(k).toBe('treatment visit 1');
    expect(normalizeVisitName('Treatment Visit 1 (Cycle 1 Day 1)')).toBe(k);
    expect(normalizeVisitName('Treatment Visit 1 (Day 1, Cycle 1)')).toBe(k);
    expect(normalizeVisitName('Treatment Visit 1 (Week 0)')).toBe(k);
  });

  it('keeps genuinely-different visits DISTINCT (no false collapse)', () => {
    expect(normalizeVisitName('Visit 7 (PK substudy)')).not.toBe(normalizeVisitName('Visit 7'));
  });

  it('is backward-compatible for names without a time/cycle parenthetical', () => {
    expect(normalizeVisitName('  Screening  ')).toBe('screening');
    expect(normalizeVisitName('Assessment Visit Month 3')).toBe('assessment visit month 3');
  });
});

describe('Deno ↔ Vite normalizer parity (guards drift)', () => {
  const corpus = [
    'Treatment Visit 1', 'Treatment Visit 1 (Cycle 1 Day 1)', 'Treatment Visit 1 (Day 1, Cycle 1)',
    'Treatment Visit 1 (Week 0)', 'Treatment Visits 2, 3, 4, 5, 6 (Weeks 2, 4, 6, 8, 10)',
    'Visit 7 (PK substudy)', 'Screening (Unscheduled)', 'EOT Visit', 'Follow-up (±3 days)',
    'Assessment Visit: Month 3', '  weird   spacing (week 2) ', '',
  ];
  it('canonicalVisitName is identical across runtimes', () => {
    for (const s of corpus) expect(canonicalVite(s)).toBe(canonicalVisitName(s));
  });
  it('normalizeVisitName is identical across runtimes', () => {
    for (const s of corpus) expect(normalizeVite(s)).toBe(normalizeVisitName(s));
  });
});
