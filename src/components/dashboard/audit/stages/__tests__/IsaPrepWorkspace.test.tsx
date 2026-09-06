// IsaPrepWorkspace — ISA Stage 4, the document request. Pins:
//   - the load states: loading, not applied (either table), read error +
//     Retry, no scope → the pointer to Scope builder, no Build
//   - Build → the generic upsert receives the deterministic content and the
//     groups render with the sampling approach prefilled; export off until
//     approval
//   - edits land in a working copy: Unsaved row, Approve and Rebuild blocked,
//     Save sends the edited content with one reason, a failed save keeps the
//     edits and Discard restores
//   - add / remove an auditor line
//   - Approve → the updated_at pin, then the approved line and the exports;
//     a STALE_CONTENT approve reloads server truth and says so
//   - export from the SAVED row: the packet, the file name, the clipboard
//     flavors (included lines only)
//   - drift by scope modules → notice + Rebuild that keeps notes and added
//     lines; the demote warning when approved
//   - the one-ahead preview: notice, request read-only, inputs disabled, no
//     actions
//   - the Stage 4 → Audit conduct card
// Mock idiom: IsaScopeBuilderWorkspace.test.tsx + IsaExportWorkspace.test.tsx
// (context hooks with mutable module-level state; every Api module mocked;
// the docx builder and the delivery helpers mocked so no blob or clipboard
// work runs; the persistence and resync hooks are real).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { SiteScope } from '../../../../../lib/audit/siteScopeApi';
import type { DocumentRequest } from '../../../../../lib/audit/documentRequestApi';
import { buildDocumentRequestContent, newAuditorItem } from '../../../../../lib/audit/documentRequest';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockAdvanceStage = vi.fn();
let mockCurrentStage = 'ISA_PREP';
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
      scheduled_date: '2026-09-15',
      scheduled_end_date: '2026-09-17',
    },
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

vi.mock('../../../../../context/AuthContext', () => ({
  useAuth: () => ({ profile: { name: 'Ada Auditor' } }),
}));

vi.mock('../../../../../lib/audit/siteScopeApi', () => ({
  fetchSiteScope: vi.fn(),
}));
vi.mock('../../../../../lib/audit/documentRequestApi', () => ({
  fetchDocumentRequest: vi.fn(),
  upsertDocumentRequest: vi.fn(),
  approveDocumentRequest: vi.fn(),
}));
vi.mock('../../../../../lib/audit/documentRequestDocx', () => ({
  buildDocumentRequestDocx: vi.fn(() => Promise.resolve(new Blob(['letter']))),
}));
vi.mock('../investigator/isaReportDelivery', () => ({
  copyRich: vi.fn(() => Promise.resolve(true)),
  downloadBlob: vi.fn(),
}));
vi.mock('../../HistoryDrawer', () => ({ default: () => null }));

import IsaPrepWorkspace from '../investigator/IsaPrepWorkspace';
import { fetchSiteScope } from '../../../../../lib/audit/siteScopeApi';
import {
  approveDocumentRequest,
  fetchDocumentRequest,
  upsertDocumentRequest,
} from '../../../../../lib/audit/documentRequestApi';
import { buildDocumentRequestDocx } from '../../../../../lib/audit/documentRequestDocx';
import { copyRich, downloadBlob } from '../investigator/isaReportDelivery';

const mockFetchScope = vi.mocked(fetchSiteScope);
const mockFetchRequest = vi.mocked(fetchDocumentRequest);
const mockUpsert = vi.mocked(upsertDocumentRequest);
const mockApprove = vi.mocked(approveDocumentRequest);
const mockBuildDocx = vi.mocked(buildDocumentRequestDocx);
const mockDownload = vi.mocked(downloadBlob);
const mockCopy = vi.mocked(copyRich);

