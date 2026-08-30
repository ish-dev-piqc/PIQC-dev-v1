// Unit tests for EvidenceDrawer — the audit-level source evidence register.
//
// Asserts the user-visible contract, not the API internals (those live in
// evidenceApi.test.ts):
//
//   - loading → empty state teaches the attach-as-it-arrives flow
//   - rows render title, provenance line, and status chip
//   - a list failure names the reason (never a silently-empty register)
//   - add flow: chip suggests type + title, Attach calls ingest, list reloads
//   - add failure keeps the form (and the auditor's paste) with the reason
//   - remove is two-click (arm → confirm) and reloads on success
//
// Mock surface: evidenceApi + useOverlay only. ThemeContext ships a default
// value, so no provider is needed.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';

vi.mock('../../../../hooks/useOverlay', () => ({
  useOverlay: vi.fn(),
}));

vi.mock('../../../../lib/audit/evidenceApi', () => ({
  listAuditEvidence: vi.fn(),
  ingestAuditEvidence: vi.fn(),
  removeAuditEvidence: vi.fn(),
  extractEvidenceFile: vi.fn(),
}));

import EvidenceDrawer from '../EvidenceDrawer';
import {
  extractEvidenceFile,
  ingestAuditEvidence,
  listAuditEvidence,
  removeAuditEvidence,
} from '../../../../lib/audit/evidenceApi';

const mockList = listAuditEvidence as unknown as ReturnType<typeof vi.fn>;
const mockIngest = ingestAuditEvidence as unknown as ReturnType<typeof vi.fn>;
const mockRemove = removeAuditEvidence as unknown as ReturnType<typeof vi.fn>;
const mockExtract = extractEvidenceFile as unknown as ReturnType<typeof vi.fn>;

const AUDIT = { id: 'a1', audit_name: 'Acme CRO Q3 vendor audit' } as unknown as ComponentProps<
  typeof EvidenceDrawer
>['audit'];

const ROW = {
  audit_id: 'a1',
  document_id: 'd1',
  added_by: 'u1',
  added_at: '2026-08-30T12:00:00Z',
  source_type: 'SOP',
  source_system: null,
  source_locator: 'SOP-QA-014 v3',
  include_in_generation: true,
  title: 'QA SOP v3',
  status: 'ready' as const,
};

describe('EvidenceDrawer', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockIngest.mockReset();
    mockRemove.mockReset();
    mockExtract.mockReset();
  });

  it('renders the teaching empty state when the register is empty', async () => {
    mockList.mockResolvedValue({ ok: true, data: [] });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    expect(await screen.findByText('No evidence yet')).toBeTruthy();
    expect(screen.getByText(/completed questionnaire/i)).toBeTruthy();
  });

  it('renders rows with title, provenance line, and status chip', async () => {
    mockList.mockResolvedValue({ ok: true, data: [ROW] });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    expect(await screen.findByText('QA SOP v3')).toBeTruthy();
    expect(screen.getByText(/SOP · SOP-QA-014 v3/)).toBeTruthy();
    expect(screen.getByText('ready')).toBeTruthy();
  });

  it('names the reason when the list fails — never a silently-empty register', async () => {
    mockList.mockResolvedValue({ ok: false, error: 'permission denied' });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    expect(await screen.findByText(/didn’t load: permission denied/)).toBeTruthy();
    expect(screen.queryByText('No evidence yet')).toBeNull();
  });

  it('add flow: chip suggests type + title, Attach ingests and reloads', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ ok: true, data: [] });
    mockIngest.mockResolvedValue({ ok: true, data: ROW });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    await screen.findByText('No evidence yet');

    await user.click(screen.getByRole('button', { name: /attach evidence/i }));
    await user.click(screen.getByRole('button', { name: 'Completed questionnaire' }));
    // Chip suggested both the source type and the title.
    expect(screen.getByLabelText('Source type')).toHaveProperty('value', 'Completed questionnaire');
    expect(screen.getByLabelText('Evidence title')).toHaveProperty('value', 'Completed questionnaire');

    await user.type(screen.getByLabelText('Document text'), 'Section A complete');
    await user.click(screen.getByRole('button', { name: 'Attach' }));

    await waitFor(() =>
      expect(mockIngest).toHaveBeenCalledWith({
        auditId: 'a1',
        title: 'Completed questionnaire',
        sourceType: 'Completed questionnaire',
        sourceLocator: undefined,
        content: 'Section A complete',
      }),
    );
    // Reload after a successful attach: initial mount + post-attach.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('add failure keeps the form open and names the reason', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ ok: true, data: [] });
    mockIngest.mockResolvedValue({ ok: false, error: 'Not signed in — refresh and try again' });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    await screen.findByText('No evidence yet');

    await user.click(screen.getByRole('button', { name: /attach evidence/i }));
    await user.click(screen.getByRole('button', { name: 'SOP' }));
    await user.type(screen.getByLabelText('Document text'), 'body');
    await user.click(screen.getByRole('button', { name: 'Attach' }));

    expect(await screen.findByText(/Not signed in/)).toBeTruthy();
    // The paste is kept — the textarea is still mounted with its content.
    expect(screen.getByLabelText('Document text')).toHaveProperty('value', 'body');
    expect(mockList).toHaveBeenCalledTimes(1);
  });

  it('remove is two-click: arm, then confirm calls the RPC and reloads', async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({ ok: true, data: [ROW] });
    mockRemove.mockResolvedValue({ ok: true, data: null });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    await screen.findByText('QA SOP v3');

    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mockRemove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirm remove' }));
    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith('a1', 'd1'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });
});

describe('EvidenceDrawer file intake (PR-B2)', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockIngest.mockReset();
    mockExtract.mockReset();
    mockList.mockResolvedValue({ ok: true, data: [] });
  });

  it('extraction fills the textarea, suggests a title, and surfaces warnings', async () => {
    const user = userEvent.setup();
    mockExtract.mockResolvedValue({
      ok: true,
      data: { text: '[x] Section A complete', warnings: ['1 empty sheet(s) skipped'] },
    });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    await screen.findByText('No evidence yet');
    await user.click(screen.getByRole('button', { name: /attach evidence/i }));

    const file = new File(['bytes'], 'Vendor questionnaire.docx');
    await user.upload(screen.getByLabelText('Evidence file'), file);

    await waitFor(() =>
      expect(screen.getByLabelText('Document text')).toHaveProperty('value', '[x] Section A complete'),
    );
    expect(mockExtract).toHaveBeenCalledWith(file);
    expect(screen.getByLabelText('Evidence title')).toHaveProperty('value', 'Vendor questionnaire');
    expect(screen.getByText('1 empty sheet(s) skipped')).toBeTruthy();
  });

  it('extraction failure shows the remediation and leaves the paste path intact', async () => {
    const user = userEvent.setup();
    mockExtract.mockResolvedValue({
      ok: false,
      error: 'Couldn’t read this Word file — paste the text instead',
    });
    render(<EvidenceDrawer audit={AUDIT} onClose={vi.fn()} />);
    await screen.findByText('No evidence yet');
    await user.click(screen.getByRole('button', { name: /attach evidence/i }));

    await user.upload(screen.getByLabelText('Evidence file'), new File(['x'], 'bad.docx'));

    expect(await screen.findByText(/paste the text instead/)).toBeTruthy();
    // The paste path is untouched — typing into the textarea still works.
    await user.type(screen.getByLabelText('Document text'), 'pasted manually');
    expect(screen.getByLabelText('Document text')).toHaveProperty('value', 'pasted manually');
  });
});
