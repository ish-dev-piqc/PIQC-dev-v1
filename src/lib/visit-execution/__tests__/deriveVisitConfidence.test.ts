import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_SHORT_LABELS,
  CONFIDENCE_TOOLTIPS,
  deriveVisitConfidence,
} from '../deriveVisitConfidence';
import type {
  VisitConfidenceState,
  VisitExecutionItem,
  VisitSnapshot,
} from '../../../types/visit-execution';

// =============================================================================
// deriveVisitConfidence — Sprint 7.
//
// Pessimistic "weakest link" rollup. Tests cover:
//   - Server-trust branch (snapshot.confidence_state present)
//   - Empty items default (legacy / parser-gap)
//   - Severity precedence (needs_review > low > medium > high)
//   - Completeness-signal demotion (high → medium when signals pending)
//   - Pure determinism
//   - Sprint 6 interplay: derivation respects the filtered items input
// =============================================================================

function makeSnapshot(
  overrides: Partial<Pick<VisitSnapshot, 'confidence_state' | 'completeness_signal_count'>> = {},
): Pick<VisitSnapshot, 'confidence_state' | 'completeness_signal_count'> {
  return {
    confidence_state: null,
    completeness_signal_count: 0,
    ...overrides,
  };
}

function item(
  confidence_state: VisitConfidenceState | null,
): Pick<VisitExecutionItem, 'confidence_state'> {
  return { confidence_state };
}

// ---------------------------------------------------------------------------
// Server-trust branch
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — server-stamped wins', () => {
  it('returns snapshot.confidence_state when set (high)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ confidence_state: 'high' }), [item('low')]),
    ).toBe('high');
  });

  it('returns snapshot.confidence_state when set (low, even with high items)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ confidence_state: 'low' }), [item('high'), item('high')]),
    ).toBe('low');
  });

  it('returns snapshot.confidence_state when set (needs_review, even on empty items)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ confidence_state: 'needs_review' }), []),
    ).toBe('needs_review');
  });
});

// ---------------------------------------------------------------------------
// Empty-items default
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — empty-items default', () => {
  it('returns "needs_review" when items array is empty (no signal to derive)', () => {
    expect(deriveVisitConfidence(makeSnapshot(), [])).toBe('needs_review');
  });

  it('returns "needs_review" when items array is empty even with no pending signals', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 0 }), []),
    ).toBe('needs_review');
  });
});

// ---------------------------------------------------------------------------
// Severity precedence (pessimistic weakest-link)
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — pessimistic "weakest link"', () => {
  it('any "needs_review" item → "needs_review" (overrides everything)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [
        item('high'),
        item('high'),
        item('needs_review'),
      ]),
    ).toBe('needs_review');
  });

  it('"needs_review" wins over "low"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [item('low'), item('needs_review')]),
    ).toBe('needs_review');
  });

  it('any "low" item (no needs_review) → "low"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [item('high'), item('low'), item('medium')]),
    ).toBe('low');
  });

  it('"low" wins over signal-driven "medium"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 3 }), [
        item('high'),
        item('low'),
      ]),
    ).toBe('low');
  });

  it('any "medium" item (no low/needs_review, no signals) → "medium"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [item('high'), item('medium'), item('high')]),
    ).toBe('medium');
  });

  it('all "high" + no signals → "high"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [item('high'), item('high'), item('high')]),
    ).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Completeness-signal demotion
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — completeness-signal demotion', () => {
  it('all "high" items + N pending signals → "medium" (signals demote)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 1 }), [
        item('high'),
        item('high'),
      ]),
    ).toBe('medium');
  });

  it('all "high" items + 0 pending signals → "high"', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 0 }), [
        item('high'),
        item('high'),
      ]),
    ).toBe('high');
  });

  it('completeness signals do NOT promote anything', () => {
    // "low" stays "low" even with 0 signals; signals only DEMOTE.
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 0 }), [item('low')]),
    ).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Null handling
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — null-item-confidence handling', () => {
  it('items with null confidence_state are ignored (don\'t degrade rollup)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot(), [item(null), item(null), item('high')]),
    ).toBe('high');
  });

  it('all-null items + 0 signals → "needs_review" (never confidence-checked)', () => {
    // Honesty fix: a visit whose every item carries NO confidence value was
    // never scored, so it has no basis to claim 'high'. Server-stamped visits
    // hit the snapshot.confidence_state short-circuit instead; this branch only
    // catches truly unscored (legacy / parser-gap / unmatched) visits, which
    // should read as "needs review", not a false 'high'.
    expect(deriveVisitConfidence(makeSnapshot(), [item(null), item(null)])).toBe('needs_review');
  });

  it('all-null items + signals pending → "medium" (signal-demoted)', () => {
    expect(
      deriveVisitConfidence(makeSnapshot({ completeness_signal_count: 1 }), [
        item(null),
        item(null),
      ]),
    ).toBe('medium');
  });
});

