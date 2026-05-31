import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import VisitConfidenceChip from '../VisitConfidenceChip';

// vitest runs with globals:false, so @testing-library's auto-cleanup isn't
// registered — unmount between cases ourselves to avoid DOM accumulation.
afterEach(cleanup);

// =============================================================================
// VisitConfidenceChip — only the attention states render (rare-loud). high /
// medium / undefined stay silent so the chip means "look here".
// =============================================================================

describe('VisitConfidenceChip', () => {
  it('renders nothing for undefined confidence', () => {
    const { container } = render(<VisitConfidenceChip />);
    expect(container.firstChild).toBeNull();
  });

  it.each(['high', 'medium'] as const)('renders nothing for %s confidence', (c) => {
    const { container } = render(<VisitConfidenceChip confidence={c} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a Low confidence chip for low', () => {
    render(<VisitConfidenceChip confidence="low" />);
    const chip = screen.getByTestId('visit-confidence-chip');
    expect(chip).toHaveAttribute('data-confidence', 'low');
    expect(chip).toHaveTextContent('Low confidence');
  });

  it('renders a Needs review chip for needs_review', () => {
    render(<VisitConfidenceChip confidence="needs_review" />);
    const chip = screen.getByTestId('visit-confidence-chip');
    expect(chip).toHaveAttribute('data-confidence', 'needs_review');
    expect(chip).toHaveTextContent('Needs review');
  });
});
