// IsaExportWorkspace — ISA Stage 7, the sign-off latch and the recorded
// export. Pins:
//   - not applied (the verify RPC missing) → honest copy, no actions
//   - no verdict → row 1 unticked with the pointer, sign-off + exports off
//   - verdict set, not signed off → sign-off flow: confirm step, the
//     updated_at pin, then the banner and the exports enabled
//   - STALE_CONTENT on sign-off → the reload notice, no second seal
//   - signed off but diverged → "changed since sign-off", exports off,
//     "Sign off again"
//   - export = verify → fresh read → mark → generate, in that order, with the
//     artefact named and no "_draft" in the file name
//   - verify says not ready at export time → blocked copy, mark never called
//   - the one-ahead preview: notice, every action disabled
// Mock idiom: IsaScopeBuilderWorkspace.test.tsx (context hooks with mutable
// module-level state; every Api module mocked; delivery helpers mocked so
// no blob or clipboard work runs).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { IsaFindingObject, IsaReportDraftObject } from '../../../../../types/audit';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockCurrentStage = 'ISA_EXPORT';
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: {
      id: 'audit-isa-1',
      workflow_type: 'INVESTIGATOR_SITE_AUDIT',
      current_stage: mockCurrentStage,
      auditee_name: 'Site 042',
      site_number: '042',
      principal_investigator: 'Dr. Example',
      site_country: 'US',
      protocol_code: 'PROTO-001',
      protocol_title: 'Protocol one',
      audit_type: 'ONSITE',
      scheduled_date: null,
      scheduled_end_date: null,
    },
  }),
}));

