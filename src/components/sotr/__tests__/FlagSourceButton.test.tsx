import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('../../../lib/sotr/reviewApi', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/sotr/reviewApi')>(
    '../../../lib/sotr/reviewApi',
  );
  return { ...actual, createReviewEvent: vi.fn() };
});

import FlagSourceButton from '../FlagSourceButton';
import { createReviewEvent } from '../../../lib/sotr/reviewApi';

const mockCreate = createReviewEvent as unknown as ReturnType<typeof vi.fn>;

const FLAG_RESULT = {
  review_event_id: 'event-1',
  worksheet_item_id: 'item-1',
  review_status: 'draft' as const,
  version: 1,
  current_text: null,
  worksheet_item_text: 'an item',
};

describe('FlagSourceButton', () => {
  beforeEach(() => mockCreate.mockReset());

  it('renders the trigger button with draft-review language', () => {
    render(
      <FlagSourceButton
        studyId="study-1"
        worksheetItemId="item-1"
        sourceId="ev-1"
      />,
    );
    expect(screen.getByTestId('sotr-flag-source-button'))
      .toHaveTextContent(/flag source/i);
  });

  it('opens a note form on click and submits flag_source action', async () => {
    const user = userEvent.setup();
    const onFlagged = vi.fn();
    mockCreate.mockResolvedValueOnce(FLAG_RESULT);

    render(
      <FlagSourceButton
        studyId="study-1"
        worksheetItemId="item-1"
        sourceId="ev-1"
        onFlagged={onFlagged}
      />,
    );

    await user.click(screen.getByTestId('sotr-flag-source-button'));
    expect(screen.getByTestId('sotr-flag-source-form')).toBeInTheDocument();

    await user.type(
      screen.getByTestId('sotr-flag-source-note'),
      'cited section is wrong',
    );

    await user.click(screen.getByTestId('sotr-flag-source-submit'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('study-1', 'item-1', {
        action: 'flag_source',
        reviewer_note: 'cited section is wrong',
        source_evidence_record_ids: ['ev-1'],
      });
      expect(onFlagged).toHaveBeenCalledWith(FLAG_RESULT);
    });

    // Quiet success state
    expect(screen.getByTestId('sotr-flag-source-flagged')).toHaveTextContent(/source flagged/i);
  });

  it('Cancel returns to idle without calling the API', async () => {
    const user = userEvent.setup();
    render(
      <FlagSourceButton
        studyId="study-1"
        worksheetItemId="item-1"
        sourceId="ev-1"
      />,
    );

    await user.click(screen.getByTestId('sotr-flag-source-button'));
    await user.click(screen.getByTestId('sotr-flag-source-cancel'));

    expect(screen.queryByTestId('sotr-flag-source-form')).toBeNull();
    expect(screen.getByTestId('sotr-flag-source-button')).toBeInTheDocument();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('shows a friendly error if the API throws', async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error('boom'));

    render(
      <FlagSourceButton
        studyId="study-1"
        worksheetItemId="item-1"
        sourceId="ev-1"
      />,
    );
    await user.click(screen.getByTestId('sotr-flag-source-button'));
    await user.click(screen.getByTestId('sotr-flag-source-submit'));

    const err = await screen.findByTestId('sotr-flag-source-error');
    expect(err).toHaveTextContent(/could not flag/i);
  });
});
