import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the hook before importing the drawer.
vi.mock('../../../hooks/useWorksheetItemEvidence', () => ({
  useWorksheetItemEvidence: vi.fn(),
}));

import SourceTruthDrawer from '../SourceTruthDrawer';
import { useWorksheetItemEvidence } from '../../../hooks/useWorksheetItemEvidence';

const mockHook = useWorksheetItemEvidence as unknown as ReturnType<typeof vi.fn>;

describe('SourceTruthDrawer — fetch states', () => {
  beforeEach(() => {
    mockHook.mockReset();
  });

  it('renders loading state while fetching', () => {
    mockHook.mockReturnValue({ status: 'loading', retry: vi.fn() });
    render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        itemLabel="An endpoint"
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('sotr-loading')).toBeInTheDocument();
  });

  it('renders error state with a retry handler', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    mockHook.mockReturnValue({
      status: 'error',
      message: 'We could not load source evidence for this item.',
      retry,
    });

    render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('sotr-error')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('renders the panel on success', () => {
    mockHook.mockReturnValue({
      status: 'success',
      data: {
        worksheet_item_id: 'item-1',
        confidence_state: 'high',
        confidence_score: 0.91,
        confidence_reason: 'Exact source found.',
        ambiguity_reason: null,
        sources: [
          {
            id: 'ev-1', support_type: 'primary',
            protocol_document_id: 'doc-1', protocol_version: 'v3',
            page_number: 10, section_number: '1.0', section_title: 'Intro',
            source_text: 'Quoted text here.',
            text_start_offset: 0, text_end_offset: 20,
            bounding_boxes: [], extraction_confidence: 0.9,
            relevance_score: 1, is_primary: true,
          },
        ],
        missing_source_reason: null,
      },
      retry: vi.fn(),
    });

    render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        itemLabel="An endpoint"
        onClose={() => {}}
      />,
    );

    expect(screen.getByTestId('sotr-panel')).toBeInTheDocument();
    expect(screen.getByTestId('sotr-quoted-text'))
      .toHaveTextContent('Quoted text here.');
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    mockHook.mockReturnValue({ status: 'loading', retry: vi.fn() });
    const onClose = vi.fn();

    render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByRole('button', { name: /close source panel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    mockHook.mockReturnValue({ status: 'loading', retry: vi.fn() });
    const onClose = vi.fn();

    render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        onClose={onClose}
      />,
    );

    await user.click(screen.getByTestId('sotr-drawer-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render any URL-shaped strings in the success view', async () => {
    mockHook.mockReturnValue({
      status: 'success',
      data: {
        worksheet_item_id: 'item-1', confidence_state: 'high',
        confidence_score: null, confidence_reason: null,
        ambiguity_reason: null,
        sources: [{
          id: 'ev-1', support_type: 'primary',
          protocol_document_id: 'doc-uuid-only', protocol_version: 'v1',
          page_number: 1, section_number: null, section_title: null,
          source_text: 'plain text', text_start_offset: null,
          text_end_offset: null, bounding_boxes: [],
          extraction_confidence: 0.5, relevance_score: 1, is_primary: true,
        }],
        missing_source_reason: null,
      },
      retry: vi.fn(),
    });

    const { container } = render(
      <SourceTruthDrawer
        studyId="study-1"
        worksheetItemId="item-1"
        onClose={() => {}}
      />,
    );

    await waitFor(() => screen.getByTestId('sotr-panel'));
    expect(container.textContent || '').not.toMatch(/https?:\/\//);
    expect(container.textContent || '').not.toMatch(/supabase\.co\/storage/);
  });
});
