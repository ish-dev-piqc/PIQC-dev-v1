// Single-source-of-truth check: the two approval gates, the advance decision,
// and the blocked reason must come from the server's stage readout
// (audit_mode_get_stage_readout via the shared stageReadouts store) — NOT be
// re-derived locally from raw questionnaire/risk-summary objects.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit: {
  id: string;
  current_stage: string;
} | null = null;
let mockAdvanceStageError: string | null = null;
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: mockAdvanceStageError,
  }),
}));

// stageReadouts is backed by real useState so the component's own
// setStageReadouts call (after its mount-effect getStageReadout fetch
// resolves) actually re-renders with the fetched value — a plain vi.fn()
// setter wouldn't trigger React to re-render.
let initialStageReadouts: Record<string, unknown> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => {
    const [stageReadouts, setStageReadouts] = useState(initialStageReadouts);
    return {
      protocolRisks: {}, setProtocolRisks: vi.fn(),
      vendorServices: {}, setVendorServices: vi.fn(),
      serviceMappings: {}, setServiceMappings: vi.fn(),
      trustAssessments: {}, setTrustAssessments: vi.fn(),
      riskSummaries: {}, setRiskSummaries: vi.fn(),
      questionnaires: {}, setQuestionnaires: vi.fn(),
      preAuditBundles: {}, setPreAuditBundles: vi.fn(),
      workspaceEntries: {}, setWorkspaceEntries: vi.fn(),
      reports: {}, setReports: vi.fn(),
      stageReadouts,
      setStageReadouts,
    };
  },
}));

vi.mock('../../../../../lib/audit/intakeApi', () => ({
  fetchProtocolRisksForAudit: vi.fn().mockResolvedValue([]),
}));
vi.mock('../../../../../lib/audit/vendorEnrichmentApi', () => ({
  fetchVendorService: vi.fn().mockResolvedValue(null),
  fetchServiceMappingsByAudit: vi.fn().mockResolvedValue([]),
  fetchTrustAssessment: vi.fn().mockResolvedValue(null),
}));
vi.mock('../../../../../lib/audit/questionnaireApi', () => ({
  // Raw store says approved — deliberately contradicts the readout below.
  // If the component ever falls back to hand-rolled derivation, the "blocked"
  // test fails.
  fetchQuestionnaireBundle: vi.fn().mockResolvedValue({
    instance: { approved_at: '2026-08-01T00:00:00Z' },
  }),
}));
vi.mock('../../../../../lib/audit/riskSummaryApi', () => ({
  // Raw store also says approved — same contradiction, other gate.
  fetchRiskSummary: vi.fn().mockResolvedValue({ approval_status: 'APPROVED' }),
}));

let mockReadoutForFetch: unknown = null;
vi.mock('../../../../../lib/audit/auditApi', () => ({
  getStageReadout: vi.fn(() => Promise.resolve(mockReadoutForFetch)),
}));

import ScopeReviewWorkspace from '../ScopeReviewWorkspace';

const AUDIT_ID = 'audit-1';

function makeReadout(overrides: Record<string, unknown> = {}) {
  return {
    currentStage: 'SCOPE_AND_RISK_REVIEW',
    position: 4,
    total: 8,
    questionnaireApproved: false,
    riskSummaryApproved: false,
    letterApproved: false,
    agendaApproved: false,
    checklistApproved: false,
    nextStage: 'PRE_AUDIT_DRAFTING',
    canAdvance: false,
    blockedReason: 'Questionnaire not approved',
    ...overrides,
  };
}

function advanceButton() {
  return screen.getByRole('button', { name: /advance to pre-audit drafting/i });
}

describe('ScopeReviewWorkspace gate feed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = {
      id: AUDIT_ID,
      current_stage: 'SCOPE_AND_RISK_REVIEW',
    };
    mockAdvanceStageError = null;
    initialStageReadouts = {};
    mockReadoutForFetch = null;
  });

  it('renders blocked state from the readout even when raw stores say approved', async () => {
    mockReadoutForFetch = makeReadout({
      questionnaireApproved: false,
      riskSummaryApproved: true,
      canAdvance: false,
      blockedReason: 'Questionnaire not approved',
    });

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      // Blocked reason is the server's, not a locally re-derived string.
      expect(screen.getByText('Questionnaire not approved')).toBeInTheDocument();
    });
    // Gate card hint reflects the readout's false — despite the questionnaire
    // and risk-summary stores both carrying "approved" (the contradiction the
    // old hand-derived code would have trusted).
    expect(
      screen.getByText('Approve the questionnaire in Stage 3 (Questionnaire review).'),
    ).toBeInTheDocument();
    expect(advanceButton()).toBeDisabled();
  });

  it('enables advance when the readout says both gates are clear', async () => {
    mockReadoutForFetch = makeReadout({
      questionnaireApproved: true,
      riskSummaryApproved: true,
      canAdvance: true,
      blockedReason: null,
    });

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      expect(advanceButton()).toBeEnabled();
    });
  });

  it('fails closed with an explicit message when the readout is unavailable', async () => {
    mockReadoutForFetch = null;

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      expect(
        screen.getByText('Gate status unavailable — reload to retry.'),
      ).toBeInTheDocument();
    });
    expect(advanceButton()).toBeDisabled();
  });

  it('ignores the readout’s stage-relative canAdvance while previewing ahead of the audit', async () => {
    // StageNav lets the auditor view one stage ahead: this pane can mount
    // while the audit is still at QUESTIONNAIRE_REVIEW. There the RPC
    // reports the ungated Stage 3→4 transition — canAdvance TRUE, no
    // blocked reason. Trusting that verbatim would render an enabled
    // advance button for a +2 jump the server refuses.
    mockActiveAudit = {
      id: AUDIT_ID,
      current_stage: 'QUESTIONNAIRE_REVIEW',
    };
    mockReadoutForFetch = makeReadout({
      currentStage: 'QUESTIONNAIRE_REVIEW',
      position: 3,
      nextStage: 'SCOPE_AND_RISK_REVIEW',
      canAdvance: true,
      blockedReason: null,
      questionnaireApproved: false,
      riskSummaryApproved: false,
    });

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'The audit has not reached this stage yet — advance from its current stage first.',
        ),
      ).toBeInTheDocument();
    });
    expect(advanceButton()).toBeDisabled();
  });

  it('surfaces a refused advancement instead of staying silent', async () => {
    mockReadoutForFetch = makeReadout();
    mockAdvanceStageError =
      'Cannot advance: the questionnaire is not approved. Approve it in Stage 3 (Questionnaire review).';

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Cannot advance: the questionnaire is not approved.',
      );
    });
  });
});