vi.mock('../../../../../lib/audit/isaReportApi', () => ({
  fetchIsaReportDraft: vi.fn(),
  verifyIsaExportReadiness: vi.fn(),
  signOffIsaReport: vi.fn(),
  markIsaReportExported: vi.fn(),
}));
vi.mock('../../../../../lib/audit/isaNotesApi', () => ({
  fetchIsaNotes: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));
vi.mock('../../../../../lib/audit/isaFindingsApi', () => ({
  fetchIsaFindings: vi.fn(),
}));
vi.mock('../../../../../lib/audit/preAuditApi', () => ({
  resolveApprovedByName: vi.fn(() => Promise.resolve('Ada Auditor')),
}));
vi.mock('../../../../../lib/audit/isaReportDocx', () => ({
  buildIsaReportDocx: vi.fn(() => Promise.resolve(new Blob(['report']))),
  buildIsaObservationFormDocx: vi.fn(() => Promise.resolve(new Blob(['form']))),
}));
vi.mock('../investigator/isaReportDelivery', () => ({
  copyRich: vi.fn(() => Promise.resolve(true)),
  downloadBlob: vi.fn(),
}));
vi.mock('../../HistoryDrawer', () => ({ default: () => null }));

import IsaExportWorkspace from '../investigator/IsaExportWorkspace';
import {
  fetchIsaReportDraft,
  markIsaReportExported,
  signOffIsaReport,
  verifyIsaExportReadiness,
} from '../../../../../lib/audit/isaReportApi';
import { fetchIsaFindings } from '../../../../../lib/audit/isaFindingsApi';
import { buildIsaReportDocx } from '../../../../../lib/audit/isaReportDocx';
import { copyRich, downloadBlob } from '../investigator/isaReportDelivery';

const mockFetchDraft = vi.mocked(fetchIsaReportDraft);
const mockVerify = vi.mocked(verifyIsaExportReadiness);
const mockSignOff = vi.mocked(signOffIsaReport);
const mockMark = vi.mocked(markIsaReportExported);
const mockFetchFindings = vi.mocked(fetchIsaFindings);
const mockBuildDocx = vi.mocked(buildIsaReportDocx);
const mockDownload = vi.mocked(downloadBlob);
const mockCopy = vi.mocked(copyRich);

function draft(overrides: Partial<IsaReportDraftObject> = {}): IsaReportDraftObject {
  return {
    id: 'draft-1',
    audit_id: 'audit-isa-1',
    exec_summary: null,
    exec_summary_source: null,
    auditee_background: null,
    auditee_background_source: null,
    opening_meeting: null,
    opening_meeting_source: null,
    closing_meeting: null,
    closing_meeting_source: null,
    site_verdict: 'CONTINUE',
    site_verdict_text: null,
    response_due_days: 30,
    response_due_basis: 'CALENDAR',
    readiness_fingerprint: null,
    final_signed_off_by: null,
    final_signed_off_at: null,
    exported_at: null,
    created_by: 'user-1',
    created_at: '2026-09-05T09:00:00+00:00',
    updated_at: '2026-09-05T09:00:00+00:00',
    ...overrides,
  };
}

const FINDING: IsaFindingObject = {
  id: 'finding-1',
  audit_id: 'audit-isa-1',
  title: 'Consent version not current',
  isa_domain: 'INFORMED_CONSENT',
  subcategory: null,
  severity: 'MAJOR',
  severity_rule: null,
  observation: 'Two participants consented on a superseded ICF.',
  evidence: [],
  reference: null,
  protocol_refs: [],
  response_owner: 'SITE',
  origin: 'AUDITOR',
  created_by: 'user-1',
  created_at: '2026-09-05T08:00:00+00:00',
  updated_at: '2026-09-05T08:00:00+00:00',
};

const UNSIGNED = draft();
const SIGNED = draft({
  readiness_fingerprint: 'fp-1',
  final_signed_off_by: 'user-1',
  final_signed_off_at: '2026-09-05T10:00:00+00:00',
  updated_at: '2026-09-05T10:00:00+00:00',
});

const notSignedOff = {
  ok: true as const,
  data: { available: true as const, ready: false, reasons: ['GATE_ISA_REPORT_NOT_SIGNED_OFF' as const] },
};
const readyVerdict = {
  ok: true as const,
  data: { available: true as const, ready: true, reasons: [] },
};
const diverged = {
  ok: true as const,
  data: { available: true as const, ready: false, reasons: ['GATE_ISA_REPORT_DIVERGED' as const] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentStage = 'ISA_EXPORT';
  mockFetchFindings.mockResolvedValue({ ok: true, data: [FINDING] });
  mockFetchDraft.mockResolvedValue({ ok: true, data: UNSIGNED });
  mockVerify.mockResolvedValue(notSignedOff);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function signOffButton() {
  return screen.getByRole('button', { name: /Sign off report|Sign off again/ });
}
function reportDocxButton() {
  return screen.getByRole('button', { name: 'Download report .docx' });
}

describe('IsaExportWorkspace — load states', () => {
  it('says the stage is not available when the verify RPC is not applied — no actions', async () => {
    mockVerify.mockResolvedValue({ ok: true, data: { available: false } });
    render(<IsaExportWorkspace />);

    expect(screen.getByText('Stage 7 · Review & export')).toBeInTheDocument();
    expect(await screen.findByText('Review & export isn’t available in this environment yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign off/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });

  it('a read error banners with Retry, and Retry refetches', async () => {
    const user = userEvent.setup();
    mockFetchDraft.mockResolvedValueOnce({ ok: false, error: 'permission denied' });
    render(<IsaExportWorkspace />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the report: permission denied');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mockFetchDraft).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Before export')).toBeInTheDocument();
  });

  it('no verdict: row 1 points at Report drafting, sign-off and exports are off', async () => {
    mockFetchDraft.mockResolvedValue({ ok: true, data: null });
    mockVerify.mockResolvedValue({
      ok: true,
      data: { available: true, ready: false, reasons: ['GATE_ISA_VERDICT_NOT_SET', 'GATE_ISA_REPORT_NOT_SIGNED_OFF'] },
    });
    render(<IsaExportWorkspace />);

    expect(await screen.findByText('Set it on Report drafting — the one sentence PIQC never drafts.')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(signOffButton()).toBeDisabled();
    expect(reportDocxButton()).toBeDisabled();
    expect(screen.getByText('Set the site continuation verdict on Report drafting before exporting.')).toBeInTheDocument();
  });

  it('verdict set, not signed off: the summary shows what leaves, sign-off is on, exports are off', async () => {
    render(<IsaExportWorkspace />);

    expect(await screen.findByText('Sign off the report')).toBeInTheDocument();
    expect(screen.getByText(/None of the noted observations should prevent continued use/)).toBeInTheDocument();
    expect(screen.getByText('1 · 0 critical · 1 major · 0 minor · 0 recommendations')).toBeInTheDocument();
    expect(screen.getByText(/within 30 calendar days/)).toBeInTheDocument();
    expect(signOffButton()).toBeEnabled();
    expect(reportDocxButton()).toBeDisabled();
    expect(screen.getByText('Sign off the report before exporting.')).toBeInTheDocument();
  });
});

describe('IsaExportWorkspace — sign-off', () => {
  it('Sign off → Confirm sends the version pin, then shows the banner and enables export', async () => {
    const user = userEvent.setup();
    mockSignOff.mockResolvedValue({ ok: true, data: SIGNED });
    mockFetchDraft.mockResolvedValueOnce({ ok: true, data: UNSIGNED }).mockResolvedValue({ ok: true, data: SIGNED });
    mockVerify.mockResolvedValueOnce(notSignedOff).mockResolvedValue(readyVerdict);
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Sign off report' }));
    expect(mockSignOff).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm sign-off' }));

    await waitFor(() => expect(mockSignOff).toHaveBeenCalledTimes(1));
    expect(mockSignOff).toHaveBeenCalledWith('draft-1', '2026-09-05T09:00:00+00:00');
    expect(await screen.findByText('Report signed off', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/by Ada Auditor/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Sign off/ })).not.toBeInTheDocument();
    expect(reportDocxButton()).toBeEnabled();
  });

  it('Cancel leaves the sign-off unsent', async () => {
    const user = userEvent.setup();
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Sign off report' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockSignOff).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign off report' })).toBeEnabled();
  });

  it('a STALE_CONTENT rejection reloads server truth and says so — no second seal', async () => {
    const user = userEvent.setup();
    mockSignOff.mockResolvedValue({ ok: false, error: 'The report changed since you reviewed it', errorHint: 'STALE_CONTENT' });
    mockFetchDraft.mockResolvedValueOnce({ ok: true, data: UNSIGNED }).mockResolvedValue({ ok: true, data: SIGNED });
    mockVerify.mockResolvedValueOnce(notSignedOff).mockResolvedValue(readyVerdict);
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Sign off report' }));
    await user.click(screen.getByRole('button', { name: 'Confirm sign-off' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The report changed since you reviewed it — the latest version is shown. Review it and sign off again.',
    );
    expect(mockSignOff).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Report signed off', { selector: 'p' })).toBeInTheDocument();
  });

  it('signed off but diverged: "changed since sign-off", exports off, Sign off again', async () => {
    mockFetchDraft.mockResolvedValue({ ok: true, data: SIGNED });
    mockVerify.mockResolvedValue(diverged);
    render(<IsaExportWorkspace />);

    expect(await screen.findByText('Changed since sign-off — review the report and sign off again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign off again' })).toBeEnabled();
    expect(reportDocxButton()).toBeDisabled();
    expect(screen.getByText('The report changed since sign-off — review it and sign off again before exporting.')).toBeInTheDocument();
  });
});

describe('IsaExportWorkspace — export', () => {
  beforeEach(() => {
    mockFetchDraft.mockResolvedValue({ ok: true, data: SIGNED });
    mockVerify.mockResolvedValue(readyVerdict);
  });

  it('report .docx: verify, fresh read, mark with the artefact, then the download — no "_draft" name', async () => {
    const user = userEvent.setup();
    const EXPORTED = draft({ ...SIGNED, exported_at: '2026-09-05T11:00:00+00:00' });
    mockMark.mockResolvedValue({ ok: true, data: EXPORTED });
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Download report .docx' }));

    await waitFor(() => expect(mockMark).toHaveBeenCalledTimes(1));
    expect(mockMark).toHaveBeenCalledWith('draft-1', 'report_docx');
    expect(mockVerify).toHaveBeenCalledTimes(3); // mount, pre-export verify, fresh read
    expect(mockBuildDocx).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    const [, name] = mockDownload.mock.calls[0];
    expect(name).toMatch(/^PROTO-001_site_audit_report_\d{4}-\d{2}-\d{2}\.docx$/);
    expect(name).not.toMatch(/draft/);
    expect(await screen.findByText(/Last exported/)).toBeInTheDocument();
  });

  it('clipboard: marks the export, then copies', async () => {
    const user = userEvent.setup();
    mockMark.mockResolvedValue({ ok: true, data: draft({ ...SIGNED, exported_at: '2026-09-05T11:00:00+00:00' }) });
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Copy for Word / Docs' }));

    await waitFor(() => expect(mockCopy).toHaveBeenCalledTimes(1));
    expect(mockMark).toHaveBeenCalledWith('draft-1', 'clipboard');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('verify says not ready at export time → blocked copy, mark never called', async () => {
    const user = userEvent.setup();
    mockVerify.mockResolvedValueOnce(readyVerdict).mockResolvedValue(diverged);
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Download report .docx' }));

    expect(await screen.findByRole('status')).toHaveTextContent(
      'The report changed since sign-off — review it and sign off again before exporting.',
    );
    expect(mockMark).not.toHaveBeenCalled();
    expect(mockDownload).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign off again' })).toBeEnabled();
  });

  it('the server refuses the mark → the gate copy, nothing generated', async () => {
    const user = userEvent.setup();
    mockMark.mockResolvedValue({ ok: false, error: 'Cannot record export', errorHint: 'GATE_ISA_REPORT_DIVERGED' });
    render(<IsaExportWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Download report .docx' }));

    expect(await screen.findByRole('status')).toHaveTextContent(/changed since sign-off/);
    expect(mockDownload).not.toHaveBeenCalled();
  });
});

describe('IsaExportWorkspace — one-ahead preview', () => {
  it('at Report drafting: notice up, every action disabled', async () => {
    mockCurrentStage = 'ISA_REPORT';
    mockFetchDraft.mockResolvedValue({ ok: true, data: SIGNED });
    mockVerify.mockResolvedValue(readyVerdict);
    render(<IsaExportWorkspace />);

    expect(screen.getByText(/this is a preview/i)).toBeInTheDocument();
    expect(await screen.findByText('Before export')).toBeInTheDocument();
    expect(reportDocxButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Download observation form .docx' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy for Word / Docs' })).toBeDisabled();
  });

  it('at Report drafting with no sign-off: the sign-off button is disabled too', async () => {
    mockCurrentStage = 'ISA_REPORT';
    render(<IsaExportWorkspace />);

    expect(await screen.findByRole('button', { name: 'Sign off report' })).toBeDisabled();
  });
});
