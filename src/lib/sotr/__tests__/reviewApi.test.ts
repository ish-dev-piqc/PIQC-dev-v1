import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { createReviewEvent, ReviewActionValidationError } from '../reviewApi';
import { supabase } from '../../supabase';

const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('createReviewEvent — request shaping', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({
      data: {
        review_event_id: 'event-1',
        worksheet_item_id: 'item-1',
        review_status: 'accepted_for_draft',
        version: 1,
        current_text: null,
        worksheet_item_text: 'an item',
      },
      error: null,
    });
  });

  it('forwards accept_for_draft with no extra fields', async () => {
    await createReviewEvent('study-1', 'item-1', {
      action: 'accept_for_draft',
      source_evidence_record_ids: ['ev-1'],
    });
    expect(mockRpc).toHaveBeenCalledWith('sotr_create_review_event', {
      p_study_id: 'study-1',
      p_worksheet_item_id: 'item-1',
      p_action: 'accept_for_draft',
      p_new_item_text: null,
      p_reviewer_note: null,
      p_source_evidence_record_ids: ['ev-1'],
    });
  });

  it('forwards edit_draft_item with new_item_text + note', async () => {
    await createReviewEvent('study-1', 'item-1', {
      action: 'edit_draft_item',
      new_item_text: 'Collect vital signs before dosing.',
      reviewer_note: 'Adjusted wording.',
      source_evidence_record_ids: ['ev-1'],
    });
    expect(mockRpc).toHaveBeenCalledWith(
      'sotr_create_review_event',
      expect.objectContaining({
        p_action: 'edit_draft_item',
        p_new_item_text: 'Collect vital signs before dosing.',
        p_reviewer_note: 'Adjusted wording.',
      }),
    );
  });

  it('defaults source_evidence_record_ids to empty array', async () => {
    await createReviewEvent('study-1', 'item-1', { action: 'flag_item' });
    expect(mockRpc).toHaveBeenCalledWith(
      'sotr_create_review_event',
      expect.objectContaining({ p_source_evidence_record_ids: [] }),
    );
  });
});

describe('createReviewEvent — client-side validation', () => {
  beforeEach(() => mockRpc.mockReset());

  it('rejects edit_draft_item with empty new_item_text without calling RPC', async () => {
    await expect(
      createReviewEvent('study-1', 'item-1', {
        action: 'edit_draft_item',
        new_item_text: '',
      }),
    ).rejects.toBeInstanceOf(ReviewActionValidationError);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('rejects edit_draft_item with whitespace-only new_item_text', async () => {
    await expect(
      createReviewEvent('study-1', 'item-1', {
        action: 'edit_draft_item',
        new_item_text: '   ',
      }),
    ).rejects.toBeInstanceOf(ReviewActionValidationError);
  });
});

describe('createReviewEvent — error propagation', () => {
  beforeEach(() => mockRpc.mockReset());

  it('throws when RPC returns an error', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'access denied' },
    });
    await expect(
      createReviewEvent('study-1', 'item-1', { action: 'accept_for_draft' }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});

describe('createReviewEvent — safe logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({
      data: {
        review_event_id: 'event-1', worksheet_item_id: 'item-1',
        review_status: 'edited', version: 2, current_text: 'edited',
        worksheet_item_text: 'edited',
      },
      error: null,
    });
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => infoSpy.mockRestore());

  it('never logs the reviewer_note body or new_item_text body', async () => {
    const SECRET_NOTE = 'CONFIDENTIAL_REVIEWER_NOTE_BODY_DO_NOT_LOG';
    const SECRET_TEXT = 'CONFIDENTIAL_NEW_ITEM_TEXT_BODY';

    await createReviewEvent('study-1', 'item-1', {
      action: 'edit_draft_item',
      new_item_text: SECRET_TEXT,
      reviewer_note: SECRET_NOTE,
      source_evidence_record_ids: ['ev-1'],
    });

    const logged = infoSpy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join(' ');
    expect(logged).not.toContain(SECRET_NOTE);
    expect(logged).not.toContain(SECRET_TEXT);
    // Lengths and counts are fine to log:
    expect(logged).toContain('noteLength');
    expect(logged).toContain('newTextLength');
    expect(logged).toContain('action');
  });
});
