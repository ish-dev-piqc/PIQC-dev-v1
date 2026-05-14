import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/sotr/reviewApi', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/sotr/reviewApi')>(
    '../../../lib/sotr/reviewApi',
  );
  return { ...actual, createReviewEvent: vi.fn() };
});

import ReviewActionBar from '../ReviewActionBar';
import { createReviewEvent } from '../../../lib/sotr/reviewApi';
import type { WorksheetItemSourceEvidence } from '../../../types/sotr';

const mockCreate = createReviewEvent as unknown as ReturnType<typeof vi.fn>;

function makeData(
  overrides: Partial<WorksheetItemSourceEvidence> = {},
): WorksheetItemSourceEvidence {
  return {
    worksheet_item_id: 'item-1',
    confidence_state: 'high',
    confidence_score: 0.9,
    confidence_reason: 'reason',
    ambiguity_reason: null,
    sources: [
      {
        id: 'ev-1', support_type: 'primary',
        protocol_document_id: 'doc-1', protocol_version: 'v3',
        page_number: 1, section_number: '1.0', section_title: 'Intro',
        source_text: 'quoted', text_start_offset: null, text_end_offset: null,
        bounding_boxes: [], extraction_confidence: 0.9, relevance_score: 1,
        is_primary: true,
      },
    ],
    missing_source_reason: null,
    review_status: 'draft',
    version: 1,
    current_text: null,
    worksheet_item_text: 'an extracted endpoint',
    ...overrides,
  };
}

const SUCCESS_RESULT = {
  review_event_id: 'event-1',
  worksheet_item_id: 'item-1',
  review_status: 'accepted_for_draft' as const,
  version: 1,
  current_text: null,
  worksheet_item_text: 'an extracted endpoint',
};

describe('ReviewActionBar — primary action buttons', () => {
  beforeEach(() => mockCreate.mockReset());

  it('renders all four primary action buttons with draft language', () => {
    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    expect(screen.getByTestId('sotr-accept-for-draft'))
      .toHaveTextContent('Accept for Draft');
    expect(screen.getByTestId('sotr-edit-draft-item'))
      .toHaveTextContent('Edit Draft Item');
    expect(screen.getByTestId('sotr-reject-from-draft'))
      .toHaveTextContent('Reject from Draft');
    expect(screen.getByTestId('sotr-flag-item'))
      .toHaveTextContent('Flag Item');
  });

  it('does not use any approval/signature language', () => {
    const { container } = render(
      <ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />,
    );
    const text = container.textContent || '';
    expect(text).not.toMatch(/\bApprove\b|\bSign\b|\bCertify\b|\bGxP\b|\bPart 11\b/i);
  });

  it('Accept for Draft submits with action and source IDs and fires onCompleted', async () => {
    const user = userEvent.setup();
    const onCompleted = vi.fn();
    mockCreate.mockResolvedValueOnce(SUCCESS_RESULT);

    render(
      <ReviewActionBar
        studyId="study-1"
        data={makeData()}
        onCompleted={onCompleted}
      />,
    );

    await user.click(screen.getByTestId('sotr-accept-for-draft'));

    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(mockCreate).toHaveBeenCalledWith('study-1', 'item-1', {
      action: 'accept_for_draft',
      new_item_text: undefined,
      reviewer_note: undefined,
      source_evidence_record_ids: ['ev-1'],
    });
    expect(onCompleted).toHaveBeenCalledWith(SUCCESS_RESULT);
  });

  it('shows a friendly inline error when the API throws', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error('network down'));

    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-accept-for-draft'));

    const err = await screen.findByTestId('sotr-review-action-error');
    expect(err).toHaveTextContent(/could not record/i);
    // No raw error names leak
    expect(err.textContent || '').not.toMatch(/network|Error:|stack/i);
  });
});

describe('ReviewActionBar — Edit Draft Item flow', () => {
  beforeEach(() => mockCreate.mockReset());

  it('opens the edit form with the current item text', async () => {
    const user = userEvent.setup();
    render(
      <ReviewActionBar
        studyId="study-1"
        data={makeData({ worksheet_item_text: 'original text' })}
        onCompleted={() => {}}
      />,
    );
    await user.click(screen.getByTestId('sotr-edit-draft-item'));

    expect(screen.getByTestId('sotr-edit-draft-form')).toBeInTheDocument();
    expect(screen.getByTestId('sotr-edit-draft-text'))
      .toHaveValue('original text');
  });

  it('disables Save when text is empty after edit', async () => {
    const user = userEvent.setup();
    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-edit-draft-item'));

    const ta = screen.getByTestId('sotr-edit-draft-text');
    await user.clear(ta);
    expect(screen.getByTestId('sotr-edit-draft-save')).toBeDisabled();
  });

  it('Save submits edit_draft_item with trimmed text + note', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValueOnce({
      ...SUCCESS_RESULT,
      review_status: 'edited',
      version: 2,
      current_text: 'new wording',
      worksheet_item_text: 'new wording',
    });

    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-edit-draft-item'));

    const ta = screen.getByTestId('sotr-edit-draft-text');
    await user.clear(ta);
    await user.type(ta, '  new wording  ');

    const note = screen.getByTestId('sotr-edit-draft-note');
    await user.type(note, 'cleaned up');

    await user.click(screen.getByTestId('sotr-edit-draft-save'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('study-1', 'item-1', {
        action: 'edit_draft_item',
        new_item_text: 'new wording',
        reviewer_note: 'cleaned up',
        source_evidence_record_ids: ['ev-1'],
      });
    });
  });

  it('Cancel returns to the action bar without submitting', async () => {
    const user = userEvent.setup();
    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-edit-draft-item'));
    await user.click(screen.getByTestId('sotr-edit-draft-cancel'));

    expect(screen.queryByTestId('sotr-edit-draft-form')).toBeNull();
    expect(screen.getByTestId('sotr-accept-for-draft')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('ReviewActionBar — Reject and Flag note flows', () => {
  beforeEach(() => mockCreate.mockReset());

  it('Reject from Draft opens a note form and submits with the note', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValueOnce({
      ...SUCCESS_RESULT,
      review_status: 'rejected_from_draft',
    });

    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-reject-from-draft'));

    const note = screen.getByTestId('sotr-note-input-reject_from_draft');
    await user.type(note, 'wrong source');

    await user.click(screen.getByTestId('sotr-note-submit-reject_from_draft'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('study-1', 'item-1', {
        action: 'reject_from_draft',
        new_item_text: undefined,
        reviewer_note: 'wrong source',
        source_evidence_record_ids: ['ev-1'],
      });
    });
  });

  it('Flag Item opens a note form and submits without requiring a note', async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValueOnce({
      ...SUCCESS_RESULT,
      review_status: 'flagged',
    });

    render(<ReviewActionBar studyId="study-1" data={makeData()} onCompleted={() => {}} />);
    await user.click(screen.getByTestId('sotr-flag-item'));

    // Don't type a note — submit directly
    await user.click(screen.getByTestId('sotr-note-submit-flag_item'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('study-1', 'item-1', {
        action: 'flag_item',
        new_item_text: undefined,
        reviewer_note: undefined,
        source_evidence_record_ids: ['ev-1'],
      });
    });
  });
});
