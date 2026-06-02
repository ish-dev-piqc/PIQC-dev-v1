import { describe, it, expect } from 'vitest';
import { coerceStudyDay } from '../studyDayCoerce.ts';

// =============================================================================
// coerceStudyDay — recovers study_day from number / numeric-string / "Day N",
// and returns null for genuinely ambiguous text. The null path is what stops
// the silent drop of visits whose day Reducto returned as a string (the missing
// Visit 5/6 bug): the caller drops-with-a-warning instead of losing the visit.
// =============================================================================

describe('coerceStudyDay', () => {
  it('passes through finite numbers, truncating', () => {
    expect(coerceStudyDay(42)).toBe(42);
    expect(coerceStudyDay(0)).toBe(0);
    expect(coerceStudyDay(-3)).toBe(-3);
    expect(coerceStudyDay(42.9)).toBe(42);
  });

  it('recovers numeric and "Day N" strings (the bug fix)', () => {
    expect(coerceStudyDay('57')).toBe(57);
    expect(coerceStudyDay('  57  ')).toBe(57);
    expect(coerceStudyDay('-14')).toBe(-14);
    expect(coerceStudyDay('Day 1')).toBe(1);
    expect(coerceStudyDay('Day: 5')).toBe(5);
    expect(coerceStudyDay('Day 14 days')).toBe(14);
  });

  it('keeps the anchor day, not the ± window', () => {
    expect(coerceStudyDay('Day 168 ± 7')).toBe(168);
    expect(coerceStudyDay('168+7')).toBe(168);
    expect(coerceStudyDay('168 ± 7')).toBe(168);
  });

  it('treats a leading dash as a negative day, not a separator', () => {
    // Regression guard: an earlier `[:\-]?` separator ate the sign → +14.
    expect(coerceStudyDay('Day -14')).toBe(-14);
    expect(coerceStudyDay('Day-14')).toBe(-14);
  });

  it('returns null for ambiguous / non-day text (caller drops + warns)', () => {
    expect(coerceStudyDay('Week 24')).toBeNull();            // would need *7 guesswork
    expect(coerceStudyDay('30 days post last dose')).toBeNull();
    expect(coerceStudyDay('1 to 28')).toBeNull();            // a range, not one day
    expect(coerceStudyDay('C1D1')).toBeNull();
    expect(coerceStudyDay('Screening')).toBeNull();
    expect(coerceStudyDay('')).toBeNull();
  });

  it('returns null for non-finite numbers and non-string/number input', () => {
    expect(coerceStudyDay(NaN)).toBeNull();
    expect(coerceStudyDay(Infinity)).toBeNull();
    expect(coerceStudyDay(null)).toBeNull();
    expect(coerceStudyDay(undefined)).toBeNull();
    expect(coerceStudyDay({})).toBeNull();
    expect(coerceStudyDay([5])).toBeNull();
  });
});
