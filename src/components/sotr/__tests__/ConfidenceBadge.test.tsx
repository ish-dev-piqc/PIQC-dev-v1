import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ConfidenceBadge from '../ConfidenceBadge';

describe('ConfidenceBadge', () => {
  it.each([
    ['high',         'High'],
    ['medium',       'Medium'],
    ['low',          'Low'],
    ['needs_review', 'Needs Review'],
  ] as const)('renders state=%s with label %s', (state, label) => {
    render(<ConfidenceBadge state={state} />);
    const badge = screen.getByTestId('sotr-confidence-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge.getAttribute('data-state')).toBe(state);
  });
});
