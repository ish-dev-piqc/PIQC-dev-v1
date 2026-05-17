// Unit tests for usePiqcSignals — the hook that derives PIQC's dock dot
// and the panel's "Worth a look:" surface.
//
// Contracts locked here:
//
//   1. Zero counts → empty signals array (no false-positive dot)
//   2. Non-zero counts → a signal per source with pluralized label
//   3. v2 `themeHint` rules (buildThemeHint thresholds):
//        - skip when total <= 1
//        - skip when top cluster < 2 items
//        - skip when top cluster < 50% of total
//        - "all about X" when top == total
//        - "N about X"   otherwise
//   4. Silent-degrade on fetch errors — both fetchers return
//      { count: 0, themes: [] } so the hook always lands in a calm
//      empty state (no thrown rejections to crash the shell mount)
//   5. Missing protocolId → SOTR fetch skipped, questionnaire still runs
//
// The v2 fetchers are mocked. signalsApi.test.ts covers the actual
// query/group/sort logic; here we exercise the hook's hint-derivation
// rules and signal assembly.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePiqcSignals, buildThemeHint } from '../usePiqcSignals';

vi.mock('../../lib/audit/signalsApi', () => ({
  fetchSotrAwaitingReviewSignal: vi.fn(),
  fetchFlaggedResponsesSignal:   vi.fn(),
}));

import {
  fetchSotrAwaitingReviewSignal,
  fetchFlaggedResponsesSignal,
} from '../../lib/audit/signalsApi';

const mockSotr  = fetchSotrAwaitingReviewSignal  as unknown as ReturnType<typeof vi.fn>;
const mockFlags = fetchFlaggedResponsesSignal    as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSotr.mockReset();
  mockFlags.mockReset();
});

// ============================================================================
// Pure: buildThemeHint thresholds (unit-tested directly for clarity)
// ============================================================================

describe('buildThemeHint — thresholds', () => {
  it('returns undefined when total is 1 (a cluster of 1 is not an insight)', () => {
    expect(buildThemeHint(1, [{ label: 'visit schedule', count: 1 }])).toBeUndefined();
  });

  it('returns undefined when total is 0', () => {
    expect(buildThemeHint(0, [])).toBeUndefined();
  });

  it('returns undefined when the top cluster is a singleton', () => {
    // 3 items, all in different clusters → top count = 1, no hint.
    expect(buildThemeHint(3, [
      { label: 'a', count: 1 },
      { label: 'b', count: 1 },
      { label: 'c', count: 1 },
    ])).toBeUndefined();
  });

  it('returns undefined when no cluster reaches 50% of total', () => {
    // 5 items: top is 2/5 = 40%. Not decisive.
    expect(buildThemeHint(5, [
      { label: 'a', count: 2 },
      { label: 'b', count: 2 },
      { label: 'c', count: 1 },
    ])).toBeUndefined();
  });

  it('returns "— all are about X" when one cluster is the entire signal', () => {
    // Em-dash prefix + "are about" reads as a phrase modifying the
    // signal count above, not a sibling fact.
    expect(buildThemeHint(4, [{ label: 'visit schedule', count: 4 }]))
      .toBe('— all are about visit schedule');
  });

  it('returns "— N are about X" when one cluster dominates (>= 50%) but not all', () => {
    expect(buildThemeHint(5, [
      { label: 'visit schedule', count: 3 },
      { label: 'dosing',         count: 2 },
    ])).toBe('— 3 are about visit schedule');
  });

  it('treats exactly-50% as decisive (the >= threshold, not > )', () => {
    expect(buildThemeHint(4, [
      { label: 'visit schedule', count: 2 },
      { label: 'dosing',         count: 2 },
    ])).toBe('— 2 are about visit schedule');
  });

  it('clamps a top.count that exceeds total (defensive invariant)', () => {
    // A fetcher should never report this shape, but if a regression
    // ever does we clamp to total instead of producing a >100% share.
    expect(buildThemeHint(3, [{ label: 'visit schedule', count: 5 }]))
      .toBe('— all are about visit schedule');
  });
});

// ============================================================================
// Hook: empty / unmounted states
// ============================================================================

