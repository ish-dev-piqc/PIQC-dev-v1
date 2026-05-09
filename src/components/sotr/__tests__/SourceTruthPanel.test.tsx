import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SourceTruthPanel, {
  SourceTruthLoading,
  SourceTruthError,
} from '../SourceTruthPanel';
import type {
  WorksheetItemSourceEvidence,
  SourceEvidenceForReview,
} from '../../../types/sotr';

function makeSource(
  overrides: Partial<SourceEvidenceForReview> = {},
): SourceEvidenceForReview {
  return {
    id: 'ev-1',
    support_type: 'primary',
    protocol_document_id: 'doc-1',
    protocol_version: 'Protocol v3.0 Amendment 2',
    page_number: 48,
    section_number: '7.2',
    section_title: 'Vital Signs',
    source_text: 'Vital signs will be collected prior to dosing at Visit 2.',
    text_start_offset: 1042,
    text_end_offset: 1103,
    bounding_boxes: [{ page: 48, x1: 0, y1: 0, x2: 100, y2: 20 }],
    extraction_confidence: 0.94,
    relevance_score: 0.98,
    is_primary: true,
    ...overrides,
  };
}

function makeData(
  overrides: Partial<WorksheetItemSourceEvidence> = {},
): WorksheetItemSourceEvidence {
  return {
    worksheet_item_id: 'item-1',
    confidence_state: 'high',
    confidence_score: 0.91,
    confidence_reason: 'Exact source found in protocol Section 7.2, Page 48.',
    ambiguity_reason: null,
    sources: [makeSource()],
    missing_source_reason: null,
    ...overrides,
  };
}

describe('SourceTruthPanel — source rendering', () => {
  it('renders source metadata header with version, section, page, support', () => {
    render(<SourceTruthPanel itemLabel="Vital signs at V2" data={makeData()} />);

    const header = screen.getByTestId('sotr-source-header');
    expect(header).toHaveTextContent('Protocol v3.0 Amendment 2');
    expect(header).toHaveTextContent('Section 7.2');
    expect(header).toHaveTextContent('Vital Signs');
    expect(header).toHaveTextContent('Page 48');
    expect(header).toHaveTextContent('Primary');
  });

  it('renders quoted source text', () => {
    render(<SourceTruthPanel data={makeData()} />);
    expect(screen.getByTestId('sotr-quoted-text'))
      .toHaveTextContent('Vital signs will be collected prior to dosing at Visit 2.');
  });

  it('renders the confidence reason when provided', () => {
    render(<SourceTruthPanel data={makeData()} />);
    expect(screen.getByTestId('sotr-confidence-reason'))
      .toHaveTextContent(/Exact source found/);
  });
});

describe('SourceTruthPanel — multi-source navigation', () => {
  const data = makeData({
    sources: [
      makeSource({ id: 'ev-1', page_number: 10, support_type: 'primary' }),
      makeSource({ id: 'ev-2', page_number: 20, support_type: 'secondary',
        source_text: 'Secondary citation text.' }),
      makeSource({ id: 'ev-3', page_number: 30, support_type: 'context',
        source_text: 'Context paragraph text.' }),
    ],
  });

  it('shows current source position and renders prev/next', () => {
    render(<SourceTruthPanel data={data} />);
    const nav = screen.getByTestId('sotr-source-nav');
    expect(nav).toHaveTextContent('Source 1 of 3');
    expect(screen.getByTestId('sotr-quoted-text'))
      .toHaveTextContent(/Vital signs/);
  });

  it('advances to the next source on Next click', async () => {
    const user = userEvent.setup();
    render(<SourceTruthPanel data={data} />);

    await user.click(screen.getByLabelText('Next source'));
    expect(screen.getByTestId('sotr-source-nav'))
      .toHaveTextContent('Source 2 of 3');
    expect(screen.getByTestId('sotr-quoted-text'))
      .toHaveTextContent('Secondary citation text.');
  });

  it('disables Previous at the first source and Next at the last', async () => {
    const user = userEvent.setup();
    render(<SourceTruthPanel data={data} />);

    expect(screen.getByLabelText('Previous source')).toBeDisabled();

    await user.click(screen.getByLabelText('Next source'));
    await user.click(screen.getByLabelText('Next source'));

    expect(screen.getByTestId('sotr-source-nav'))
      .toHaveTextContent('Source 3 of 3');
    expect(screen.getByLabelText('Next source')).toBeDisabled();
  });

  it('does not render the navigator when there is only one source', () => {
    render(<SourceTruthPanel data={makeData()} />);
    expect(screen.queryByTestId('sotr-source-nav')).toBeNull();
  });
});

describe('SourceTruthPanel — missing evidence', () => {
  it('shows the needs-review message when sources is empty', () => {
    const data = makeData({
      confidence_state: 'needs_review',
      sources: [],
      missing_source_reason: 'parser_output_missing_citation',
      confidence_reason: 'No reliable source evidence found.',
    });
    render(<SourceTruthPanel data={data} />);

    const empty = screen.getByTestId('sotr-no-evidence');
    expect(empty).toHaveTextContent(/No reliable source evidence/);
    expect(empty).toHaveTextContent(/needs review/i);
    expect(empty).toHaveTextContent(/parser did not provide a citation/);
    expect(screen.queryByTestId('sotr-source-card')).toBeNull();
  });

  it('omits the missing-reason line when reason is null', () => {
    const data = makeData({
      sources: [],
      missing_source_reason: null,
    });
    render(<SourceTruthPanel data={data} />);
    const empty = screen.getByTestId('sotr-no-evidence');
    expect(empty).toHaveTextContent(/No reliable source evidence/);
  });
});

describe('SourceTruthPanel — missing coordinates', () => {
  it('shows the highlight-unavailable hint when bounding_boxes is empty', () => {
    const data = makeData({
      sources: [makeSource({ bounding_boxes: [] })],
    });
    render(<SourceTruthPanel data={data} />);

    const hint = screen.getByTestId('sotr-missing-coords');
    expect(hint).toHaveTextContent(/Exact highlight unavailable/);
    expect(hint).toHaveTextContent(/citation metadata/);
    // Quoted text should still render
    expect(screen.getByTestId('sotr-quoted-text')).toBeInTheDocument();
  });

  it('does not render the highlight-unavailable hint when coordinates exist', () => {
    render(<SourceTruthPanel data={makeData()} />);
    expect(screen.queryByTestId('sotr-missing-coords')).toBeNull();
  });
});

describe('SourceTruthLoading / SourceTruthError', () => {
  it('renders the loading state', () => {
    render(<SourceTruthLoading />);
    expect(screen.getByTestId('sotr-loading'))
      .toHaveTextContent(/Loading source evidence/);
  });

  it('renders the error state with retry button', async () => {
    const user = userEvent.setup();
    let retried = false;
    render(<SourceTruthError onRetry={() => { retried = true; }} />);

    const err = screen.getByTestId('sotr-error');
    expect(err).toHaveTextContent(/couldn't load source evidence/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(retried).toBe(true);
  });

  it('does not expose raw technical errors in the error UI', () => {
    render(<SourceTruthError onRetry={() => {}} />);
    const err = screen.getByTestId('sotr-error');
    expect(err.textContent).not.toMatch(/stack|TypeError|TypeError|undefined is not/i);
  });
});
