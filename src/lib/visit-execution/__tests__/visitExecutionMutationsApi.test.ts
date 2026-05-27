import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addSiteNote,
  editText,
  flagForReview,
  markNeedsClarification,
  markReviewed,
  resolveSignal,
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

// =============================================================================
// editText — Sprint 4b — routes through a DIFFERENT RPC
// (visit_execution_edit_text) than the set_review_status family.
// =============================================================================

describe('editText — programmer-error guard', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects empty newText before hitting RPC', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await editText('req-1', '');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-empty/);
  });

  it('rejects whitespace-only newText before hitting RPC', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await editText('req-1', '   \n\t  ');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
});

describe('editText — mock mode on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('synthesizes success with review_status edited + version bumped + current_text trimmed', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await editText('req-1', '  Pre-dose vitals (site-specific tweak)  ');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.review_status).toBe('edited');
      expect(r.data.current_text).toBe('Pre-dose vitals (site-specific tweak)');
      expect(r.data.version).toBeGreaterThan(1);
    }
  });
});

describe('editText — real (mock off) RPC dispatch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('calls visit_execution_edit_text with p_new_text trimmed + optional p_note', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requirement_id: 'req-1', review_status: 'edited', version: 3,
        current_text: 'New text', event_id: 'evt-edit',
      }, error: null,
    } as any);

    await editText('req-1', '  New text  ', 'rephrased for site clarity');
    expect(spy).toHaveBeenCalledWith('visit_execution_edit_text', {
      p_requirement_id: 'req-1',
      p_new_text: 'New text',
      p_note: 'rephrased for site clarity',
    });
  });

  it('omits note as null when not provided', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        requirement_id: 'req-1', review_status: 'edited', version: 2,
        current_text: 'X', event_id: 'evt-edit',
      }, error: null,
    } as any);

    await editText('req-1', 'X');
    expect(spy).toHaveBeenCalledWith('visit_execution_edit_text', {
      p_requirement_id: 'req-1',
      p_new_text: 'X',
      p_note: null,
    });
  });

  it('surfaces RPC errors as ok:false (no throw)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'requirement not found' } as any,
    } as any);

    const r = await editText('req-nope', 'whatever');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('requirement not found');
  });

  it('returns malformed RPC payload (missing current_text) as ok:false', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // current_text is required in the response — missing it = malformed.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { requirement_id: 'req-1', review_status: 'edited', version: 2 } as any,
      error: null,
    } as any);

    const r = await editText('req-1', 'New text');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});


// =============================================================================
// resolveSignal — Sprint 4c. Wraps visit_execution_resolve_completeness_signal.
// =============================================================================

describe('resolveSignal — mock mode on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('added_as_requirement synthesizes a stable requirement_id without RPC', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await resolveSignal('sig-1', 'added_as_requirement');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.signal_id).toBe('sig-1');
      expect(r.data.resolution).toBe('added_as_requirement');
      expect(r.data.requirement_id).toBe('mock-req-from-signal-sig-1');
      expect(r.data.already_resolved).toBe(false);
    }
  });

  it('dismissed_not_real leaves requirement_id null', async () => {
    const r = await resolveSignal('sig-2', 'dismissed_not_real');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.resolution).toBe('dismissed_not_real');
      expect(r.data.requirement_id).toBeNull();
    }
  });
});

describe('resolveSignal — real (mock off) RPC dispatch', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('calls visit_execution_resolve_completeness_signal with p_new_text null for dismiss', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        signal_id: 'sig-1',
        resolution: 'dismissed_not_real',
        requirement_id: null,
        already_resolved: false,
      }, error: null,
    } as any);

    await resolveSignal('sig-1', 'dismissed_not_real');
    expect(spy).toHaveBeenCalledWith('visit_execution_resolve_completeness_signal', {
      p_signal_id: 'sig-1',
      p_resolution: 'dismissed_not_real',
      p_new_text: null,
    });
  });

  it('forwards trimmed override text on added_as_requirement', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        signal_id: 'sig-1',
        resolution: 'added_as_requirement',
        requirement_id: 'new-req-id',
        already_resolved: false,
      }, error: null,
    } as any);

    await resolveSignal('sig-1', 'added_as_requirement', '  Body weight measurement  ');
    expect(spy).toHaveBeenCalledWith('visit_execution_resolve_completeness_signal', {
      p_signal_id: 'sig-1',
      p_resolution: 'added_as_requirement',
      p_new_text: 'Body weight measurement',
    });
  });

  it('drops whitespace-only override text to null (DB will use gap_text)', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        signal_id: 'sig-1', resolution: 'added_as_requirement',
        requirement_id: 'new-req-id', already_resolved: false,
      }, error: null,
    } as any);

    await resolveSignal('sig-1', 'added_as_requirement', '   \n  ');
    expect(spy).toHaveBeenCalledWith('visit_execution_resolve_completeness_signal', {
      p_signal_id: 'sig-1',
      p_resolution: 'added_as_requirement',
      p_new_text: null,
    });
  });

  it('always sends p_new_text=null when resolution is dismiss, even if caller passed text', async () => {
    // Defense-in-depth: dismiss path should never carry override text. The RPC
    // would silently ignore it but the wire payload stays clean.
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        signal_id: 'sig-1', resolution: 'dismissed_not_real',
        requirement_id: null, already_resolved: false,
      }, error: null,
    } as any);

    await resolveSignal('sig-1', 'dismissed_not_real', 'ignored override');
    expect(spy).toHaveBeenCalledWith('visit_execution_resolve_completeness_signal', {
      p_signal_id: 'sig-1',
      p_resolution: 'dismissed_not_real',
      p_new_text: null,
    });
  });

  it('surfaces RPC errors as ok:false (no throw)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'signal not found or access denied' } as any,
    } as any);

    const r = await resolveSignal('sig-nope', 'dismissed_not_real');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('signal not found or access denied');
  });

  it('returns malformed payload as ok:false rather than crashing', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { some_other_shape: true } as any,
      error: null,
    } as any);

    const r = await resolveSignal('sig-1', 'dismissed_not_real');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('surfaces already_resolved flag from server', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        signal_id: 'sig-1',
        resolution: 'dismissed_not_real',
        requirement_id: null,
        already_resolved: true,
      }, error: null,
    } as any);

    const r = await resolveSignal('sig-1', 'dismissed_not_real');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.already_resolved).toBe(true);
  });
});
