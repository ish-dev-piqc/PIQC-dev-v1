// Unit tests for usePiqcSignals — the hook that derives PIQC's dock dot.
//
// The hook orchestrates two independent count fetches and surfaces them
// as a typed signal array. The contracts that matter (and that this file
// locks):
//
//   1. Zero counts → empty signals array (no false-positive dot)
//   2. Non-zero counts → a signal per source, with the count baked into
//      the human-readable label (singular/plural)
//   3. One source failing does NOT void the other (Promise.allSettled
//      contract — partial recall is better than silent zero)
//   4. Missing protocolId → SOTR signal silently skipped, questionnaire
//      signal still runs (audits without a protocol attached are real)
//
// Mocks: both underlying fetch functions. This isolates the hook's logic
// from the count queries themselves (those are covered elsewhere).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePiqcSignals } from '../usePiqcSignals';

vi.mock('../../lib/sotr/sourceEvidenceApi', () => ({
  countWorksheetItemsForStudy: vi.fn(),
}));
vi.mock('../../lib/audit/signalsApi', () => ({
  countQuestionnaireFlaggedResponses: vi.fn(),
}));

import { countWorksheetItemsForStudy } from '../../lib/sotr/sourceEvidenceApi';
import { countQuestionnaireFlaggedResponses } from '../../lib/audit/signalsApi';

const mockSotr = countWorksheetItemsForStudy as unknown as ReturnType<typeof vi.fn>;
const mockFlags = countQuestionnaireFlaggedResponses as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockSotr.mockReset();
  mockFlags.mockReset();
});

describe('usePiqcSignals — empty cases (no false-positive dot)', () => {
  it('returns no signals when both counts are zero', async () => {
    mockSotr.mockResolvedValueOnce({ total: 10, awaitingReview: 0 });
    mockFlags.mockResolvedValueOnce(0);

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([]);
  });

  it('returns no signals when auditId is null (audit not yet selected)', async () => {
    const { result } = renderHook(() => usePiqcSignals(null, null));
    // Synchronous empty state — no fetch should fire.
    expect(result.current.signals).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(mockSotr).not.toHaveBeenCalled();
    expect(mockFlags).not.toHaveBeenCalled();
  });
});

describe('usePiqcSignals — signal labels include count + pluralization', () => {
  it('surfaces SOTR signal with plural label when count > 1', async () => {
    mockSotr.mockResolvedValueOnce({ total: 50, awaitingReview: 3 });
    mockFlags.mockResolvedValueOnce(0);

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([
      {
        kind:  'sotr_awaiting_review',
        count: 3,
        label: '3 parsed protocol items awaiting your review',
      },
    ]);
  });

  it('uses singular form when count === 1', async () => {
    mockSotr.mockResolvedValueOnce({ total: 50, awaitingReview: 0 });
    mockFlags.mockResolvedValueOnce(1);

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([
      {
        kind:  'questionnaire_flagged',
        count: 1,
        label: '1 questionnaire response you flagged as inconsistent',
      },
    ]);
  });

  it('surfaces both signals when both sources return non-zero counts', async () => {
    mockSotr.mockResolvedValueOnce({ total: 50, awaitingReview: 2 });
    mockFlags.mockResolvedValueOnce(4);

    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toHaveLength(2);
    expect(result.current.signals.map((s) => s.kind)).toEqual([
      'sotr_awaiting_review',
      'questionnaire_flagged',
    ]);
  });
});

describe('usePiqcSignals — partial-failure contract (Promise.allSettled)', () => {
  it('SOTR rejection does NOT void the questionnaire signal', async () => {
    mockSotr.mockRejectedValueOnce(new Error('RLS denied'));
    mockFlags.mockResolvedValueOnce(2);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() => usePiqcSignals('audit-1', 'proto-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.signals).toEqual([
      {
        kind:  'questionnaire_flagged',
        count: 2,
        label: '2 questionnaire responses you flagged as inconsistent',
      },
    ]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('skips SOTR fetch entirely when protocolId is null but still runs questionnaire fetch', async () => {
    mockFlags.mockResolvedValueOnce(1);

    const { result } = renderHook(() => usePiqcSignals('audit-1', null));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockSotr).not.toHaveBeenCalled();
    expect(result.current.signals).toEqual([
      {
        kind:  'questionnaire_flagged',
        count: 1,
        label: '1 questionnaire response you flagged as inconsistent',
      },
    ]);
  });
});
