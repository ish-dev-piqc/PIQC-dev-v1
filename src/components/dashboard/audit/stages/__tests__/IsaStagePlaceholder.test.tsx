// IsaStagePlaceholder — the walkable stand-in for ISA stages without a
// workspace (isa-placeholder-advance). Pins: the stage copy; the transition
// card toward the pipeline's next stage (Audit prep → Audit conduct) in its
// three states; no card on the terminal stage; the preview notice when
// viewed one ahead; the copy alone without an active audit. Mock idiom
// follows StageTransitionCard.test.tsx (mutable activeAudit, advanceStage spy).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit: { id: string; workflow_type: string; current_stage: string } | null = null;
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

import IsaStagePlaceholder from '../investigator/IsaStagePlaceholder';

function isaAuditAt(stage: string) {
  return { id: 'audit-isa-1', workflow_type: 'INVESTIGATOR_SITE_AUDIT', current_stage: stage };
}

describe('IsaStagePlaceholder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = null;
  });

  it('at Audit prep: stage copy, ready card, click advances to Audit conduct', () => {
    mockActiveAudit = isaAuditAt('ISA_PREP');

    render(<IsaStagePlaceholder stage="ISA_PREP" />);

    expect(screen.getByRole('heading', { name: 'Audit prep' })).toBeInTheDocument();
    expect(screen.getByText('Request documents and set the sampling approach.')).toBeInTheDocument();
    expect(screen.getByText("This workspace isn't available yet.")).toBeInTheDocument();
    expect(screen.queryByText(/this is a preview/i)).not.toBeInTheDocument();

    expect(screen.getByText('Ready to advance')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Audit conduct' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_CONDUCT');
  });

  it('viewed one ahead (audit at Scope builder): preview notice above the ahead card, button disabled', () => {
    mockActiveAudit = isaAuditAt('ISA_SCOPE_BUILDER');

    render(<IsaStagePlaceholder stage="ISA_PREP" />);

    // Two elements name the current stage: the notice and the card's ahead
    // line — each matched on its own copy.
    expect(
      screen.getByText(/this is a preview\. Actions here are disabled until you advance from Scope builder\./i),
    ).toBeInTheDocument();
    expect(screen.getByText('Advance from Scope builder first.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Audit conduct' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });

  it('past the stage (audit at Audit conduct): no notice, already-advanced card, button disabled', () => {
    mockActiveAudit = isaAuditAt('ISA_CONDUCT');

    render(<IsaStagePlaceholder stage="ISA_PREP" />);

    expect(screen.queryByText(/this is a preview/i)).not.toBeInTheDocument();
    expect(screen.getByText('Audit has already advanced past this stage')).toBeInTheDocument();
    expect(screen.getByText('Current stage: Audit conduct')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance to Audit conduct' })).toBeDisabled();
  });

  it('the terminal stage (Review & export) has no successor and no card', () => {
    mockActiveAudit = isaAuditAt('ISA_REPORT');

    render(<IsaStagePlaceholder stage="ISA_EXPORT" />);

    expect(screen.getByRole('heading', { name: 'Review & export' })).toBeInTheDocument();
    expect(screen.getByText(/this is a preview/i)).toBeInTheDocument();
    expect(screen.queryByText('Stage transition')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /advance to/i })).not.toBeInTheDocument();
  });

  it('without an active audit: the copy alone — no notice, no card', () => {
    render(<IsaStagePlaceholder stage="ISA_PREP" />);

    expect(screen.getByRole('heading', { name: 'Audit prep' })).toBeInTheDocument();
    expect(screen.queryByText(/this is a preview/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Stage transition')).not.toBeInTheDocument();
  });
});
