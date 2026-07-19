import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NoticeCard } from '../NoticeCard';
import type { NoticeRecord } from '../../../types/actions';

// =============================================================================
// NoticeCard — pure presentation. Only consumes ThemeContext (default 'light'),
// so an unwrapped render is deterministic (PrefillAgentNote precedent). Locks
// the observation contract: headline + detail render, evidence count is honest
// (and hidden at zero), dismiss fires the callback, and there is NO link-out or
// destination chip (a notice is an observation, not a handoff).
// =============================================================================

const baseNotice: NoticeRecord = {
  id: 'notice-1',
  protocol_id: 'prot-1',
  notice_type: 'tight_visit_window',
  severity: 1,
  headline: 'Tight visit windows',
  detail:
    '3 visits allow 2 days or less of scheduling tolerance — protocol deviations are easy to trigger here.',
  observed_count: 3,
  protocol_evidence_ids: ['ev-1', 'ev-2'],
  status: 'active',
  created_at: '2026-07-08T12:00:00Z',
  updated_at: '2026-07-08T12:00:00Z',
};

describe('NoticeCard', () => {
  it('renders the headline, detail, and provenance chip', () => {
    render(<NoticeCard notice={baseNotice} onDismiss={() => {}} />);
    expect(screen.getByText('Tight visit windows')).toBeInTheDocument();
    expect(screen.getByText(/scheduling tolerance/)).toBeInTheDocument();
    expect(screen.getByText('Noticed')).toBeInTheDocument();
  });

  it('shows an honest, plural-correct evidence count', () => {
    render(<NoticeCard notice={baseNotice} onDismiss={() => {}} />);
    expect(screen.getByText('2 protocol sources')).toBeInTheDocument();
  });

  it('singularizes a single-evidence count', () => {
    render(
      <NoticeCard
        notice={{ ...baseNotice, protocol_evidence_ids: ['ev-1'] }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('1 protocol source')).toBeInTheDocument();
  });

  it('hides the evidence line entirely when there is no evidence', () => {
    render(
      <NoticeCard
        notice={{ ...baseNotice, protocol_evidence_ids: [] }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.queryByText(/protocol source/)).not.toBeInTheDocument();
  });

  it('renders no link-out (a notice is not a handoff)', () => {
    render(<NoticeCard notice={baseNotice} onDismiss={() => {}} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('fires onDismiss with the notice', async () => {
    const onDismiss = vi.fn();
    render(<NoticeCard notice={baseNotice} onDismiss={onDismiss} />);
    await userEvent.click(screen.getByTestId('notice-card-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith(baseNotice);
  });

  it('still renders an unknown notice_type (server owns the taxonomy)', () => {
    render(
      <NoticeCard
        notice={{ ...baseNotice, notice_type: 'brand_new_kind' }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Tight visit windows')).toBeInTheDocument();
    expect(screen.getByTestId('notice-card')).toHaveAttribute(
      'data-notice-type',
      'brand_new_kind',
    );
  });

  it('renders the cross_document_divergence type (N1)', () => {
    render(
      <NoticeCard
        notice={{
          ...baseNotice,
          notice_type: 'cross_document_divergence',
          headline: 'Documents disagree',
          detail:
            "2 protocol facts read differently across two or more of this protocol's documents \u2014 reconcile the versions before relying on them.",
        }}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText('Documents disagree')).toBeInTheDocument();
    expect(screen.getByText(/reconcile the versions/)).toBeInTheDocument();
    expect(screen.getByTestId('notice-card')).toHaveAttribute(
      'data-notice-type',
      'cross_document_divergence',
    );
  });

  it('renders the unwindowed_visit type (N2)', () => {
    render(
      <NoticeCard
        notice={{
          ...baseNotice,
          notice_type: 'unwindowed_visit',
          headline: 'Visits without scheduling windows',
          detail:
            "1 visit has no scheduling window in the schedule rows PIQC read, while other visits in this protocol state one \u2014 confirm the open timing is intentional.",
        }}
        onDismiss={() => {}}
      />,
    );
    expect(
      screen.getByText('Visits without scheduling windows'),
    ).toBeInTheDocument();
    expect(screen.getByText(/schedule rows PIQC read/)).toBeInTheDocument();
    expect(screen.getByTestId('notice-card')).toHaveAttribute(
      'data-notice-type',
      'unwindowed_visit',
    );
  });
});
