// The pre-export checklist has 7 gates. 5 come from the server's stage
// readout (single source of truth — audit_mode_get_stage_readout): risk
// summary, questionnaire, confirmation letter, agenda, checklist approvals.
// The remaining 2 aren't covered by that RPC and stay hand-derived from raw
// stores: all workspace entries classified, report draft approved.
//
// This suite pins that 5-of-7 split so a future "just swap all 7" or
// "swap none" refactor gets caught.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import type { MockReportDraft } from '../../../../../lib/audit/mockReport';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' as const, toggleTheme: () => {} }),
}));

const ACTIVE_AUDIT = { id: 'audit-1', audit_name: 'Vendor audit' };
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ activeAudit: ACTIVE_AUDIT }),
}));

let mockWorkspaceEntries: Record<string, MockWorkspaceEntry[]> = {};
let mockReportsMap: Record<string, MockReportDraft | null> = {};
const mockSetReports = vi.fn();
// stageReadouts is backed by real useState so the component's own
// setStageReadouts call (after its mount-effect getStageReadout fetch
// resolves) actually re-renders with the fetched value — a plain vi.fn()
// setter wouldn't trigger React to re-render, and the 5 readout gates
// would sit at fail-closed forever.
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
      workspaceEntries: mockWorkspaceEntries,
      setWorkspaceEntries: vi.fn(),
      reports: mockReportsMap,
      setReports: mockSetReports,
      stageReadouts,
      setStageReadouts,
    };
  },
}));

vi.mock('../../../../../lib/audit/reportApi', () => ({
  fetchReportDraft: vi.fn(() => Promise.resolve(null)),
  finalSignOffReport: vi.fn(),
  markReportExported: vi.fn(),
  verifyExportReadiness: vi.fn(),
}));

let mockReadout: {
  riskSummaryApproved: boolean;
  questionnaireApproved: boolean;
  letterApproved: boolean;
  agendaApproved: boolean;
  checklistApproved: boolean;
} | null = null;
vi.mock('../../../../../lib/audit/auditApi', () => ({
  getStageReadout: vi.fn(() => Promise.resolve(mockReadout)),
}));

import FinalReviewExportWorkspace from '../FinalReviewExportWorkspace';

function makeEntry(overrides: Partial<MockWorkspaceEntry> = {}): MockWorkspaceEntry {
  return {
    id: 'entry-1',
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: 'Observed X',
    provisional_impact: 'MINOR',
    provisional_classification: 'FINDING',
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    source_extracted_item_id: null,
    created_by_name: 'Auditor',
    created_at: '2026-08-01T00:00:00Z',
    ...overrides,
  };
}

describe('FinalReviewExportWorkspace pre-export checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceEntries = { 'audit-1': [makeEntry()] };
    mockReportsMap = {
      'audit-1': {
        id: 'rd-1',
        audit_id: 'audit-1',
        executive_summary: '',
        conclusions: '',
        approval_status: 'APPROVED',
        approved_at: '2026-08-01T00:00:00Z',
        approved_by_name: 'Auditor',
        updated_at: '2026-08-01T00:00:00Z',
        final_signed_off_at: null,
        final_signed_off_by_name: null,
        exported_at: null,
      } as MockReportDraft,
    };
    mockReadout = null;
    initialStageReadouts = {};
  });

  it('derives 5 of 7 gates from the stage readout, independent of raw stores', async () => {
    // All 5 readout-backed gates pass; the 2 hand-derived gates (entries
    // classified, report approved) also pass via the fixtures above — so all
    // 7 should read as passed once the readout resolves.
    mockReadout = {
      riskSummaryApproved: true,
      questionnaireApproved: true,
      letterApproved: true,
      agendaApproved: true,
      checklistApproved: true,
    };

    render(<FinalReviewExportWorkspace />);

    await waitFor(() => {
      expect(screen.getByText('7 of 7 gates passed')).toBeInTheDocument();
    });
    expect(screen.getByText('Risk summary approved')).toBeInTheDocument();
    expect(screen.getByText('Confirmation letter approved')).toBeInTheDocument();
  });

  it('fails the 5 readout-backed gates closed while the readout is unavailable', async () => {
    mockReadout = null;

    render(<FinalReviewExportWorkspace />);

    await waitFor(() => {
      // Only the 2 hand-derived gates (entries classified, report approved)
      // pass — the 5 readout-backed gates default to unpassed with no readout.
      expect(screen.getByText('2 of 7 gates passed')).toBeInTheDocument();
    });
    // And the pane says WHY, instead of letting the auditor read "approval
    // pending" on gates they know they approved.
    expect(
      screen.getByText('Gate status unavailable — reload to retry.'),
    ).toBeInTheDocument();
  });

  it('keeps the 2 non-readout gates hand-derived from raw stores', async () => {
    mockReadout = {
      riskSummaryApproved: true,
      questionnaireApproved: true,
      letterApproved: true,
      agendaApproved: true,
      checklistApproved: true,
    };
    // Entries not yet classified — this gate isn't covered by the readout, so
    // it must still reflect the raw workspaceEntries store.
    mockWorkspaceEntries = {
      'audit-1': [makeEntry({ provisional_classification: 'NOT_YET_CLASSIFIED' })],
    };

    render(<FinalReviewExportWorkspace />);

    await waitFor(() => {
      expect(screen.getByText('6 of 7 gates passed')).toBeInTheDocument();
    });
  });
});
