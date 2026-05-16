// Unit tests for the PIQC ambient-signals API.
//
// The function is a one-line count query, but the contract it carries is
// the doctrine line: silent degradation on error. The dock UX depends on
// this — a thrown error from a permission-denied response would crash the
// shell mount, and PIQC's quietest surface is the LAST place we want
// "Application Error." So this file mostly locks: "errors return 0 + log,
// never throw."

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { countQuestionnaireFlaggedResponses } from '../signalsApi';

vi.mock('../../supabase', () => {
  // Returns a chainable thenable so .from(...).select(...).eq(...).eq(...)
  // resolves to the configured payload. Single shared resolver lets each
  // test set the response for one call.
  let pending: { count: number | null; error: { message: string } | null } = {
    count: 0,
    error: null,
  };
  const chain = {
    select: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    then:   (resolve: (v: typeof pending) => unknown) => resolve(pending),
  };
  return {
    supabase: {
      from: vi.fn(() => chain),
    },
    // Test helper to set the next response.
    __setPending: (next: typeof pending) => { pending = next; },
  };
});

import * as supabaseModule from '../../supabase';
const setPending = (supabaseModule as unknown as {
  __setPending: (next: { count: number | null; error: { message: string } | null }) => void;
}).__setPending;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

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
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe('countQuestionnaireFlaggedResponses — silent-degrade contract', () => {
  it('returns 0 AND logs on error (never throws — the dock UX depends on this)', async () => {
    setPending({ count: null, error: { message: 'permission denied' } });
    const n = await countQuestionnaireFlaggedResponses('audit-1');
    expect(n).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
  });
});
