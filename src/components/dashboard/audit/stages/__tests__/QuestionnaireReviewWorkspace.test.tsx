// PR-UX2 — one-ahead preview guard for Stage 3. The shell's nav allows
// viewing QUESTIONNAIRE_REVIEW while the audit is still at VENDOR_ENRICHMENT;
// the preview must not offer instance creation (and, once an instance exists,
// readOnly covers edits/transitions/approval — the approve latch pre-flips the
// Stage 4 gate, the worst preview write). Mock idiom follows
// ReportDraftingWorkspace.test.tsx (PR #66/#69 precedent).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'QUESTIONNAIRE_REVIEW',
};
const mockAdvanceStage = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    questionnaires: {},
    setQuestionnaires: vi.fn(),
    setStageReadouts: vi.fn(),
  }),
}));

vi.mock('../../../../../lib/audit/questionnaireApi', () => ({
  fetchQuestionnaireBundle: vi.fn(() => Promise.resolve(null)),
  createQuestionnaireInstance: vi.fn(),
  transitionQuestionnaireStatus: vi.fn(),
  approveQuestionnaire: vi.fn(),
  upsertResponse: vi.fn(),
  setResponseInconsistency: vi.fn(),
}));

vi.mock('../../../../../lib/audit/auditApi', () => ({
  getStageReadout: vi.fn(() => Promise.resolve(null)),
}));

import QuestionnaireReviewWorkspace from '../QuestionnaireReviewWorkspace';
import { fetchQuestionnaireBundle } from '../../../../../lib/audit/questionnaireApi';

const mockFetchBundle = fetchQuestionnaireBundle as ReturnType<typeof vi.fn>;

describe('QuestionnaireReviewWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBundle.mockResolvedValue(null);
  });

  it('PREVIEW (audit at Stage 2): notice renders, create-instance affordance absent', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'VENDOR_ENRICHMENT',
    };

    render(<QuestionnaireReviewWorkspace />);

    await waitFor(() => expect(mockFetchBundle).toHaveBeenCalledWith('audit-1'));
    expect(screen.getByText(/this is a preview/i)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /create questionnaire instance/i }),
    ).not.toBeInTheDocument();
  });

  it('AT STAGE: create-instance button present, no preview notice', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'QUESTIONNAIRE_REVIEW',
    };

    render(<QuestionnaireReviewWorkspace />);

    await waitFor(() => expect(mockFetchBundle).toHaveBeenCalled());
    expect(
      screen.getByRole('button', { name: /create questionnaire instance/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/this is a preview/i)).not.toBeInTheDocument();
  });
});

// vendor-early-stage-advance: the ungated Stage 3 → 4 transition. The server
// allows it with no questionnaire instance (the questionnaire gate is Stage
// 4's), so the card is mounted on the no-instance branch too. Card states are
// pinned in StageTransitionCard.test.tsx.
describe('QuestionnaireReviewWorkspace — stage transition (vendor-early-stage-advance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchBundle.mockResolvedValue(null);
  });

  it('AT STAGE with no instance yet: offers "Advance to Scope & risk review" and advances', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'QUESTIONNAIRE_REVIEW',
    };

    render(<QuestionnaireReviewWorkspace />);

    await waitFor(() => expect(mockFetchBundle).toHaveBeenCalledWith('audit-1'));
    const button = screen.getByRole('button', { name: /advance to scope & risk review/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledWith('SCOPE_AND_RISK_REVIEW');
  });

  it('PREVIEW (audit at Stage 2): the transition button is present but disabled', async () => {
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'VENDOR_ENRICHMENT',
    };

    render(<QuestionnaireReviewWorkspace />);

    await waitFor(() => expect(mockFetchBundle).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: /advance to scope & risk review/i })).toBeDisabled();
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });
});
