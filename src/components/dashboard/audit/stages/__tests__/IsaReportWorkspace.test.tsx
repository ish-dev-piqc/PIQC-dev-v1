// PR-UX2 — one-ahead preview guard for ISA Stage 6 (report drafting).
// Previewing from ISA_CONDUCT used to leave LLM section drafting, prose
// saves, and the site-continuation verdict live. Mock idiom follows the
// vendor stage tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'INVESTIGATOR_SITE_AUDIT',
  current_stage: 'ISA_REPORT',
  auditee_name: 'Site 042',
  site_number: '042',
  principal_investigator: 'Dr. Example',
  site_country: 'US',
  protocol_code: 'PIQC-001',
  protocol_title: 'Demo protocol',
  audit_type: 'ONSITE',
  scheduled_date: null,
  scheduled_end_date: null,
};
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

const { MockSectionError } = vi.hoisted(() => {
  class MockSectionError extends Error {}
  return { MockSectionError };
});

vi.mock('../../../../../lib/audit/isaReportApi', () => ({
  fetchIsaReportDraft: vi.fn(() => Promise.resolve({ ok: true, data: null })),
  IsaReportSectionError: MockSectionError,
  requestIsaReportSection: vi.fn(),
  upsertIsaReportDraft: vi.fn(),
}));

vi.mock('../../../../../lib/audit/isaNotesApi', () => ({
  fetchIsaNotes: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('../../../../../lib/audit/isaFindingsApi', () => ({
  fetchIsaFindings: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

import IsaReportWorkspace from '../investigator/IsaReportWorkspace';
import { fetchIsaReportDraft } from '../../../../../lib/audit/isaReportApi';

const mockFetchDraft = fetchIsaReportDraft as ReturnType<typeof vi.fn>;

describe('IsaReportWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDraft.mockResolvedValue({ ok: true, data: null });
  });

  it('PREVIEW (audit at ISA_CONDUCT): notice renders and the save choke is closed at its visible controls', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_CONDUCT' };

    render(<IsaReportWorkspace />);

    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalledWith('audit-1'));
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    // Response-window controls call save() on change — both must be disabled.
    expect(screen.getByLabelText('Response due days')).toBeDisabled();
    expect(screen.getByLabelText('Response due basis')).toBeDisabled();
  });

  it('AT STAGE: no preview notice', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_REPORT' };

    render(<IsaReportWorkspace />);

    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalled());
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
  });
});

// isa-review-export: Stage 6 carries the shared StageTransitionCard toward
// Review & export. The card's own states are pinned in
// StageTransitionCard.test.tsx; here: the mount, the target stage, and the
// one-ahead preview leaving it disabled.
describe('IsaReportWorkspace — Stage 6 → Review & export card (isa-review-export)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchDraft.mockResolvedValue({ ok: true, data: null });
  });

  it('AT STAGE: "Advance to Review & export" is enabled and advances to ISA_EXPORT', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_REPORT' };

    render(<IsaReportWorkspace />);

    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalled());
    const button = screen.getByRole('button', { name: 'Advance to Review & export' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_EXPORT');
  });

  it('PREVIEW (audit at ISA_CONDUCT): the card is ahead of the audit, button disabled', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'ISA_CONDUCT' };

    render(<IsaReportWorkspace />);

    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalled());
    expect(screen.getByText('Advance from Audit conduct first.')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Review & export' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });
});
