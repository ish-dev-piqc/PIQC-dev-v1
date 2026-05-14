import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewStatusBadge from '../ReviewStatusBadge';

describe('ReviewStatusBadge', () => {
  it.each([
    ['accepted_for_draft', 'Accepted for Draft'],
    ['edited',             'Edited'],
    ['rejected_from_draft','Rejected from Draft'],
    ['flagged',            'Flagged'],
  ] as const)('renders label for status=%s', (status, label) => {
    render(<ReviewStatusBadge status={status} />);
    expect(screen.getByTestId('sotr-review-status-badge')).toHaveTextContent(label);
  });

  it('renders nothing for the default "draft" status', () => {
    const { container } = render(<ReviewStatusBadge status="draft" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when status is undefined', () => {
    const { container } = render(<ReviewStatusBadge status={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('uses draft-review language only — no approval/signature terms', () => {
    const states = ['accepted_for_draft', 'edited', 'rejected_from_draft', 'flagged'] as const;
    for (const s of states) {
      const { unmount } = render(<ReviewStatusBadge status={s} />);
      const text = screen.getByTestId('sotr-review-status-badge').textContent || '';
      expect(text).not.toMatch(/approve|approval|sign|signature|certif|gxp|part 11/i);
      unmount();
    }
  });
});