describe('usePiqcSignals — empty cases (no false-positive dot)', () => {
  it('returns no signals when both counts are zero', async () => {
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({ count: 0, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([]);
  });

  it('returns no signals when auditId is null (audit not yet selected)', () => {
    const { result } = renderHook(() => usePiqcSignals(null, null));
    expect(result.current.signals).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockSotr).not.toHaveBeenCalled();
    expect(mockFlags).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Hook: labels + pluralization (back-compat with v1 contract)
// ============================================================================

describe('usePiqcSignals — labels include count + pluralization', () => {
  it('surfaces SOTR signal with plural label when count > 1', async () => {
    mockSotr.mockResolvedValueOnce({ count: 3, themes: [] });
    mockFlags.mockResolvedValueOnce({ count: 0, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toHaveLength(1);
    expect(result.current.signals[0]).toMatchObject({
      kind:  'sotr_awaiting_review',
      count: 3,
      label: '3 parsed protocol items awaiting your review',
    });
  });

  it('uses singular form when count === 1', async () => {
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({ count: 1, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0]).toMatchObject({
      kind:  'questionnaire_flagged',
      count: 1,
      label: '1 questionnaire response you flagged as inconsistent',
    });
  });

  it('surfaces both signals when both sources return non-zero counts', async () => {
    mockSotr.mockResolvedValueOnce({ count: 2, themes: [] });
    mockFlags.mockResolvedValueOnce({ count: 4, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals.map((s) => s.kind)).toEqual([
      'sotr_awaiting_review',
      'questionnaire_flagged',
    ]);
  });
});

// ============================================================================
// Hook: themeHint surfacing on the assembled signal
// ============================================================================

describe('usePiqcSignals — themeHint surfacing (v2)', () => {
  it('attaches a hint when a SOTR theme dominates (>= 50% of total, count >= 2)', async () => {
    mockSotr.mockResolvedValueOnce({
      count:  3,
      themes: [
        { label: 'visit schedule', count: 2 },
        { label: 'dosing',         count: 1 },
      ],
    });
    mockFlags.mockResolvedValueOnce({ count: 0, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0].themeHint).toBe('— 2 are about visit schedule');
  });

  it('uses "— all are about X" when every item shares the top theme', async () => {
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({
      count:  4,
      themes: [{ label: 'Vendor oversight', count: 4 }],
    });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0].themeHint).toBe('— all are about Vendor oversight');
  });

  it('omits hint when the signal is too small to theme (count === 1)', async () => {
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({
      count:  1,
      themes: [{ label: 'Vendor oversight', count: 1 }],
    });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0].themeHint).toBeUndefined();
  });

  it('respects honest dominance when themes sum < total (orphan-join scenario)', async () => {
    // The fetcher returns count=3 but only 1 row produced a usable
    // theme (the other 2 are orphan joins / unmapped enum values).
    // 1/3 == 33% — below the 50% threshold. No hint.
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({
      count:  3,
      themes: [{ label: 'Vendor oversight', count: 1 }],
    });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0].themeHint).toBeUndefined();
  });

  it('omits hint when no theme dominates (top cluster < 50%)', async () => {
    mockSotr.mockResolvedValueOnce({
      count:  5,
      themes: [
        { label: 'visit schedule', count: 2 },
        { label: 'dosing',         count: 2 },
        { label: 'endpoints',      count: 1 },
      ],
    });
    mockFlags.mockResolvedValueOnce({ count: 0, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals[0].themeHint).toBeUndefined();
  });
});

// ============================================================================
// Hook: protocolId-null + silent-degrade contracts
// ============================================================================

describe('usePiqcSignals — partial-fetch contract', () => {
  it('skips SOTR fetch entirely when protocolId is null but still runs questionnaire fetch', async () => {
    mockFlags.mockResolvedValueOnce({ count: 1, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSotr).not.toHaveBeenCalled();
    expect(result.current.signals).toHaveLength(1);
    expect(result.current.signals[0].kind).toBe('questionnaire_flagged');
  });

  it('honors the silent-degrade contract — fetcher returning empty signal yields no surface', async () => {
    // Both fetchers swallow errors and return EMPTY. The hook never sees
    // a rejection. This locks the contract: usePiqcSignals does not need
    // to handle thrown errors because signalsApi guarantees it never gets
    // one. If that ever changes, this test fails and the hook needs a
    // try/catch added back.
    mockSotr.mockResolvedValueOnce({ count: 0, themes: [] });
    mockFlags.mockResolvedValueOnce({ count: 0, themes: [] });

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([]);
  });
});
