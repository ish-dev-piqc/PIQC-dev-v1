import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WorksheetItemRow, { formatExtractedValue, formatVisit } from '../WorksheetItemRow';
import type { ExtractedItemRecord } from '../../../types/sotr';

function makeItem(overrides: Partial<ExtractedItemRecord> = {}): ExtractedItemRecord {
  return {
    id: 'item-1',
    document_id: 'doc-1',
    field_path: 'primary_endpoints[0]',
    field_type: 'endpoint',
    extracted_value: 'Change in PANSS score at week 24',
    confidence_state: 'high',
    confidence_score: 0.91,
    confidence_reason: 'Exact source found in protocol Section 7.2, Page 48.',
    ambiguity_reason: null,
    missing_source_reason: null,
    created_at: '2026-05-08T00:00:00Z',
    updated_at: '2026-05-08T00:00:00Z',
    ...overrides,
  };
}

describe('WorksheetItemRow', () => {
  it('renders extracted value, review-status badge, and reason', () => {
    render(
      <WorksheetItemRow
        item={makeItem({ review_status: 'accepted_for_draft' })}
        onViewSource={() => {}}
      />,
    );

    expect(screen.getByTestId('sotr-worksheet-item-value'))
      .toHaveTextContent('Change in PANSS score at week 24');

    const badge = screen.getByTestId('sotr-review-status-badge');
    expect(badge).toHaveTextContent('Accepted for Draft');

    expect(screen.getByTestId('sotr-worksheet-item-reason'))
      .toHaveTextContent(/Section 7\.2/);
  });

  it('omits the reason when none is provided', () => {
    render(
      <WorksheetItemRow
        item={makeItem({ confidence_reason: null })}
        onViewSource={() => {}}
      />,
    );
    expect(screen.queryByTestId('sotr-worksheet-item-reason')).toBeNull();
  });

  it('renders the View Source action and fires onViewSource on click', async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    const item = makeItem();
    render(<WorksheetItemRow item={item} onViewSource={handler} />);

    const button = screen.getByTestId('sotr-view-source-button');
    expect(button).toHaveTextContent(/View Source/i);

    await user.click(button);
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(item);
  });
});

describe('formatExtractedValue', () => {
  it('passes through strings, numbers, booleans', () => {
    expect(formatExtractedValue('hello')).toBe('hello');
    expect(formatExtractedValue(42)).toBe('42');
    expect(formatExtractedValue(true)).toBe('true');
  });

  it('returns em-dash for null/undefined', () => {
    expect(formatExtractedValue(null)).toBe('—');
    expect(formatExtractedValue(undefined)).toBe('—');
  });

  it('JSON-stringifies objects/arrays', () => {
    expect(formatExtractedValue({ visit: 'V1', day: 14 }))
      .toBe('{"visit":"V1","day":14}');
  });
});

describe('formatVisit — visit window rendering', () => {
  it('renders an ASYMMETRIC window (-5/+1) with both sides distinctly and NOT as a symmetric ±', () => {
    const label = formatVisit({
      visit_name: 'Follow-up',
      study_day: 28,
      window_minus_days: 5,
      window_plus_days: 1,
    });
    // The bug: this used to collapse to "±5d", overstating the +side by 4 days.
    expect(label).not.toContain('±5d');
    expect(label).not.toContain('±');
    // The true window must show both sides.
    expect(label).toContain('-5/+1d');
    expect(label).toBe('Follow-up — Day 28 (-5/+1d)');
  });

  it('keeps the ±Nd shorthand for a SYMMETRIC window', () => {
    const label = formatVisit({
      visit_name: 'Randomization',
      study_day: 0,
      window_minus_days: 3,
      window_plus_days: 3,
    });
    expect(label).toContain('±3d');
    expect(label).toBe('Randomization — Day 0 (±3d)');
  });

  it('renders a one-sided window without a redundant zero side', () => {
    expect(formatVisit({
      visit_name: 'Screening',
      study_day: -14,
      window_minus_days: 0,
      window_plus_days: 3,
    })).toBe('Screening — Day -14 (+3d)');
    expect(formatVisit({
      visit_name: 'Screening',
      study_day: -14,
      window_minus_days: 2,
      window_plus_days: 0,
    })).toBe('Screening — Day -14 (-2d)');
  });

  it('omits the window entirely when both sides are zero', () => {
    expect(formatVisit({
      visit_name: 'Baseline',
      study_day: 1,
      window_minus_days: 0,
      window_plus_days: 0,
    })).toBe('Baseline — Day 1');
  });
});