const BUILT_AT = '2026-09-05T10:00:00.000Z';
const SCOPE: SiteScope = {
  id: 'scope-1',
  audit_id: 'audit-isa-1',
  content: {
    built_from: { mapping_ids: ['smm-1', 'smm-2'], built_at: BUILT_AT },
    modules: [
      { isa_domain: 'INFORMED_CONSENT', criticality: 'CRITICAL', items: [] },
      { isa_domain: 'SOURCE_DATA_VERIFICATION', criticality: 'HIGH', items: [] },
    ],
  },
  approval_status: 'APPROVED',
  approved_at: '2026-09-05T10:30:00+00:00',
  approved_by_name: 'Ada Auditor',
  updated_at: '2026-09-05T10:30:00+00:00',
};
const SCOPE_CONSENT_ONLY: SiteScope = {
  ...SCOPE,
  content: { ...SCOPE.content, modules: SCOPE.content.modules.slice(0, 1) },
};
const REQUEST: DocumentRequest = {
  id: 'request-1',
  audit_id: 'audit-isa-1',
  content: buildDocumentRequestContent(SCOPE, BUILT_AT),
  approval_status: 'DRAFT',
  approved_at: null,
  approved_by_name: null,
  updated_at: '2026-09-05T10:00:00+00:00',
};
const APPROVED: DocumentRequest = {
  ...REQUEST,
  approval_status: 'APPROVED',
  approved_at: '2026-09-05T11:00:00+00:00',
  approved_by_name: 'Ada Auditor',
  updated_at: '2026-09-05T11:00:00+00:00',
};

const ISF_TITLE = 'Investigator site file (regulatory binder) with its current index';
const DELEGATION_TITLE = 'Delegation of authority log, all versions, with start and end dates';
const MONITORING_TITLE = 'Monitoring visit log and monitoring follow-up letters';

let upsertSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentStage = 'ISA_PREP';
  upsertSeq = 0;
  mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: SCOPE });
  mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: null });
  // The server echoes the content it was given under a new row version.
  mockUpsert.mockImplementation(async (_auditId, content) => ({
    ...REQUEST,
    content,
    updated_at: `2026-09-05T10:00:${String(++upsertSeq).padStart(2, '0')}+00:00`,
  }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function includeBox(title: string) {
  return screen.getByRole('checkbox', { name: `Include ${title}` });
}
function docxButton() {
  return screen.getByRole('button', { name: 'Download request letter .docx' });
}

describe('IsaPrepWorkspace — load states', () => {
  it('loads, then says the stage is not available when the scope table is missing', async () => {
    mockFetchScope.mockResolvedValue({ kind: 'unavailable' });
    render(<IsaPrepWorkspace />);

    expect(screen.getByText('Stage 4 · Audit prep')).toBeInTheDocument();
    expect(screen.getByText('Request documents and set the sampling approach')).toBeInTheDocument();
    expect(screen.getByText('Loading the document request…')).toBeInTheDocument();

    expect(await screen.findByText('Audit prep isn’t available in this environment yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Build request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
  });

  it('says the same when the request table is missing', async () => {
    mockFetchRequest.mockResolvedValue({ kind: 'unavailable' });
    render(<IsaPrepWorkspace />);

    expect(await screen.findByText('Audit prep isn’t available in this environment yet.')).toBeInTheDocument();
  });

  it('a read error banners with Retry, and Retry refetches', async () => {
    const user = userEvent.setup();
    mockFetchScope.mockResolvedValueOnce({ kind: 'failed' });
    render(<IsaPrepWorkspace />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load the document request: the site audit scope could not be read');

    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No request built yet\. 2 modules in scope\./)).toBeInTheDocument();
    expect(mockFetchScope).toHaveBeenCalledTimes(2);
  });

  it('a failed request read is an error too — never an empty "build it" state over an unknown row', async () => {
    mockFetchRequest.mockResolvedValue({ kind: 'failed' });
    render(<IsaPrepWorkspace />);

    expect(await screen.findByRole('alert')).toHaveTextContent('the saved request could not be read');
    expect(screen.queryByRole('button', { name: /Build request/ })).not.toBeInTheDocument();
  });

  it('no scope and no request → points at Scope builder, no Build', async () => {
    mockFetchScope.mockResolvedValue({ kind: 'loaded', scope: null });
    render(<IsaPrepWorkspace />);

    expect(await screen.findByText('Build the site audit scope on Scope builder first.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Build request/ })).not.toBeInTheDocument();
  });
});

describe('IsaPrepWorkspace — build', () => {
  it('Build sends the deterministic content through the generic upsert and renders the groups', async () => {
    const user = userEvent.setup();
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Build request' }));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [auditId, content, reason] = mockUpsert.mock.calls[0];
    expect(auditId).toBe('audit-isa-1');
    expect(reason).toBe('Document request built from 2 scope modules');
    expect(content).toEqual(buildDocumentRequestContent(SCOPE, content.built_from.built_at));

    expect(await screen.findByText(/20 of 20 documents requested · 2 modules · built/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Baseline documents' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Informed consent' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Source data verification' })).toBeInTheDocument();
    expect(includeBox(ISF_TITLE)).toBeChecked();
    expect(screen.getByLabelText('Sampling approach')).toHaveValue(content.sampling_approach);
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeEnabled();
    expect(docxButton()).toBeDisabled();
    expect(screen.getByText('Approve the request to enable the letter.')).toBeInTheDocument();
    expect(screen.queryByText(/since this request was built/)).not.toBeInTheDocument();
  });

  it('a failed build banners honestly and reverts — no request shown, no Approve', async () => {
    const user = userEvent.setup();
    mockUpsert.mockResolvedValue(null);
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Build request' }));

    expect(
      await screen.findByText('Couldn’t save the request — nothing was recorded. Build again to retry.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/No request built yet\. 2 modules in scope\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Informed consent' })).not.toBeInTheDocument();
  });
});

describe('IsaPrepWorkspace — edit and save', () => {
  it('edits go to a working copy; Save sends them with one reason and clears the unsaved state', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('checkbox', { name: `Include ${ISF_TITLE}` }));
    await user.type(screen.getByLabelText(`Note for ${DELEGATION_TITLE}`), 'Since 2024');
    await user.clear(screen.getByLabelText('Sampling approach'));
    await user.type(screen.getByLabelText('Sampling approach'), 'All subjects with a deviation.');

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Rebuild request' })).toBeDisabled();
    expect(mockUpsert).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [, content, reason] = mockUpsert.mock.calls[0];
    expect(reason).toBe('Document request edited');
    expect(content.items.find((i) => i.key === 'baseline:isf_index')?.included).toBe(false);
    expect(content.items.find((i) => i.key === 'baseline:delegation_log')?.note).toBe('Since 2024');
    expect(content.sampling_approach).toBe('All subjects with a deviation.');
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeEnabled();
    expect(screen.getByText(/19 of 20 documents requested/)).toBeInTheDocument();
  });

  it('a failed save keeps the edits and says so; Discard restores the saved content', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    mockUpsert.mockResolvedValueOnce(null);
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('checkbox', { name: `Include ${ISF_TITLE}` }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText(
        'Couldn’t save the request — your changes are still here. Save again to retry, or discard them.',
      ),
    ).toBeInTheDocument();
    expect(includeBox(ISF_TITLE)).not.toBeChecked();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(includeBox(ISF_TITLE)).toBeChecked();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('an approved request says the save reverts approval', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: APPROVED });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('checkbox', { name: `Include ${MONITORING_TITLE}` }));

    expect(screen.getByRole('button', { name: 'Save changes — reverts approval to Draft' })).toBeInTheDocument();
    expect(docxButton()).toBeDisabled();
    expect(screen.getByText('Save your changes and approve the request first.')).toBeInTheDocument();
  });

  it('adds an auditor line under its module and removes it again', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    render(<IsaPrepWorkspace />);

    await user.type(await screen.findByLabelText('Document title'), 'IRB annual report');
    await user.selectOptions(screen.getByLabelText('Module'), 'IRB_EC');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    const group = screen.getByRole('heading', { name: 'IRB / EC' }).closest('div')?.parentElement as HTMLElement;
    expect(within(group).getByText('IRB annual report')).toBeInTheDocument();
    expect(within(group).getByText('Added')).toBeInTheDocument();
    expect(screen.getByLabelText('Document title')).toHaveValue('');

    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const savedItems = mockUpsert.mock.calls[0][1].items;
    const added = savedItems[savedItems.length - 1];
    expect(added).toMatchObject({ title: 'IRB annual report', basis: { kind: 'auditor', isa_domain: 'IRB_EC' } });
    expect(added?.key).toMatch(/^auditor:\d+/);

    await user.click(await screen.findByRole('button', { name: 'Remove IRB annual report' }));
    expect(screen.queryByText('IRB annual report')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'IRB / EC' })).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });
});

