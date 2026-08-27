// Integration: list query → row → click View Source → drawer opens.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Partial mock: stub only the network call; keep the real pure helpers
// (isAwaitingReview etc.) so the mock never drifts when the component adds
// an import. Safe to importOriginal — vitest.config injects dummy supabase
// env, so module init doesn't throw. (Do NOT apply this pattern to
// lib/sotr/exportApi — mocking that module deadlocks the vitest worker;
// mock the ../../supabase seam there instead.)
vi.mock('../../../lib/sotr/sourceEvidenceApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/sotr/sourceEvidenceApi')>()),
  listWorksheetItemsForStudy: vi.fn(),
}));

vi.mock('../../../hooks/useWorksheetItemEvidence', () => ({
  useWorksheetItemEvidence: vi.fn(),
}));

import WorksheetItemsList from '../WorksheetItemsList';
import { listWorksheetItemsForStudy } from '../../../lib/sotr/sourceEvidenceApi';
import { useWorksheetItemEvidence } from '../../../hooks/useWorksheetItemEvidence';

const mockList = listWorksheetItemsForStudy as unknown as ReturnType<typeof vi.fn>;
const mockHook = useWorksheetItemEvidence as unknown as ReturnType<typeof vi.fn>;

const ITEMS = [
  {
    id: 'item-1', document_id: 'doc-1',
    field_path: 'primary_endpoints[0]', field_type: 'endpoint',
    extracted_value: 'Change in PANSS score at week 24',
    confidence_state: 'high' as const, confidence_score: 0.91,
    confidence_reason: 'Exact source found.', ambiguity_reason: null,
    missing_source_reason: null,
    created_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z',
  },
  {
    id: 'item-2', document_id: 'doc-1',
    field_path: 'sponsor_name', field_type: 'metadata',
    extracted_value: 'Acme Pharma',
    confidence_state: 'needs_review' as const, confidence_score: null,
    confidence_reason: null, ambiguity_reason: null,
    missing_source_reason: 'parser_output_missing_citation' as const,
    created_at: '2026-05-08T00:00:00Z', updated_at: '2026-05-08T00:00:00Z',
  },
];

describe('WorksheetItemsList', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockHook.mockReset();
    mockHook.mockReturnValue({ status: 'loading', retry: vi.fn() });
  });

  it('shows loading state, then renders rows grouped by field type', async () => {
    mockList.mockResolvedValue(ITEMS);
    render(<WorksheetItemsList studyId="study-1" />);

    expect(screen.getByTestId('sotr-list-loading')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.queryByTestId('sotr-list-loading')).toBeNull();
    });

    expect(screen.getAllByTestId('sotr-worksheet-item-row')).toHaveLength(2);
    expect(screen.getByText('Endpoints')).toBeInTheDocument();
    expect(screen.getByText('Protocol metadata')).toBeInTheDocument();
  });

  it('clicking View Source opens the SourceTruthDrawer', async () => {
    mockList.mockResolvedValue(ITEMS);
    const user = userEvent.setup();
    render(<WorksheetItemsList studyId="study-1" />);

    await waitFor(() => screen.getAllByTestId('sotr-worksheet-item-row'));

    expect(screen.queryByTestId('sotr-drawer')).toBeNull();

    await user.click(screen.getAllByTestId('sotr-view-source-button')[0]);
    expect(screen.getByTestId('sotr-drawer')).toBeInTheDocument();
  });

  it('shows a friendly error if the list query fails', async () => {
    mockList.mockRejectedValue(new Error('network down'));
    render(<WorksheetItemsList studyId="study-1" />);

    await waitFor(() => {
      expect(screen.getByTestId('sotr-list-error')).toBeInTheDocument();
    });
    // Friendly copy — no raw network error leaks
    expect(screen.getByTestId('sotr-list-error').textContent || '')
      .not.toMatch(/network|stack|Error:/);
  });

  it('shows the empty-state copy when there are no items', async () => {
    mockList.mockResolvedValue([]);
    render(<WorksheetItemsList studyId="study-1" />);

    await waitFor(() => {
      expect(screen.queryByTestId('sotr-list-loading')).toBeNull();
    });
    expect(screen.getByText(/No worksheet items have been generated/)).toBeInTheDocument();
  });

  it('renders emptyStateMessage instead of the default copy when provided', async () => {
    mockList.mockResolvedValue([]);
    render(
      <WorksheetItemsList
        studyId="study-1"
        emptyStateMessage="Custom ownership-aware copy for this caller."
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('sotr-list-empty')).toBeInTheDocument();
    });
    expect(screen.getByText('Custom ownership-aware copy for this caller.')).toBeInTheDocument();
    expect(screen.queryByText(/No worksheet items have been generated/)).toBeNull();
  });
});
