// AuditCertificateSection (PR-D6) — the certificate's Stage-8 surface.
// Pins the honesty contracts the section owns:
//   - load failure renders the retry banner, never a scratch form
//     (absence ≠ failure)
//   - the code-owned frame renders: audit facts header + outcome/date
//     template lines (never stored, never model-written)
//   - Approve is blocked while the report basis is unknown (read failed) OR
//     the report is unapproved, and passes BOTH pins when it fires
//   - the legacy approved-without-fingerprint report is named out loud
//   - STALE_BASIS routes through the workbench reload flow with basis copy
//   - a failed save banners and keeps the editor open (PR-1 posture)
//   - post-approval divergence (sealed ≠ live report fingerprint) banners
//   - preview from ahead locks generate + edit; an unapproved report locks
//     generate with the sequence-gate title
// Mock idiom follows FindingsReportSection.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../lib/audit/auditCertificate', () => ({
  fetchAuditCertificate: vi.fn(),
  fetchReportBasis: vi.fn(),
  upsertAuditCertificate: vi.fn(),
  approveAuditCertificate: vi.fn(),
}));

vi.mock('../../../../../lib/audit/evidenceApi', () => ({
  listAuditEvidence: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
}));

vi.mock('../../../../../lib/audit/deliverableGenerationApi', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../../../lib/audit/deliverableGenerationApi')
  >()),
  applyDeliverableGeneration: vi.fn(),
  computeDeliverableCurrency: vi.fn(() => null),
  requestDeliverableDraft: vi.fn(),
}));

import AuditCertificateSection from '../AuditCertificateSection';
import {
  approveAuditCertificate,
  fetchAuditCertificate,
  fetchReportBasis,
  upsertAuditCertificate,
} from '../../../../../lib/audit/auditCertificate';
import type { AuditCertificate } from '../../../../../lib/audit/auditCertificate';
import type { AuditWithContext } from '../../../../../context/AuditContext';

const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const AUDIT: AuditWithContext = {
  id: 'audit-1',
  audit_name: 'Q3 ePRO vendor audit',
  audit_type: 'REMOTE',
  workflow_type: 'VENDOR_AUDIT',
  status: 'IN_PROGRESS',
  current_stage: 'FINAL_REVIEW_EXPORT',
  scheduled_date: '2026-09-15',
  scheduled_end_date: '2026-09-17',
  vendor_name: 'Acme ePRO GmbH',
  auditee_name: 'Acme ePRO GmbH',
  site_number: null,
  principal_investigator: null,
  site_country: null,
  protocol_code: 'BRT-2',
  protocol_title: 'BRIGHTEN-2',
  clinical_trial_phase: 'PHASE_2',
  protocol_id: 'p1',
  protocol_version_id: 'pv1',
};

const CERT: AuditCertificate = {
  id: 'cert1',
  audit_id: 'audit-1',
  content: { body_text: 'Certificate narrative body.', scope: ['Data integrity', 'CAPA'] },
  approval_status: 'DRAFT',
  approved_at: null,
  approved_by_name: null,
  updated_at: '2026-09-07T10:00:00+00:00',
  basis_digest: null,
  generation_refs: null,
  grounding_snapshot: null,
  generated_at: null,
};

const APPROVED_BASIS = {
  approved: true,
  approvedAt: '2026-09-06T09:00:00+00:00',
  digest: 'fp-live',
};

function renderSection(overrides: Partial<{ hasReached: boolean }> = {}) {
  return render(
    <AuditCertificateSection
      audit={AUDIT}
      hasReached={overrides.hasReached ?? true}
      isLight
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m(fetchAuditCertificate).mockResolvedValue({ certificate: CERT, failed: false });
  m(fetchReportBasis).mockResolvedValue(APPROVED_BASIS);
});

