import { describe, it, expect } from 'vitest';
import { canonicalVisitName, normalizeVisitName } from '../visitNameNormalize';

// =============================================================================
// visitNameNormalize (Vite copy) — pure time/cycle parenthetical stripping.
//
// The Deno copy already has a fuller suite at
// supabase/functions/_shared/__tests__/visitNameNormalize.test.ts (which also
// runs the Deno↔Vite parity assertions). This file exists to (a) lock the
// legitimate collapses the module is CONTRACTUALLY required to keep, and
// (b) document the SOT-301 cross-cycle over-collapse as a known, UNFIXED gap
// at this layer — see the skipped block at the bottom.
// =============================================================================

describe('canonicalVisitName — legitimate collapses (must stay stripped)', () => {
  it('strips pure time/cycle restatements (same logical visit, name variants)', () => {
    // Reducto emits the SAME visit under these variants; the day is already
    // carried by study_day, so the parenthetical is redundant and gets dropped.
    expect(canonicalVisitName('Treatment Visit 1 (Cycle 1 Day 1)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visit 1 (Day 1, Cycle 1)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visit 1 (Week 0)')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('Treatment Visits 2, 3, 4, 5, 6 (Weeks 2, 4, 6, 8, 10)')).toBe(
      'Treatment Visits 2, 3, 4, 5, 6',
    );
  });

  it('KEEPS semantic parentheticals (distinct visits — no false collapse)', () => {
    // Same-day PK substudy is a DISTINCT visit from the plain visit: the
    // parenthetical carries meaning that is not a time/cycle restatement.
    expect(canonicalVisitName('Visit 7 (PK substudy)')).toBe('Visit 7 (PK substudy)');
    expect(canonicalVisitName('Screening (Unscheduled)')).toBe('Screening (Unscheduled)');
    expect(canonicalVisitName('Follow-up (±3 days)')).toBe('Follow-up (±3 days)');
    expect(canonicalVisitName('EOT Visit')).toBe('EOT Visit');
  });

  it('collapses whitespace, trims, handles null/empty', () => {
    expect(canonicalVisitName('  Treatment   Visit 1  (Week 0) ')).toBe('Treatment Visit 1');
    expect(canonicalVisitName('')).toBe('');
    expect(canonicalVisitName(null)).toBe('');
    expect(canonicalVisitName(undefined)).toBe('');
  });
});

describe('normalizeVisitName — dedup/grouping key', () => {
  it('collapses the day-1 variants of one visit to a single key', () => {
    const k = normalizeVisitName('Treatment Visit 1');
    expect(k).toBe('treatment visit 1');
    expect(normalizeVisitName('Treatment Visit 1 (Cycle 1 Day 1)')).toBe(k);
    expect(normalizeVisitName('Treatment Visit 1 (Day 1, Cycle 1)')).toBe(k);
    expect(normalizeVisitName('Treatment Visit 1 (Week 0)')).toBe(k);
  });

  it('keeps a same-day PK substudy DISTINCT from the plain visit', () => {
    expect(normalizeVisitName('Visit 7 (PK substudy)')).not.toBe(normalizeVisitName('Visit 7'));
  });

  it('is backward-compatible for names without a time/cycle parenthetical', () => {
    expect(normalizeVisitName('  Screening  ')).toBe('screening');
    expect(normalizeVisitName('Assessment Visit Month 3')).toBe('assessment visit month 3');
  });
});

// =============================================================================
// SOT-301 — KNOWN GAP, deliberately left UNFIXED at this layer.
//
// Bug: two visits that differ ONLY by cycle number canonicalize to the same key
// ("Visit 2 (Cycle 1 Day 8)" and "Visit 2 (Cycle 2 Day 8)" both → "visit 2"),
// so dedupeVisitArray groups them as one visit and the Cycle-2 evidence is
// paired to the Cycle-1 visit (or silently dropped as a duplicate).
//
// WHY NO FIX HERE: canonicalVisitName is a PURE, single-name function. The
// locked collapse "Treatment Visit 1 (Cycle 1 Day 1)" → "Treatment Visit 1" and
// the bug case "Visit 2 (Cycle 1 Day 8)" are the SAME lexical shape:
// "<base> (Cycle <n> Day <m>)". What makes the bug case two distinct visits is
// the EXISTENCE OF A SIBLING with a different cycle number — information a
// single-name string function structurally cannot see. Any lexical rule that
// keeps "(Cycle 1 Day 8)" distinct would also stop stripping "(Cycle 1 Day 1)"
// and break the documented variant-collapse contract above. There is no
// conservative rule that separates them without a guess, and over-collapse
// (merging two real cycles) is the worse clinical failure.
//
// RESOLVED at the adapter layer (SOT-301 fix option b): dedupeVisitArray now
// splits a name-group that spans ≥2 distinct cycle numbers parsed from the
// RAW names (see sourceEvidenceAdapter.test.ts, SOT-301 block). The normalizer
// itself intentionally still collides on cycle-only differences — that IS its
// restatement contract, locked above — so the division of labor is:
// normalizer collapses variants; adapter refuses to merge distinct cycles.
// =============================================================================
describe('SOT-301 division of labor (adapter splits cycles, normalizer does not)', () => {
  it('normalizer intentionally collides on cycle-only differences (adapter handles the split)', () => {
    expect(normalizeVisitName('Visit 2 (Cycle 1 Day 8)')).toBe(
      normalizeVisitName('Visit 2 (Cycle 2 Day 8)'),
    );
  });
});