describe('IsaPrepWorkspace — approve and export', () => {
  it('Approve pins the version the reviewer saw, then shows the approved line and enables the letter', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    mockApprove.mockResolvedValue({ ok: true, data: APPROVED });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Approve request' }));

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('request-1', '2026-09-05T10:00:00+00:00'));
    expect(await screen.findByText(/Approved .* · Ada Auditor/)).toBeInTheDocument();
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    expect(docxButton()).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Copy for Word / Docs' })).toBeEnabled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('a STALE_CONTENT approve reloads server truth and says so', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    mockApprove.mockResolvedValue({ ok: false, error: 'changed', errorHint: 'STALE_CONTENT' });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Approve request' }));

    expect(
      await screen.findByText(/This deliverable changed since you reviewed it — the latest version is shown/),
    ).toBeInTheDocument();
    expect(mockFetchRequest).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeEnabled();
  });

  it('the .docx export builds the letter from the SAVED row and names the file without "draft"', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: APPROVED });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Download request letter .docx' }));

    await waitFor(() => expect(mockBuildDocx).toHaveBeenCalledTimes(1));
    const packet = mockBuildDocx.mock.calls[0][0];
    expect(packet.content).toEqual(APPROVED.content);
    expect(packet.approvedByName).toBe('Ada Auditor');
    expect(packet.approvedAt).toBe('2026-09-05T11:00:00+00:00');
    expect(packet.signatoryName).toBe('Ada Auditor');
    expect(packet.meta).toMatchObject({
      auditeeName: 'Site 042',
      siteNumber: '042',
      protocolCode: 'PROTO-001',
      auditTypeLabel: 'Onsite',
      auditDate: 'Sep 15 – 17, 2026',
    });
    await waitFor(() => expect(mockDownload).toHaveBeenCalledTimes(1));
    const [, name] = mockDownload.mock.calls[0];
    expect(name).toMatch(/^PROTO-001_document_request_\d{4}-\d{2}-\d{2}\.docx$/);
    expect(name).not.toMatch(/draft/);
  });

  it('the clipboard export copies included lines only, then flashes Copied', async () => {
    const user = userEvent.setup();
    const excluded: DocumentRequest = {
      ...APPROVED,
      content: {
        ...APPROVED.content,
        items: APPROVED.content.items.map((i) =>
          i.key === 'baseline:monitoring_visit_log' ? { ...i, included: false } : i,
        ),
      },
    };
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: excluded });
    render(<IsaPrepWorkspace />);

    await user.click(await screen.findByRole('button', { name: 'Copy for Word / Docs' }));

    await waitFor(() => expect(mockCopy).toHaveBeenCalledTimes(1));
    const [html, plain] = mockCopy.mock.calls[0];
    expect(html).toContain(ISF_TITLE);
    expect(html).not.toContain(MONITORING_TITLE);
    expect(html).toContain('Ada Auditor');
    expect(plain).toContain('DOCUMENTS REQUESTED');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
});