// ---------------------------------------------------------------------------
// Determinism + Sprint 6 interplay
// ---------------------------------------------------------------------------

describe('deriveVisitConfidence — determinism', () => {
  it('produces the same output for the same input across multiple calls', () => {
    const snap = makeSnapshot({ completeness_signal_count: 2 });
    const items = [item('medium'), item('high'), item('low')];
    expect(deriveVisitConfidence(snap, items)).toBe(deriveVisitConfidence(snap, items));
  });

  it('order of items does NOT affect output (pessimistic scan is order-independent)', () => {
    const snap = makeSnapshot();
    expect(
      deriveVisitConfidence(snap, [item('low'), item('needs_review'), item('high')]),
    ).toBe(
      deriveVisitConfidence(snap, [item('high'), item('low'), item('needs_review')]),
    );
  });
});

describe('deriveVisitConfidence — Sprint 6 role-filter interplay', () => {
  it('derivation respects already-filtered input (caller controls scope)', () => {
    // If the caller filters items to a role view and only the "low" item
    // remains, the rollup should be "low" — NOT the rollup of the full
    // canonical set. The helper is pure; it trusts the items passed in.
    const allItems = [item('high'), item('high'), item('low')];
    const filteredToOneLowItem = [allItems[2]];
    expect(deriveVisitConfidence(makeSnapshot(), filteredToOneLowItem)).toBe('low');
  });

  it('all-high filtered subset gives "high" even when canonical set has low items', () => {
    const filteredToHighsOnly = [item('high'), item('high')];
    expect(deriveVisitConfidence(makeSnapshot(), filteredToHighsOnly)).toBe('high');
  });
});

// ---------------------------------------------------------------------------
// Label constants — guard against polish-strip
// ---------------------------------------------------------------------------

describe('confidence label constants', () => {
  it('CONFIDENCE_LABELS covers every VisitConfidenceState', () => {
    const states: VisitConfidenceState[] = ['high', 'medium', 'low', 'needs_review'];
    for (const s of states) {
      expect(CONFIDENCE_LABELS[s]).toBeTruthy();
      expect(CONFIDENCE_SHORT_LABELS[s]).toBeTruthy();
      expect(CONFIDENCE_TOOLTIPS[s]).toBeTruthy();
    }
  });

  it('tooltip text mentions PIQC + actionable framing (earns-trust copy guard)', () => {
    // Per feedback_vew_completeness_and_mastery.md: confidence indicators
    // are a "primary trust mechanism." Tooltip MUST tell the coordinator
    // what to do, not just label the state.
    expect(CONFIDENCE_TOOLTIPS.high).toMatch(/PIQC/);
    expect(CONFIDENCE_TOOLTIPS.medium).toMatch(/review/i);
    expect(CONFIDENCE_TOOLTIPS.low).toMatch(/protocol/i);
    expect(CONFIDENCE_TOOLTIPS.needs_review).toMatch(/protocol/i);
  });
});
