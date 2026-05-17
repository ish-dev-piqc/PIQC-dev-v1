// Unit tests for the PIQC ambient-signals API.
//
// Two contracts get locked here:
//
//   1. v1 silent-degrade — the count-only helper returns 0 + logs on
//      error and never throws. The dock UX depends on this; a thrown
//      error would crash the shell mount and PIQC's quietest surface
//      would become "Application Error."
//
//   2. v2 theme aggregation — the new fetchers group rows by the
//      underlying field value (SOTR `field_type` / questionnaire
//      `section_title`), sort descending by count with deterministic
//      tie-breaking, and silent-degrade on error the same way.
//
// We do NOT lock the hint-threshold logic here — that lives in
// usePiqcSignals.ts (buildThemeHint) and is tested in
// usePiqcSignals.test.tsx. signalsApi's only job is to return the
// counted-and-sorted themes; the consuming hook decides whether they
// rise to a hint.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  countQuestionnaireFlaggedResponses,
  fetchFlaggedResponsesSignal,
  fetchSotrAwaitingReviewSignal,
} from '../signalsApi';

// A flexible chainable mock — covers .select.eq.eq (head:true count),
// .select.eq.eq (full rows), and .select.eq.or chains. The shared
// `pending` state lets each test set the next response: either
// `{ count, error }` for head:true count calls or `{ data, error }`
// for row-fetch calls.
vi.mock('../../supabase', () => {
  type CountResp = { count: number | null; error: { message: string } | null };
  type DataResp  = { data: unknown[] | null; error: { message: string } | null };
  let pending: CountResp | DataResp = { count: 0, error: null };
  const chain = {
    select: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    or:     vi.fn(() => chain),
    // PostgREST query builders are thenables. Resolving with whatever
    // shape the test set lets one mock cover both .head and .data calls.
    then:   (resolve: (v: typeof pending) => unknown) => resolve(pending),
  };
  return {
    supabase: { from: vi.fn(() => chain) },
    __setPending: (next: typeof pending) => { pending = next; },
  };
});

import * as supabaseModule from '../../supabase';
const setPending = (supabaseModule as unknown as {
  __setPending: (next: { count?: number | null; data?: unknown[] | null; error: { message: string } | null }) => void;
}).__setPending;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ============================================================================
// v1 — count-only helper (back-compat surface)
// ============================================================================

describe('countQuestionnaireFlaggedResponses — count contract', () => {
  it('returns the count when the query succeeds', async () => {
    setPending({ count: 5, error: null });
    const n = await countQuestionnaireFlaggedResponses('audit-1');
    expect(n).toBe(5);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns 0 when count is null (PostgREST head:true with no rows)', async () => {
    setPending({ count: null, error: null });
    const n = await countQuestionnaireFlaggedResponses('audit-1');
    expect(n).toBe(0);
  });
});