describe('load + code-owned frame', () => {
  it('renders the narrative, scope, facts header, and the code-owned template lines', async () => {
    renderSection();
    expect(await screen.findByText('Certificate narrative body.')).toBeTruthy();
    expect(screen.getByText('Data integrity')).toBeTruthy();
    // Facts header derives from the audit record — never stored content.
    const facts = screen.getByTestId('audit-certificate-facts');
    expect(facts.textContent).toContain('Acme ePRO GmbH');
    // Human label, never the raw enum — this block is document text.
    expect(facts.textContent).toContain('Audit type: Remote');
    expect(facts.textContent).not.toContain('REMOTE');
    expect(facts.textContent).toContain('Sep 15 – 17, 2026');
    expect(facts.textContent).toContain('BRT-2');
    // Code-owned template lines — the outcome and date are QA's, not PIQC's.
    const template = screen.getByTestId('audit-certificate-template-lines');
    expect(template.textContent).toContain('[Outcome: to be determined by QA]');
    expect(template.textContent).toContain('Certificate date:');
  });

  it('a failed row read renders the retry banner, never a scratch form, and Retry refetches', async () => {
    m(fetchAuditCertificate).mockResolvedValue({ certificate: null, failed: true });
    renderSection();
    expect(await screen.findByTestId('audit-certificate-load-error')).toBeTruthy();
    expect(screen.queryByTestId('audit-certificate-edit-button')).toBeNull();
    m(fetchAuditCertificate).mockResolvedValue({ certificate: CERT, failed: false });
    fireEvent.click(screen.getByText('Retry'));
    expect(await screen.findByText('Certificate narrative body.')).toBeTruthy();
  });
});

