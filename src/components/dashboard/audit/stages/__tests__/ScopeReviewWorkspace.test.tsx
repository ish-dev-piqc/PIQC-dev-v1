// Single-source-of-truth check: the two approval gates, the advance decision,
// and the blocked reason must come from the server's stage readout
// (audit_mode_get_stage_readout via the shared stageReadouts store) — NOT be
// re-derived locally from raw questionnaire/risk-summary objects. Also covers
// the F-003 SOTR worksheet embed added to this stage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
// workflow_type feeds hasReachedStage (UX2 preview banner).
let mockActiveAudit: {
  id: string;
  current_stage: string;
  workflow_type: string;
  protocol_id: string;
  protocol_code: string;
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
// Stable setter spies for the Result-carrying vendor trio (PR-2): the
// keep-cache-on-error contract is "the setter is NOT called", which needs
// the same vi.fn() across renders.
const mockSetVendorServices = vi.fn();
const mockSetServiceMappings = vi.fn();
const mockSetTrustAssessments = vi.fn();
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => {
    const [stageReadouts, setStageReadouts] = useState(initialStageReadouts);
    return {
      protocolRisks: {}, setProtocolRisks: vi.fn(),
      vendorServices: {}, setVendorServices: mockSetVendorServices,
      serviceMappings: {}, setServiceMappings: mockSetServiceMappings,
      trustAssessments: {}, setTrustAssessments: mockSetTrustAssessments,
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
// PR-2 shape: the trio returns Result<T> — empty is { ok: true, data: null/[] }.
vi.mock('../../../../../lib/audit/vendorEnrichmentApi', () => ({
  fetchVendorService: vi.fn().mockResolvedValue({ ok: true, data: null }),
  fetchServiceMappingsByAudit: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  fetchTrustAssessment: vi.fn().mockResolvedValue({ ok: true, data: null }),
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

// Stub the SOTR embed: this suite only asserts the wiring (which studyId and
// empty-state copy the workspace passes), not SOTR's own behavior.
// NOTE: this path is relative to THIS test file (one level deeper than the
// component), so it needs four ../ where the component's import has three.
// A wrong level here doesn't error — vitest registers the mock under the
// unresolved id and the REAL component renders, firing live network calls.
vi.mock('../../../../sotr/WorksheetItemsList', () => ({
  default: (props: { studyId: string; studyCode?: string | null; emptyStateMessage?: string }) => (
    <div
      data-testid="mock-worksheet-items-list"
      data-study-id={props.studyId}
      data-study-code={props.studyCode ?? ''}
      data-empty-message={props.emptyStateMessage}
    />
  ),
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
      workflow_type: 'VENDOR_AUDIT',
      protocol_id: 'protocol-1',
      protocol_code: 'PROTO-001',
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
      workflow_type: 'VENDOR_AUDIT',
      protocol_id: 'protocol-1',
      protocol_code: 'PROTO-001',
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

  it('embeds the SOTR worksheet keyed by protocol_id with ownership-aware empty copy', async () => {
    mockReadoutForFetch = makeReadout();

    render(<ScopeReviewWorkspace />);

    await waitFor(() => {
      expect(screen.getByTestId('mock-worksheet-items-list')).toBeInTheDocument();
    });
    const embed = screen.getByTestId('mock-worksheet-items-list');
    // studyId must be the protocol UUID, never the audit id.
    expect(embed.getAttribute('data-study-id')).toBe('protocol-1');
    expect(embed.getAttribute('data-study-code')).toBe('PROTO-001');
    expect(embed.getAttribute('data-empty-message')).toMatch(
      /parse status on Stage 1 \(Intake\)/,
    );
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

// ---------------------------------------------------------------------------
// Hardening PR-2 — the vendor trio's Result absorption: server truth
// (including a legitimate null/[]) is written through; an errored read
// KEEPS the known cache instead of clobbering it with nothing.
// ---------------------------------------------------------------------------

describe('ScopeReviewWorkspace — vendor trio Result absorption (PR-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockActiveAudit = {
      id: AUDIT_ID,
      current_stage: 'SCOPE_AND_RISK_REVIEW',
      workflow_type: 'VENDOR_AUDIT',
      protocol_id: 'protocol-1',
      protocol_code: 'PROTO-001',
    };
    mockAdvanceStageError = null;
    initialStageReadouts = {};
    mockReadoutForFetch = makeReadout();
  });

  it('ok results are written through, including legitimate empties', async () => {
    render(<ScopeReviewWorkspace />);

    await waitFor(() => expect(mockSetVendorServices).toHaveBeenCalled());
    expect(mockSetServiceMappings).toHaveBeenCalled();
    expect(mockSetTrustAssessments).toHaveBeenCalled();
    // Value-level pin: the functional updater writes the ok-empty truth
    // (null / []), not a truthiness-filtered skip.
    const serviceUpdater = mockSetVendorServices.mock.calls[0][0];
    expect(serviceUpdater({})).toEqual({ [AUDIT_ID]: null });
    const mappingsUpdater = mockSetServiceMappings.mock.calls[0][0];
    expect(mappingsUpdater({})).toEqual({ [AUDIT_ID]: [] });
  });

  it('an errored read keeps the known cache — the setter is never called', async () => {
    const { fetchVendorService, fetchTrustAssessment } = await import(
      '../../../../../lib/audit/vendorEnrichmentApi'
    );
    // Once, not persistent: vi.clearAllMocks clears calls, NOT
    // implementations — a persistent override would leak into any test
    // appended after this one.
    (fetchVendorService as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'permission denied',
    });
    (fetchTrustAssessment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      error: 'permission denied',
    });

    render(<ScopeReviewWorkspace />);

    // Mappings read is healthy — its write still lands…
    await waitFor(() => expect(mockSetServiceMappings).toHaveBeenCalled());
    // …while the errored reads never clobber their stores with null.
    expect(mockSetVendorServices).not.toHaveBeenCalled();
    expect(mockSetTrustAssessments).not.toHaveBeenCalled();
  });
});
