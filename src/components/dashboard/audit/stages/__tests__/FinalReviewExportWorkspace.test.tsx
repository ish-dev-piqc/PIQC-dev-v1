// The pre-export checklist has 7 gates. 5 come from the server's stage
// readout (single source of truth — audit_mode_get_stage_readout): risk
// summary, questionnaire, confirmation letter, agenda, checklist approvals.
// The remaining 2 aren't covered by that RPC and stay hand-derived from raw
// stores: all workspace entries classified, report draft approved.
//
// This suite pins that 5-of-7 split so a future "just swap all 7" or
// "swap none" refactor gets caught.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { MockWorkspaceEntry } from '../../../../../lib/audit/mockWorkspaceEntries';
import type { MockReportDraft } from '../../../../../lib/audit/mockReport';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'dark' as const, toggleTheme: () => {} }),
}));

// workflow_type + current_stage feed hasReachedStage (UX2 one-ahead preview
// guard). Default: the audit is really at Stage 8, so legacy tests see the
// pre-UX2 behavior unchanged.
let mockActiveAudit = {
  id: 'audit-1',
  audit_name: 'Vendor audit',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'FINAL_REVIEW_EXPORT',
};
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ activeAudit: mockActiveAudit }),
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

// Grounding-currency reads (PR-C3). Defaults keep the panel absent so the
// pre-existing checklist tests are unaffected; the currency suite overrides.
let mockBundle: {
  confirmation_letter: unknown;
  agenda: unknown;
  checklist: unknown;
  internal_notification?: unknown;
  evidence_gap_summary?: unknown;
} = { confirmation_letter: null, agenda: null, checklist: null, internal_notification: null };
// PR-1 (persist honesty): the fetch reports per-kind read failures; a failed
// kind means "unknown", and the currency effect must render no verdict.
let mockFailedKinds: string[] = [];
vi.mock('../../../../../lib/audit/preAuditApi', () => ({
  fetchPreAuditDeliverables: vi.fn(() =>
    Promise.resolve({ bundle: mockBundle, failedKinds: mockFailedKinds }),
  ),
}));

let mockRegister: { ok: boolean; data?: unknown[]; error?: string } = { ok: true, data: [] };
vi.mock('../../../../../lib/audit/evidenceApi', () => ({
  listAuditEvidence: vi.fn(() => Promise.resolve(mockRegister)),
}));

// The certificate section (PR-D6) has its own suite; here it would drag its
// module graph (auditCertificate reads) into every workspace test.
vi.mock('../AuditCertificateSection', () => ({ default: () => null }));

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

