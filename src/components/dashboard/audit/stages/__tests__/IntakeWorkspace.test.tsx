// IntakeWorkspace — vendor Stage 1. The tagging flow is pinned in
// IsaRiskAssessmentWorkspace.test.tsx (through the shared ProtocolRiskTagging)
// and the transition card's states in StageTransitionCard.test.tsx; here we
// lock the wrapper itself: header, the tagging flow mounted for the vendor
// workflow, and the ungated Intake → Vendor enrichment transition
// (vendor-early-stage-advance — the stage had no advance control before).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit = { id: 'audit-1', workflow_type: 'VENDOR_AUDIT', current_stage: 'INTAKE' };
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

// A string child, not JSX: the factory is hoisted above the jsx runtime
// import. Mocking the flow keeps src/lib/supabase out of this test.
vi.mock('../intake/ProtocolRiskTagging', () => ({
  default: () => 'tagging-marker',
}));

import IntakeWorkspace from '../IntakeWorkspace';

describe('IntakeWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = { id: 'audit-1', workflow_type: 'VENDOR_AUDIT', current_stage: 'INTAKE' };
  });

  it('renders the vendor Stage-1 header, the tagging flow, and the transition to Vendor enrichment', () => {
    render(<IntakeWorkspace />);

    expect(screen.getByText('Stage 1 · Intake')).toBeInTheDocument();
    expect(screen.getByText('Protocol section tagging')).toBeInTheDocument();
    expect(screen.getByText('tagging-marker')).toBeInTheDocument();

    const button = screen.getByRole('button', { name: /advance to vendor enrichment/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledWith('VENDOR_ENRICHMENT');
  });

  it('once the audit has moved on, the transition reads already-advanced and is disabled', () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'VENDOR_ENRICHMENT' };

    render(<IntakeWorkspace />);

    expect(screen.getByText('Audit has already advanced past this stage')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /advance to vendor enrichment/i })).toBeDisabled();
  });
});
