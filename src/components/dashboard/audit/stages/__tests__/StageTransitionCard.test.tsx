// StageTransitionCard — the advance control for the ungated vendor stages
// (vendor-early-stage-advance). Four states from the audit's real position,
// the click, and the inline server-rejection alert. Mock idiom follows
// ScopeReviewWorkspace.test.tsx (useAudit with a mutable activeAudit, an
// advanceStage spy and a settable advanceStageError).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit: { id: string; workflow_type: string; current_stage: string } | null = null;
let mockAdvanceStageError: string | null = null;
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: mockAdvanceStageError,
  }),
}));

import StageTransitionCard from '../StageTransitionCard';

function vendorAuditAt(stage: string) {
  return { id: 'audit-1', workflow_type: 'VENDOR_AUDIT', current_stage: stage };
}

function advanceButton() {
  return screen.getByRole('button', { name: /advance to questionnaire review/i });
}

describe('StageTransitionCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = null;
    mockAdvanceStageError = null;
  });

  it('at the stage: ready copy, enabled button, click advances to the next stage', () => {
    mockActiveAudit = vendorAuditAt('VENDOR_ENRICHMENT');

    render(<StageTransitionCard stage="VENDOR_ENRICHMENT" nextStage="QUESTIONNAIRE_REVIEW" />);

    expect(screen.getByText('Stage transition')).toBeInTheDocument();
    expect(screen.getByText('Ready to advance')).toBeInTheDocument();
    expect(screen.getByText(/No gate on this transition/)).toBeInTheDocument();
    expect(advanceButton()).toBeEnabled();

    fireEvent.click(advanceButton());
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('QUESTIONNAIRE_REVIEW');
  });

  it('past the stage: already-advanced copy names the current stage, button disabled', () => {
    mockActiveAudit = vendorAuditAt('SCOPE_AND_RISK_REVIEW');

    render(<StageTransitionCard stage="VENDOR_ENRICHMENT" nextStage="QUESTIONNAIRE_REVIEW" />);

    expect(screen.getByText('Audit has already advanced past this stage')).toBeInTheDocument();
    expect(screen.getByText('Current stage: Scope & risk review')).toBeInTheDocument();
    expect(advanceButton()).toBeDisabled();

    fireEvent.click(advanceButton());
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });

  it('ahead of the audit (one-ahead preview): terse ahead copy naming the current stage, button disabled', () => {
    mockActiveAudit = vendorAuditAt('INTAKE');

    render(<StageTransitionCard stage="VENDOR_ENRICHMENT" nextStage="QUESTIONNAIRE_REVIEW" />);

    expect(screen.getByText('Ahead of the audit’s current stage')).toBeInTheDocument();
    expect(screen.getByText('Advance from Intake first.')).toBeInTheDocument();
    // The page-level StagePreviewNotice owns the "has not reached this stage
    // yet" sentence; the card must not echo it (sibling tests match on it).
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
    expect(advanceButton()).toBeDisabled();
  });

  it('surfaces the server rejection from AuditContext as an inline alert', () => {
    mockActiveAudit = vendorAuditAt('VENDOR_ENRICHMENT');
    mockAdvanceStageError = 'Forward transitions must move exactly one stage (STAGE_NOT_IN_ADVANCEMENT_MAP)';

    render(<StageTransitionCard stage="VENDOR_ENRICHMENT" nextStage="QUESTIONNAIRE_REVIEW" />);

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/advance the stage: Forward transitions must move exactly one stage/);
  });

  it('renders nothing without an active audit', () => {
    const { container } = render(
      <StageTransitionCard stage="VENDOR_ENRICHMENT" nextStage="QUESTIONNAIRE_REVIEW" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