describe('IsaPrepWorkspace — drift', () => {
  const stale: DocumentRequest = (() => {
    const content = buildDocumentRequestContent(SCOPE_CONSENT_ONLY, BUILT_AT);
    content.items = content.items.map((i) => (i.key === 'baseline:isf_index' ? { ...i, note: 'Bring the index' } : i));
    content.items.push(newAuditorItem(content.items, 'Site organisation chart', null, 1));
    return { ...REQUEST, content };
  })();

  it('modules changed since the build → drift notice, export off, Rebuild keeps notes and added lines', async () => {
    const user = userEvent.setup();
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: stale });
    render(<IsaPrepWorkspace />);

    const notice = await screen.findByText(
      /1 module added, 0 removed and 0 changed criticality on Scope builder since this request was built/,
    );
    expect(notice.closest('p')).toHaveTextContent(/Rebuild to bring the request up to date\.$/);
    expect(screen.queryByRole('heading', { name: 'Source data verification' })).not.toBeInTheDocument();
    // A stale request cannot be approved — rebuild first.
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    expect(docxButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Rebuild request' }));

    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [, content, reason] = mockUpsert.mock.calls[0];
    expect(reason).toBe('Document request rebuilt from 2 scope modules');
    expect(content.built_from.scope_modules).toEqual(SCOPE.content.modules.map(({ isa_domain, criticality }) => ({ isa_domain, criticality })));
    expect(content.items.some((i) => i.key === 'SOURCE_DATA_VERIFICATION:source_records_selected')).toBe(true);
    expect(content.items.find((i) => i.key === 'baseline:isf_index')?.note).toBe('Bring the index');
    expect(content.items[content.items.length - 1]).toMatchObject({ title: 'Site organisation chart' });

    expect(await screen.findByRole('heading', { name: 'Source data verification' })).toBeInTheDocument();
    expect(screen.queryByText(/since this request was built/)).not.toBeInTheDocument();
  });

  it('an approved request with drift says the rebuild reverts approval, and the letter is off', async () => {
    mockFetchRequest.mockResolvedValue({
      kind: 'loaded',
      request: { ...stale, approval_status: 'APPROVED', approved_at: '2026-09-05T11:00:00+00:00', approved_by_name: 'Ada Auditor' },
    });
    render(<IsaPrepWorkspace />);

    expect((await screen.findByText(/1 module added, 0 removed/)).closest('p')).toHaveTextContent(
      'rebuilding reverts approval to Draft',
    );
    expect(screen.getByRole('button', { name: 'Rebuild request' })).toBeEnabled();
    expect(docxButton()).toBeDisabled();
    expect(
      screen.getByText('The scope changed since this request was built — rebuild and approve again.'),
    ).toBeInTheDocument();
  });
});

describe('IsaPrepWorkspace — one-ahead preview', () => {
  it('at Scope builder: notice up, the request read-only, inputs disabled, no actions', async () => {
    mockCurrentStage = 'ISA_SCOPE_BUILDER';
    mockFetchRequest.mockResolvedValue({ kind: 'loaded', request: REQUEST });
    render(<IsaPrepWorkspace />);

    // Two elements name the audit's real stage here: the preview notice and
    // the Stage 4 → Audit conduct card's ahead line. A bare /advance from
    // Scope builder/ matches both, so each is matched on its own copy.
    expect(
      screen.getByText(/this is a preview\. Actions here are disabled until you advance from Scope builder\./i),
    ).toBeInTheDocument();
    expect(screen.getByText('Advance from Scope builder first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance to Audit conduct' })).toBeDisabled();

    expect(await screen.findByRole('heading', { name: 'Informed consent' })).toBeInTheDocument();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toBeDisabled();
    expect(screen.getByLabelText('Sampling approach')).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Build request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rebuild request/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Download/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Copy for Word/ })).not.toBeInTheDocument();
  });

  it('at Scope builder with no request: the ready line shows without a Build button', async () => {
    mockCurrentStage = 'ISA_SCOPE_BUILDER';
    render(<IsaPrepWorkspace />);

    expect(await screen.findByText(/No request built yet\. 2 modules in scope\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Build request' })).not.toBeInTheDocument();
  });
});

// The Stage 4 → Audit conduct card: the mount, the target stage, and that the
// transition does not depend on the request (no content gate server-side —
// "prep deliverables approved" is ledgered).
describe('IsaPrepWorkspace — Stage 4 → Audit conduct card', () => {
  it('at the stage: "Advance to Audit conduct" is enabled and advances to ISA_CONDUCT', async () => {
    const user = userEvent.setup();
    render(<IsaPrepWorkspace />);

    expect(await screen.findByRole('button', { name: 'Build request' })).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Advance to Audit conduct' });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledTimes(1);
    expect(mockAdvanceStage).toHaveBeenCalledWith('ISA_CONDUCT');
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('is offered even when the stage is not available — the transition has no content gate', async () => {
    mockFetchScope.mockResolvedValue({ kind: 'unavailable' });
    render(<IsaPrepWorkspace />);

    expect(await screen.findByText('Audit prep isn’t available in this environment yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Advance to Audit conduct' })).toBeEnabled();
  });
});