describe('countQuestionnaireFlaggedResponses — silent-degrade contract', () => {
  it('returns 0 AND logs on error (never throws — dock UX depends on this)', async () => {
    setPending({ count: null, error: { message: 'permission denied' } });
    const n = await countQuestionnaireFlaggedResponses('audit-1');
    expect(n).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// v2 — fetchFlaggedResponsesSignal (themed by questionnaire section_title)
// ============================================================================

describe('fetchFlaggedResponsesSignal — theme aggregation', () => {
  it('groups by section_title and sorts descending by count', async () => {
    setPending({
      data: [
        { id: '1', questionnaire_questions: { section_title: 'Vendor oversight' } },
        { id: '2', questionnaire_questions: { section_title: 'Visit conduct' } },
        { id: '3', questionnaire_questions: { section_title: 'Vendor oversight' } },
        { id: '4', questionnaire_questions: { section_title: 'Vendor oversight' } },
      ],
      error: null,
    });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result.count).toBe(4);
    expect(result.themes).toEqual([
      { label: 'Vendor oversight', count: 3 },
      { label: 'Visit conduct',    count: 1 },
    ]);
  });

  it('handles PostgREST returning the joined relation as an array', async () => {
    // PostgREST sometimes returns nested relations as arrays even when
    // the relationship is 1:1 — we normalize both shapes.
    setPending({
      data: [
        { id: '1', questionnaire_questions: [{ section_title: 'Safety' }] },
        { id: '2', questionnaire_questions: [{ section_title: 'Safety' }] },
      ],
      error: null,
    });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result.count).toBe(2);
    expect(result.themes).toEqual([{ label: 'Safety', count: 2 }]);
  });

  it('breaks ties deterministically (label asc) for stable test/UI output', async () => {
    setPending({
      data: [
        { id: '1', questionnaire_questions: { section_title: 'Zeta' } },
        { id: '2', questionnaire_questions: { section_title: 'Alpha' } },
      ],
      error: null,
    });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result.themes).toEqual([
      { label: 'Alpha', count: 1 },
      { label: 'Zeta',  count: 1 },
    ]);
  });

  it('returns empty signal when no rows match', async () => {
    setPending({ data: [], error: null });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result).toEqual({ count: 0, themes: [] });
  });

  it('keeps orphan-join rows in count but excludes them from themes (honesty)', async () => {
    // Scenario: 3 flagged responses, but one has a missing/empty
    // section_title on the join (deleted question, FK gap, etc.).
    // The count must stay at 3 (the auditor flagged 3) and themes
    // must only describe the 2 we can name — otherwise the hint
    // would claim coverage of a row we couldn't read.
    setPending({
      data: [
        { id: '1', questionnaire_questions: { section_title: 'Vendor oversight' } },
        { id: '2', questionnaire_questions: { section_title: 'Vendor oversight' } },
        { id: '3', questionnaire_questions: null },
      ],
      error: null,
    });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result.count).toBe(3);
    expect(result.themes).toEqual([{ label: 'Vendor oversight', count: 2 }]);
  });

  it('also excludes rows whose joined section_title is empty/missing', async () => {
    setPending({
      data: [
        { id: '1', questionnaire_questions: { section_title: 'Vendor oversight' } },
        { id: '2', questionnaire_questions: { section_title: '' } }, // empty string
        { id: '3', questionnaire_questions: [] },                    // empty array
      ],
      error: null,
    });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result.count).toBe(3);
    expect(result.themes).toEqual([{ label: 'Vendor oversight', count: 1 }]);
  });

  it('silent-degrades on error (count: 0, themes: [], logs)', async () => {
    setPending({ data: null, error: { message: 'rls denial' } });
    const result = await fetchFlaggedResponsesSignal('audit-1');
    expect(result).toEqual({ count: 0, themes: [] });
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ============================================================================
// v2 — fetchSotrAwaitingReviewSignal (themed by SOTR field_type)
// ============================================================================

describe('fetchSotrAwaitingReviewSignal — theme aggregation', () => {
  it('groups by field_type using the human-readable label map', async () => {
    setPending({
      data: [
        { id: '1', field_type: 'visit' },
        { id: '2', field_type: 'visit' },
        { id: '3', field_type: 'criterion' },
      ],
      error: null,
    });
    const result = await fetchSotrAwaitingReviewSignal('protocol-1');
    expect(result.count).toBe(3);
    // 'visit' → 'visit schedule', 'criterion' → 'eligibility criteria'
    expect(result.themes).toEqual([
      { label: 'visit schedule',      count: 2 },
      { label: 'eligibility criteria', count: 1 },
    ]);
  });

  it('excludes unmapped field_type rows from themes but keeps them in the count', async () => {
    // Honesty contract: the count must reflect every awaiting-review
    // item the auditor will see in the queue, but themes only contain
    // categories PIQC can name. This prevents grammatical garbage like
    // "all about other" from ever rising into a hint.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPending({
      data: [
        { id: '1', field_type: 'unknown_kind_xyz' },
        { id: '2', field_type: 'unknown_kind_xyz' }, // 2nd occurrence — should NOT re-log
        { id: '3', field_type: null },               // null → excluded silently (no warn)
        { id: '4', field_type: 'visit' },            // mapped → 'visit schedule'
      ],
      error: null,
    });
    const result = await fetchSotrAwaitingReviewSignal('protocol-1');
    expect(result.count).toBe(4);
    expect(result.themes).toEqual([{ label: 'visit schedule', count: 1 }]);
    // Log-once discipline — warning fires only on the first novel
    // unmapped enum value, not on nulls and not on repeats.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/unknown_kind_xyz/);
    warnSpy.mockRestore();
  });

  it('returns empty themes when every row has an unmapped/null field_type (count still truthful)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setPending({
      data: [
        { id: '1', field_type: null },
        { id: '2', field_type: null },
      ],
      error: null,
    });
    const result = await fetchSotrAwaitingReviewSignal('protocol-1');
    expect(result).toEqual({ count: 2, themes: [] });
    warnSpy.mockRestore();
  });

  it('returns empty signal when no rows match', async () => {
    setPending({ data: [], error: null });
    const result = await fetchSotrAwaitingReviewSignal('protocol-1');
    expect(result).toEqual({ count: 0, themes: [] });
  });

  it('silent-degrades on error (count: 0, themes: [], logs)', async () => {
    setPending({ data: null, error: { message: 'rls denial' } });
    const result = await fetchSotrAwaitingReviewSignal('protocol-1');
    expect(result).toEqual({ count: 0, themes: [] });
    expect(errorSpy).toHaveBeenCalled();
  });
});
