import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSiteNote,
  flagForReview,
  markNeedsClarification,
  markReviewed,
  unmarkReviewed,
} from '../visitExecutionMutationsApi';
import { MOCK_TOGGLE_KEY } from '../visitExecutionApi';
import { supabase } from '../../supabase';

// =============================================================================
// visitExecutionMutationsApi — Result<T> contract + mock-mode short-circuit
// + RPC argument shape + RPC error handling.
//
// All five exported mutations follow the same dispatch helper, so the tests
// hit each one at least once but lean on the markReviewed path to cover the
// dispatcher's branches in depth.
// =============================================================================

describe('mutations — mock mode on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('markReviewed returns synthetic success without calling supabase.rpc', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await markReviewed('req-1');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.requirement_id).toBe('req-1');
      expect(r.data.review_status).toBe('reviewed');
      expect(r.data.event_id).toContain('mark_reviewed');
    }
  });

  it('unmarkReviewed synthesizes review_status = not_reviewed', async () => {
    const r = await unmarkReviewed('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_status).toBe('not_reviewed');
  });

  it('flagForReview synthesizes review_status = needs_review', async () => {
    const r = await flagForReview('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_status).toBe('needs_review');
  });

  it('markNeedsClarification synthesizes review_status = needs_review', async () => {
    const r = await markNeedsClarification('req-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_status).toBe('needs_review');
  });

  it('addSiteNote synthesizes review_status = site_note_added', async () => {
    const r = await addSiteNote('req-1', 'Heparin lock in place');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_status).toBe('site_note_added');
  });
});

describe('mutations — real (mock off) RPC dispatch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('markReviewed calls visit_execution_set_review_status with action mark_reviewed', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requirement_id: 'req-1',
        review_status: 'reviewed',
        version: 1,
        event_id: 'evt-abc',
      }, error: null,
    } as any);

    await markReviewed('req-1');
    expect(spy).toHaveBeenCalledWith('visit_execution_set_review_status', {
      p_requirement_id: 'req-1',
      p_action: 'mark_reviewed',
      p_note: null,
    });
  });

  it('flagForReview forwards the optional note to p_note', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requirement_id: 'req-1', review_status: 'needs_review',
        version: 1, event_id: 'evt-xyz',
      }, error: null,
    } as any);

    await flagForReview('req-1', 'Looks unclear — re-read §7.3');
    expect(spy).toHaveBeenCalledWith('visit_execution_set_review_status', {
      p_requirement_id: 'req-1',
      p_action: 'flag_for_review',
      p_note: 'Looks unclear — re-read §7.3',
    });
  });

  it('returns RPC errors as ok:false (no throw)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'requirement not found' } as any,
    } as any);

    const r = await markReviewed('req-nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('requirement not found');
  });

  it('returns malformed RPC payload as ok:false rather than crashing the caller', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // RPC returned non-null but missing required fields.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { some_other_shape: true }, error: null,
    } as any);

    const r = await markReviewed('req-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('returns null-payload as ok:false rather than confusing the caller', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: null, error: null,
    } as any);

    const r = await markReviewed('req-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('addSiteNote calls with action add_site_note + the note string', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requirement_id: 'req-1', review_status: 'site_note_added',
        version: 1, event_id: 'evt-note',
      }, error: null,
    } as any);

    await addSiteNote('req-1', 'IV line was non-compliant per site SOP');
    expect(spy).toHaveBeenCalledWith('visit_execution_set_review_status', {
      p_requirement_id: 'req-1',
      p_action: 'add_site_note',
      p_note: 'IV line was non-compliant per site SOP',
    });
  });
});
