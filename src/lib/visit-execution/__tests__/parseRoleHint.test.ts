import { describe, expect, it } from 'vitest';
import { itemMatchesRoleFilter, parseRoleHint } from '../parseRoleHint';

// =============================================================================
// parseRoleHint + itemMatchesRoleFilter — Sprint 6.
//
// Tests cover the documented edge cases:
//   - Single-role hints (case-insensitive, compound phrases)
//   - Multi-role hints ("Pharmacist + Coordinator")
//   - Unscoped (null / empty / whitespace / unrecognized)
//   - Determinism (sorted output by ROLE_ORDER)
//   - itemMatchesRoleFilter safety default (unscoped shows for all roles)
// =============================================================================

describe('parseRoleHint — single-role', () => {
  it('maps "Coordinator" → ["coordinator"]', () => {
    expect(parseRoleHint('Coordinator')).toEqual(['coordinator']);
  });

  it('maps "Nurse" → ["nurse"]', () => {
    expect(parseRoleHint('Nurse')).toEqual(['nurse']);
  });

  it('maps "Investigator" → ["investigator"]', () => {
    expect(parseRoleHint('Investigator')).toEqual(['investigator']);
  });

  it('maps "Lab" → ["lab"]', () => {
    expect(parseRoleHint('Lab')).toEqual(['lab']);
  });

  it('maps "Pharmacist" → ["pharmacy"]', () => {
    expect(parseRoleHint('Pharmacist')).toEqual(['pharmacy']);
  });

  it('maps "Pharmacy" → ["pharmacy"]', () => {
    expect(parseRoleHint('Pharmacy')).toEqual(['pharmacy']);
  });
});

describe('parseRoleHint — case-insensitive + compound phrases', () => {
  it('is case-insensitive: "COORDINATOR" → ["coordinator"]', () => {
    expect(parseRoleHint('COORDINATOR')).toEqual(['coordinator']);
  });

  it('matches "Phlebotomy nurse" → ["nurse"]', () => {
    expect(parseRoleHint('Phlebotomy nurse')).toEqual(['nurse']);
  });

  it('matches "Lab tech" → ["lab"]', () => {
    expect(parseRoleHint('Lab tech')).toEqual(['lab']);
  });

  it('matches "PI" → ["investigator"]', () => {
    expect(parseRoleHint('PI')).toEqual(['investigator']);
  });

  it('matches "Coord" abbreviation → ["coordinator"]', () => {
    expect(parseRoleHint('Coord')).toEqual(['coordinator']);
  });
});

describe('parseRoleHint — multi-role', () => {
  it('parses "Pharmacist + Coordinator" → [coordinator, pharmacy] (sorted by ROLE_ORDER)', () => {
    // Critical: output order is deterministic — coordinator comes before
    // pharmacy in ROLE_ORDER regardless of input phrasing.
    expect(parseRoleHint('Pharmacist + Coordinator')).toEqual(['coordinator', 'pharmacy']);
  });

  it('handles reversed input: "Coordinator + Pharmacist" → [coordinator, pharmacy]', () => {
    expect(parseRoleHint('Coordinator + Pharmacist')).toEqual(['coordinator', 'pharmacy']);
  });

  it('handles "Nurse and Lab tech" → [nurse, lab]', () => {
    expect(parseRoleHint('Nurse and Lab tech')).toEqual(['nurse', 'lab']);
  });
});

describe('parseRoleHint — unscoped (returns empty)', () => {
  it('returns [] for null', () => {
    expect(parseRoleHint(null)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(parseRoleHint(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseRoleHint('')).toEqual([]);
  });

  it('returns [] for whitespace-only string', () => {
    expect(parseRoleHint('   \n\t  ')).toEqual([]);
  });

  it('returns [] for "Site staff" (unscoped marker — no role keyword present)', () => {
    expect(parseRoleHint('Site staff')).toEqual([]);
  });

  it('returns [] for "Patient" (not a clinical role we filter on)', () => {
    expect(parseRoleHint('Patient')).toEqual([]);
  });

  it('returns [] for completely-unrecognized text', () => {
    expect(parseRoleHint('foobar')).toEqual([]);
  });
});

describe('parseRoleHint — determinism', () => {
  it('produces the same output for the same input across multiple calls', () => {
    const input = 'Pharmacist + Coordinator + Nurse';
    expect(parseRoleHint(input)).toEqual(parseRoleHint(input));
  });

  it('preserves ROLE_ORDER regardless of input keyword positions', () => {
    expect(parseRoleHint('Pharmacist nurse coordinator investigator lab')).toEqual([
      'coordinator',
      'nurse',
      'investigator',
      'lab',
      'pharmacy',
    ]);
  });
});

// ===========================================================================
// itemMatchesRoleFilter — predicate used by the checklist + export filter
// ===========================================================================

describe('itemMatchesRoleFilter — all-filter is a no-op', () => {
  it('returns true for any role_hint when filter is "all"', () => {
    expect(itemMatchesRoleFilter('Coordinator', 'all')).toBe(true);
    expect(itemMatchesRoleFilter(null, 'all')).toBe(true);
    expect(itemMatchesRoleFilter('Site staff', 'all')).toBe(true);
    expect(itemMatchesRoleFilter('Pharmacist + Coordinator', 'all')).toBe(true);
  });
});

describe('itemMatchesRoleFilter — exact role match', () => {
  it('matches when role_hint maps to the filter role', () => {
    expect(itemMatchesRoleFilter('Nurse', 'nurse')).toBe(true);
    expect(itemMatchesRoleFilter('Phlebotomy nurse', 'nurse')).toBe(true);
  });

  it('does NOT match when role_hint maps to a different role', () => {
    expect(itemMatchesRoleFilter('Coordinator', 'nurse')).toBe(false);
    expect(itemMatchesRoleFilter('Lab tech', 'nurse')).toBe(false);
  });
});

describe('itemMatchesRoleFilter — multi-role hint matches any', () => {
  it('matches under coordinator filter when hint is "Pharmacist + Coordinator"', () => {
    expect(itemMatchesRoleFilter('Pharmacist + Coordinator', 'coordinator')).toBe(true);
  });

  it('matches under pharmacy filter when hint is "Pharmacist + Coordinator"', () => {
    expect(itemMatchesRoleFilter('Pharmacist + Coordinator', 'pharmacy')).toBe(true);
  });

  it('does NOT match under nurse filter when hint is "Pharmacist + Coordinator"', () => {
    expect(itemMatchesRoleFilter('Pharmacist + Coordinator', 'nurse')).toBe(false);
  });
});

describe('itemMatchesRoleFilter — unscoped safety default', () => {
  it('null role_hint shows for every role filter (clinical-default safety)', () => {
    expect(itemMatchesRoleFilter(null, 'coordinator')).toBe(true);
    expect(itemMatchesRoleFilter(null, 'nurse')).toBe(true);
    expect(itemMatchesRoleFilter(null, 'investigator')).toBe(true);
    expect(itemMatchesRoleFilter(null, 'lab')).toBe(true);
    expect(itemMatchesRoleFilter(null, 'pharmacy')).toBe(true);
  });

  it('"Site staff" (unscoped marker) shows for every role filter', () => {
    expect(itemMatchesRoleFilter('Site staff', 'coordinator')).toBe(true);
    expect(itemMatchesRoleFilter('Site staff', 'pharmacy')).toBe(true);
  });

  it('empty / whitespace shows for every role filter', () => {
    expect(itemMatchesRoleFilter('', 'lab')).toBe(true);
    expect(itemMatchesRoleFilter('  ', 'lab')).toBe(true);
  });
});
