import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  addBlock,
  addBlockNote,
  deleteBlock,
  editBlockText,
  flagBlock,
  markBlockReviewed,
  rejectBlock,
  unmarkBlockReviewed,
} from '../deliverablesMutationsApi';

// =============================================================================
// deliverablesMutationsApi — DeliverablesResult<T> contract + RPC argument
// shape + error handling. The five review actions share one dispatcher, so
// each is hit at least once and the markBlockReviewed path covers the
// dispatcher's branches in depth.
// =============================================================================

const okReviewPayload = {
  block_id: 'blk-1',
  review_state: 'reviewed',
  version: 1,
  edit_id: 'edit-1',
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe('review actions — deliverable_set_block_review dispatch', () => {
  it('markBlockReviewed calls with p_action mark_reviewed and null note', async () => {
    rpcMock.mockResolvedValueOnce({ data: okReviewPayload, error: null });
    const r = await markBlockReviewed('blk-1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_set_block_review', {
      p_block_id: 'blk-1',
      p_action: 'mark_reviewed',
      p_note: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        block_id: 'blk-1',
        review_state: 'reviewed',
        version: 1,
        edit_id: 'edit-1',
      });
    }
  });

  it('unmarkBlockReviewed calls with p_action unmark_reviewed', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...okReviewPayload, review_state: 'draft' },
      error: null,
    });
    const r = await unmarkBlockReviewed('blk-1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_set_block_review', {
      p_block_id: 'blk-1',
      p_action: 'unmark_reviewed',
      p_note: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_state).toBe('draft');
  });

  it('flagBlock forwards the optional note to p_note', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...okReviewPayload, review_state: 'needs_review' },
      error: null,
    });
    await flagBlock('blk-1', 'Window math looks off — re-check §6.2');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_set_block_review', {
      p_block_id: 'blk-1',
      p_action: 'flag',
      p_note: 'Window math looks off — re-check §6.2',
    });
  });

  it('addBlockNote calls with p_action add_note + the note string', async () => {
    rpcMock.mockResolvedValueOnce({ data: okReviewPayload, error: null });
    await addBlockNote('blk-1', 'Site uses central-lab courier on Tuesdays');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_set_block_review', {
      p_block_id: 'blk-1',
      p_action: 'add_note',
      p_note: 'Site uses central-lab courier on Tuesdays',
    });
  });

  it('rejectBlock calls with p_action reject_block', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...okReviewPayload, review_state: 'rejected' },
      error: null,
    });
    const r = await rejectBlock('blk-1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_set_block_review', {
      p_block_id: 'blk-1',
      p_action: 'reject_block',
      p_note: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.review_state).toBe('rejected');
  });

  it('surfaces RPC errors as ok:false with error.message (no throw)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Block not found or access denied' },
    });
    const r = await markBlockReviewed('blk-nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Block not found or access denied');
  });

  it('returns malformed RPC payload as ok:false rather than crashing the caller', async () => {
    rpcMock.mockResolvedValueOnce({ data: { some_other_shape: true }, error: null });
    const r = await markBlockReviewed('blk-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('returns null payload as ok:false rather than confusing the caller', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await markBlockReviewed('blk-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('defaults missing version/edit_id defensively instead of failing', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { block_id: 'blk-1', review_state: 'reviewed' },
      error: null,
    });
    const r = await markBlockReviewed('blk-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.version).toBe(0);
      expect(r.data.edit_id).toBe('');
    }
  });
});

describe('editBlockText — deliverable_edit_block_text', () => {
  it('rejects empty text before hitting the RPC', async () => {
    const r = await editBlockText('blk-1', '');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-empty/);
  });

  it('rejects whitespace-only text before hitting the RPC', async () => {
    const r = await editBlockText('blk-1', '   \n\t  ');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });

  it('calls with p_new_text trimmed + optional p_note', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { block_id: 'blk-1', review_state: 'edited', version: 2, edit_id: 'edit-9' },
      error: null,
    });
    const r = await editBlockText(
      'blk-1',
      '  Verify: Age 18-75 (site counts from consent date)  ',
      'clarified per site SOP',
    );
    expect(rpcMock).toHaveBeenCalledWith('deliverable_edit_block_text', {
      p_block_id: 'blk-1',
      p_new_text: 'Verify: Age 18-75 (site counts from consent date)',
      p_note: 'clarified per site SOP',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.review_state).toBe('edited');
      expect(r.data.version).toBe(2);
    }
  });

  it('sends p_note null when no note is provided', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { block_id: 'blk-1', review_state: 'edited', version: 2, edit_id: 'edit-9' },
      error: null,
    });
    await editBlockText('blk-1', 'X');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_edit_block_text', {
      p_block_id: 'blk-1',
      p_new_text: 'X',
      p_note: null,
    });
  });

  it('surfaces RPC errors as ok:false with error.message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Block not found or access denied' },
    });
    const r = await editBlockText('blk-nope', 'whatever');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Block not found or access denied');
  });

  it('returns malformed RPC payload as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: { version: 2 }, error: null });
    const r = await editBlockText('blk-1', 'New text');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});

describe('addBlock — deliverable_add_block', () => {
  it('rejects empty text before hitting the RPC', async () => {
    const r = await addBlock('del-1', 'site_questions', '   ');
    expect(rpcMock).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/non-empty/);
  });

  it('calls with the deliverable id, section key, trimmed text, and null note', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { block_id: 'blk-new', review_state: 'human_added', version: 1, edit_id: 'edit-2' },
      error: null,
    });
    const r = await addBlock('del-1', 'site_questions', '  Ask about pharmacy temperature logs  ');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_add_block', {
      p_deliverable_id: 'del-1',
      p_section_key: 'site_questions',
      p_text: 'Ask about pharmacy temperature logs',
      p_note: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.block_id).toBe('blk-new');
      expect(r.data.review_state).toBe('human_added');
      expect(r.data.version).toBe(1);
    }
  });

  it('forwards an optional note to p_note', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { block_id: 'blk-new', review_state: 'human_added', version: 1, edit_id: 'edit-3' },
      error: null,
    });
    await addBlock('del-1', 'source_doc_focus', 'Check pharmacy binder', 'added after site call');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_add_block', {
      p_deliverable_id: 'del-1',
      p_section_key: 'source_doc_focus',
      p_text: 'Check pharmacy binder',
      p_note: 'added after site call',
    });
  });

  it('surfaces RPC errors as ok:false with error.message', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Deliverable not found or access denied' },
    });
    const r = await addBlock('del-nope', 'site_questions', 'text');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Deliverable not found or access denied');
  });
});

describe('deleteBlock — deliverable_delete_block', () => {
  it('calls with the block id and returns the deleted id', async () => {
    rpcMock.mockResolvedValueOnce({ data: { block_id: 'blk-h1' }, error: null });
    const r = await deleteBlock('blk-h1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_delete_block', {
      p_block_id: 'blk-h1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.block_id).toBe('blk-h1');
  });

  it('surfaces the RPC refusal for parser-derived blocks as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Only human-added blocks can be deleted.' },
    });
    const r = await deleteBlock('blk-parser');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('human-added');
  });

  it('returns malformed RPC payload as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: { deleted: 1 }, error: null });
    const r = await deleteBlock('blk-h1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});