describe('FinalReviewExportWorkspace grounding currency (flag, never block)', () => {
  const SNAPSHOT = {
    protocol_document_ids: ['pd1'],
    evidence: [{ document_id: 'd1', content_hash: 'abc', title: 'QA SOP v3', source_type: 'SOP' }],
  };
  const REGISTER_ROW = {
    audit_id: 'audit-1',
    document_id: 'd1',
    added_by: 'u1',
    added_at: '2026-08-30T12:00:00Z',
    source_type: 'SOP',
    source_system: null,
    source_locator: null,
    include_in_generation: true,
    title: 'QA SOP v3',
    status: 'ready',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceEntries = { 'audit-1': [] };
    mockReportsMap = {};
    initialStageReadouts = {};
    mockReadout = null;
    mockBundle = { confirmation_letter: null, agenda: null, checklist: null, internal_notification: null };
    mockFailedKinds = [];
    mockRegister = { ok: true, data: [] };
  });

  it('renders nothing when no deliverable was ever generated', async () => {
    render(<FinalReviewExportWorkspace />);
    await waitFor(() => expect(screen.getByText(/Pre-export checklist/)).toBeTruthy());
    expect(screen.queryByTestId('export-currency-notice')).toBeNull();
    expect(screen.queryByTestId('export-currency-current')).toBeNull();
  });

  it('shows the quiet all-current line when snapshots match the register', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: { grounding_snapshot: SNAPSHOT, content: { items: [] } },
    };
    mockRegister = { ok: true, data: [REGISTER_ROW] };
    render(<FinalReviewExportWorkspace />);
    expect(await screen.findByTestId('export-currency-current')).toBeTruthy();
    expect(screen.queryByTestId('export-currency-notice')).toBeNull();
  });

  it('names the drifted deliverable and its new source — and never gates export', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: { grounding_snapshot: SNAPSHOT },
      checklist: { grounding_snapshot: SNAPSHOT, content: { items: [] } },
    };
    mockRegister = {
      ok: true,
      data: [
        REGISTER_ROW,
        { ...REGISTER_ROW, document_id: 'd2', title: 'Training matrix' },
      ],
    };
    render(<FinalReviewExportWorkspace />);
    const notice = await screen.findByTestId('export-currency-notice');
    expect(notice.textContent).toContain('Agenda:');
    expect(notice.textContent).toContain('Checklist:');
    expect(notice.textContent).toContain('Training matrix');
    expect(notice.textContent).toContain('never blocks export');
  });

  it('lists a PIQC-drafted internal notification in the currency panel (PR-D1)', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: null,
      internal_notification: { grounding_snapshot: SNAPSHOT },
    };
    mockRegister = {
      ok: true,
      data: [
        REGISTER_ROW,
        { ...REGISTER_ROW, document_id: 'd2', title: 'Training matrix' },
      ],
    };
    render(<FinalReviewExportWorkspace />);
    const notice = await screen.findByTestId('export-currency-notice');
    expect(notice.textContent).toContain('Internal notification:');
    expect(notice.textContent).toContain('Training matrix');
  });

  it('renders no verdict at all when the register read fails', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: { grounding_snapshot: SNAPSHOT, content: { items: [] } },
    };
    mockRegister = { ok: false, error: 'permission denied' };
    render(<FinalReviewExportWorkspace />);
    await waitFor(() => expect(screen.getByText(/Pre-export checklist/)).toBeTruthy());
    expect(screen.queryByTestId('export-currency-notice')).toBeNull();
    expect(screen.queryByTestId('export-currency-current')).toBeNull();
  });

  it('gap summary uses full-register currency: a withheld doc added after drafting flags IT, not legacy kinds (PR-D3)', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: { grounding_snapshot: SNAPSHOT, content: { items: [] } },
      evidence_gap_summary: {
        grounding_snapshot: {
          ...SNAPSHOT,
          register: [{ document_id: 'd1', title: 'QA SOP v3', status: 'ready', included: true }],
          checklist_item_ids: [],
        },
      },
    };
    mockRegister = {
      ok: true,
      data: [
        REGISTER_ROW,
        // Withheld → invisible to the legacy included-only diff, but part of
        // the gap summary's basis (it must NAME withheld docs).
        { ...REGISTER_ROW, document_id: 'd2', title: 'Withheld doc', include_in_generation: false },
      ],
    };
    render(<FinalReviewExportWorkspace />);
    const notice = await screen.findByTestId('export-currency-notice');
    expect(notice.textContent).toContain('Evidence gap summary:');
    expect(notice.textContent).toContain('Withheld doc');
    // The legacy checklist snapshot stays current — one drifted row only.
    expect(notice.textContent).not.toContain('Checklist:');
  });

  it('a failed kind is named as unavailable while healthy kinds keep their verdicts (PR-1)', async () => {
    // The checklist read is fine and current — its quiet verdict must NOT be
    // suppressed by the unreadable gap summary. The gap summary must be
    // named, never silently absent (absence reads as "current").
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: { grounding_snapshot: SNAPSHOT, content: { items: [] } },
      evidence_gap_summary: null,
    };
    mockFailedKinds = ['evidence_gap_summary'];
    mockRegister = { ok: true, data: [REGISTER_ROW] };
    render(<FinalReviewExportWorkspace />);
    const note = await screen.findByTestId('export-currency-unavailable');
    expect(note.textContent).toContain('Evidence gap summary');
    expect(screen.getByTestId('export-currency-current')).toBeTruthy();
    expect(screen.queryByTestId('export-currency-notice')).toBeNull();
  });

  it('a failed CHECKLIST read makes the gap summary checklist axis unknowable, not drifted (PR-1)', async () => {
    // Same shape as the checklist-identity drift test below, but the live
    // checklist is UNREADABLE — a fake [] would flag drift that may not
    // exist. The gap summary's register axis is current, so no notice.
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: null, // read failed
      evidence_gap_summary: {
        grounding_snapshot: {
          ...SNAPSHOT,
          register: [{ document_id: 'd1', title: 'QA SOP v3', status: 'ready', included: true }],
          checklist_item_ids: ['i1'],
        },
      },
    };
    mockFailedKinds = ['checklist'];
    mockRegister = { ok: true, data: [REGISTER_ROW] };
    render(<FinalReviewExportWorkspace />);
    const note = await screen.findByTestId('export-currency-unavailable');
    expect(note.textContent).toContain('Checklist');
    expect(screen.queryByTestId('export-currency-notice')).toBeNull();
  });

  it('gap summary flags checklist-identity drift via the live checklist items (PR-D3)', async () => {
    mockBundle = {
      confirmation_letter: null,
      agenda: null,
      checklist: { content: { items: [{ id: 'i1' }, { id: 'i2' }] } }, // never PIQC-drafted itself
      evidence_gap_summary: {
        grounding_snapshot: {
          ...SNAPSHOT,
          register: [{ document_id: 'd1', title: 'QA SOP v3', status: 'ready', included: true }],
          checklist_item_ids: ['i1'], // drafted when the checklist had one item
        },
      },
    };
    mockRegister = { ok: true, data: [REGISTER_ROW] };
    render(<FinalReviewExportWorkspace />);
    const notice = await screen.findByTestId('export-currency-notice');
    expect(notice.textContent).toContain('Evidence gap summary:');
    expect(notice.textContent).toContain('checklist items changed');
  });
});

// -----------------------------------------------------------------------------
// PR-UX2 — one-ahead preview guard. Stage 8 is viewable while the audit is
// still at Stage 7, and the sign-off/export RPCs carry no server-side stage
// check — the preview must therefore never offer the sign-off latch, even
// with every artefact gate green.
// -----------------------------------------------------------------------------

describe('FinalReviewExportWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFailedKinds = [];
    mockActiveAudit = {
      id: 'audit-1',
      audit_name: 'Vendor audit',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'REPORT_DRAFTING', // one behind — previewing Stage 8
    };
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
    mockReadout = {
      riskSummaryApproved: true,
      questionnaireApproved: true,
      letterApproved: true,
      agendaApproved: true,
      checklistApproved: true,
    };
    initialStageReadouts = {};
  });

  afterEach(() => {
    // Restore the at-stage default so test-order changes never leak the
    // preview stage into other describes.
    mockActiveAudit = {
      id: 'audit-1',
      audit_name: 'Vendor audit',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'FINAL_REVIEW_EXPORT',
    };
  });

  it('all 7 gates green but audit still at Stage 7 → sign-off disabled, preview notice up', async () => {
    render(<FinalReviewExportWorkspace />);

    await waitFor(() => {
      expect(screen.getByText('7 of 7 gates passed')).toBeInTheDocument();
    });
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign off audit/i })).toBeDisabled();
  });
});