describe('approve — the report-version pin', () => {
  it('is blocked while the report basis is unknown (read failed), with the banner — and the CTA says unknown, not unapproved', async () => {
    m(fetchReportBasis).mockResolvedValue(null);
    renderSection();
    expect(await screen.findByTestId('audit-certificate-basis-unknown')).toBeTruthy();
    const btn = (await screen.findByTestId(
      'audit-certificate-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('Couldn’t verify the report’s approval');
    // The generate CTA must not assert "not approved" about a state it
    // could not read.
    const generate = screen.getByTestId('audit_certificate-generate-button') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.title).toContain('couldn’t be read');
  });

  it('is blocked while the report is unapproved, and the generate CTA carries the sequence-gate title', async () => {
    m(fetchReportBasis).mockResolvedValue({ approved: false, approvedAt: null, digest: null });
    renderSection();
    const btn = (await screen.findByTestId(
      'audit-certificate-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('The audit report must be approved');
    const generate = screen.getByTestId('audit_certificate-generate-button') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.title).toBe('Available once the audit report is approved');
  });

  it('names the legacy approved-without-fingerprint report out loud and stays blocked — never claiming the report is unapproved', async () => {
    m(fetchReportBasis).mockResolvedValue({
      approved: true,
      approvedAt: '2026-01-01T00:00:00+00:00',
      digest: null,
    });
    renderSection();
    expect(await screen.findByTestId('audit-certificate-legacy-report')).toBeTruthy();
    const approve = screen.getByTestId('audit-certificate-approve-button') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    // The report IS approved here — the tooltip must name the version-pin
    // gap and its fix, not send the auditor to approve an approved report.
    expect(approve.title).toContain('re-approve it in Stage 7');
    expect(approve.title).not.toContain('must be approved');
    const generate = screen.getByTestId('audit_certificate-generate-button') as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(generate.title).toContain('re-approved in Stage 7');
  });

  it('passes BOTH pins — the certificate version and the held report fingerprint', async () => {
    m(approveAuditCertificate).mockResolvedValue({
      ok: true,
      data: { ...CERT, approval_status: 'APPROVED', basis_digest: 'fp-live' },
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('audit-certificate-approve-button'));
    await waitFor(() =>
      expect(m(approveAuditCertificate)).toHaveBeenCalledWith(
        'cert1',
        CERT.updated_at,
        'fp-live',
      ),
    );
    expect(await screen.findByText('Approved')).toBeTruthy();
  });

  it('STALE_BASIS reloads server truth and shows the basis-specific notice', async () => {
    m(approveAuditCertificate).mockResolvedValue({
      ok: false,
      error: 'The approved report this certificate certifies changed or is no longer approved',
      errorHint: 'STALE_BASIS',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('audit-certificate-approve-button'));
    const notice = await screen.findByTestId('audit-certificate-stale-notice');
    expect(notice.textContent).toContain('What this deliverable is built from changed');
    // The reload refetched server truth (initial load + reload).
    expect(m(fetchAuditCertificate).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(m(fetchReportBasis).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('save honesty (PR-1 posture)', () => {
  it('a failed save banners, preserves the editor, and blocks approve', async () => {
    m(upsertAuditCertificate).mockResolvedValue(null);
    renderSection();
    fireEvent.click(await screen.findByTestId('audit-certificate-edit-button'));
    fireEvent.change(screen.getByTestId('audit-certificate-body-input'), {
      target: { value: 'Rewritten body the save must not lose.' },
    });
    fireEvent.click(screen.getByTestId('audit-certificate-save-button'));
    expect(await screen.findByTestId('audit-certificate-save-error')).toBeTruthy();
    // Editor re-opened over the preserved content.
    const input = screen.getByTestId('audit-certificate-body-input') as HTMLTextAreaElement;
    expect(input.value).toBe('Rewritten body the save must not lose.');
    // Approve blocked while the save error stands.
    expect(
      (screen.getByTestId('audit-certificate-approve-button') as HTMLButtonElement).disabled,
    ).toBe(true);
    // Dismissing clears the error + draft together and returns to view mode.
    fireEvent.click(screen.getByLabelText('Discard the unsaved changes'));
    const btn = (await screen.findByTestId(
      'audit-certificate-approve-button',
    )) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('a successful save routes the trimmed body and line-split scope through the upsert', async () => {
    m(upsertAuditCertificate).mockResolvedValue({
      ...CERT,
      content: { body_text: 'New body.', scope: ['Area one', 'Area two'] },
      updated_at: '2026-09-07T11:00:00+00:00',
    });
    renderSection();
    fireEvent.click(await screen.findByTestId('audit-certificate-edit-button'));
    fireEvent.change(screen.getByTestId('audit-certificate-body-input'), {
      target: { value: '  New body.  ' },
    });
    fireEvent.change(screen.getByTestId('audit-certificate-scope-input'), {
      target: { value: 'Area one\n  Area two  \n\n' },
    });
    fireEvent.click(screen.getByTestId('audit-certificate-save-button'));
    await waitFor(() =>
      expect(m(upsertAuditCertificate)).toHaveBeenCalledWith('audit-1', {
        body_text: 'New body.',
        scope: ['Area one', 'Area two'],
      }),
    );
    expect(await screen.findByText('New body.')).toBeTruthy();
  });
});

describe('divergence + preview lock', () => {
  it('an un-diverged approved certificate shows the legible pinned-version line', async () => {
    m(fetchAuditCertificate).mockResolvedValue({
      certificate: { ...CERT, approval_status: 'APPROVED', basis_digest: 'fp-live' },
      failed: false,
    });
    renderSection();
    const pinned = await screen.findByTestId('audit-certificate-pinned-line');
    // Equal digests prove the live report's approved_at IS the pinned
    // version's, so the date is honest.
    expect(pinned.textContent).toContain('Pinned to the report approved');
    expect(screen.queryByTestId('audit-certificate-diverged')).toBeNull();
  });

  it('sealed digest ≠ live report fingerprint on an approved certificate banners divergence and hides the pinned line', async () => {
    m(fetchAuditCertificate).mockResolvedValue({
      certificate: { ...CERT, approval_status: 'APPROVED', basis_digest: 'fp-sealed' },
      failed: false,
    });
    renderSection();
    expect(await screen.findByTestId('audit-certificate-diverged')).toBeTruthy();
    expect(screen.queryByTestId('audit-certificate-pinned-line')).toBeNull();
  });

  it('an approved certificate whose report approval was voided also banners divergence', async () => {
    m(fetchAuditCertificate).mockResolvedValue({
      certificate: { ...CERT, approval_status: 'APPROVED', basis_digest: 'fp-sealed' },
      failed: false,
    });
    m(fetchReportBasis).mockResolvedValue({ approved: false, approvedAt: null, digest: null });
    renderSection();
    expect(await screen.findByTestId('audit-certificate-diverged')).toBeTruthy();
  });

  it('no divergence claim while the report basis is unknown — unknown is not diverged', async () => {
    m(fetchReportBasis).mockResolvedValue(null);
    m(fetchAuditCertificate).mockResolvedValue({
      certificate: { ...CERT, approval_status: 'APPROVED', basis_digest: 'fp-sealed' },
      failed: false,
    });
    renderSection();
    await screen.findByText('Certificate narrative body.');
    expect(screen.queryByTestId('audit-certificate-diverged')).toBeNull();
  });

  it('previewing from ahead locks generation and editing', async () => {
    renderSection({ hasReached: false });
    const generate = (await screen.findByTestId(
      'audit_certificate-generate-button',
    )) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(
      (screen.getByTestId('audit-certificate-edit-button') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
