import { describe, expect, it } from 'vitest';
import { winAnsiSafe } from '../winAnsiSafe';

// =============================================================================
// Mirrors the winAnsiSafe describe block from
// src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts (PR #520)
// against the hoisted shared module — the contract must not drift when the
// helper moves. The VEW test file keeps its own copy running against that
// module's re-export, so both entry points stay guarded.
// =============================================================================

describe('winAnsiSafe — data-driven text at the PDF boundary', () => {
  it('transliterates the clinically common non-WinAnsi symbols to ASCII', () => {
    expect(winAnsiSafe('dose ≤ 50 µg × 3 → titrate ≥ 25')).toBe(
      'dose <= 50 ug x 3 -> titrate >= 25',
    );
  });

  it('maps both mu variants (micro sign + Greek mu) to "u"', () => {
    expect(winAnsiSafe('µg/μL')).toBe('ug/uL');
  });

  it('maps true minus (U+2212) to an ASCII hyphen — same fix as the label pass', () => {
    expect(winAnsiSafe('−3 days')).toBe('-3 days');
  });

  it('keeps CP1252-representable typography intact', () => {
    const typography = '— – · § ± “quoted” ‘x’ … ° • ™ café';
    expect(winAnsiSafe(typography)).toBe(typography);
  });

  it("replaces anything else outside CP1252 with '?' (visible beats mojibake)", () => {
    expect(winAnsiSafe('⚠ ✓ ☑')).toBe('? ? ?');
    // Astral glyphs collapse to a single '?', not one per surrogate half.
    expect(winAnsiSafe('\u{1f48a}')).toBe('?');
  });

  it('passes pure ASCII through untouched, including autotable \\n cell breaks', () => {
    expect(winAnsiSafe('Vitals (BP, HR)\nIf: fever')).toBe('Vitals (BP, HR)\nIf: fever');
    expect(winAnsiSafe('')).toBe('');
  });
});
