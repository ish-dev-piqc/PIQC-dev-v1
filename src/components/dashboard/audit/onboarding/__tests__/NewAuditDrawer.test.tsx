// Unit tests for NewAuditDrawer — orphan-document retry invariant (PR #61).
//
// The bug: in the F-1 onramp (PR #59), the audit-creation flow runs three
// async steps in series:
//   1. uploadProtocolPdf      → POST to /functions/v1/ingest
//   2. createProtocolFromDocument  → RPC, promotes the parsed document
//   3. createAudit            → RPC, creates the audit row
//
// If step 1 succeeds and step 2 or 3 fails, the user's "Create audit"
// click leaves a documents row in the database. Without protection, the
// auditor hitting "Create audit" again would re-upload the PDF, creating
// an orphan document and burning Reducto credits.
//
// PR #61 added `uploadedDocumentId` state that caches the document id
// from a successful step 1. On retry:
//   - If the cache is set, step 1 is SKIPPED entirely (no re-upload).
//   - If the auditor picks a NEW file, the cache is cleared (a new file
//     genuinely needs a fresh upload).
//
// This test file locks the contract: uploadProtocolPdf must be called
// at most once per (audit-creation-session, file) tuple.
//
// SURFACE DECISIONS (sets the precedent for full-component tests in
// Audit Mode):
//   - Mock the context modules (ThemeContext, AuditContext) via vi.mock
//     rather than wrapping in real providers. The drawer barely depends
//     on either — useTheme returns a string, useAudit returns one
//     function. Wrapping in real providers would force mocking the
//     supabase auth subscription chain; the cost-benefit doesn't justify
//     it for the surface under test.
//   - Mock useOverlay as a no-op. It's pure DOM side-effects (ESC,
//     focus trap, scroll lock) and not in scope.
//   - Mock auditCreationApi at the import boundary to control the upload
//     / promote / create-audit responses and rejection sequences.
//   - File picking via fireEvent.change with a synthetic File object —
//     happy-dom doesn't emulate native file pickers, but the DOM event
//     surface works.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ----------------------------------------------------------------------------
// Mocks — set up BEFORE importing the component under test so the imports
// it pulls in resolve to the mocked modules.
// ----------------------------------------------------------------------------

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

const mockRefreshAudits = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ refresh: mockRefreshAudits }),
}));

vi.mock('../../../../../hooks/useOverlay', () => ({
  useOverlay: () => {},
}));

vi.mock('../../../../../lib/audit/auditCreationApi', () => ({
  listVendors: vi.fn(),
  createVendor: vi.fn(),
  listSites: vi.fn(),
  createSite: vi.fn(),
  listAuditorProtocolLibrary: vi.fn(),
  uploadProtocolPdf: vi.fn(),
  createProtocolFromDocument: vi.fn(),
  createAudit: vi.fn(),
}));

// Import the component AFTER the mocks are registered.
import NewAuditDrawer from '../NewAuditDrawer';
import {
  listVendors,
  listSites,
  listAuditorProtocolLibrary,
  uploadProtocolPdf,
  createProtocolFromDocument,
  createAudit,
} from '../../../../../lib/audit/auditCreationApi';

const mockListVendors = listVendors as ReturnType<typeof vi.fn>;
const mockListSites = listSites as ReturnType<typeof vi.fn>;
const mockListLibrary = listAuditorProtocolLibrary as ReturnType<typeof vi.fn>;
const mockUploadPdf = uploadProtocolPdf as ReturnType<typeof vi.fn>;
const mockCreateProtocol = createProtocolFromDocument as ReturnType<typeof vi.fn>;
const mockCreateAudit = createAudit as ReturnType<typeof vi.fn>;

// ----------------------------------------------------------------------------
// Test fixtures
// ----------------------------------------------------------------------------

const VENDORS = [
  { id: 'vendor-1', name: 'Vendor One', country: 'USA', website: null, created_at: '2026-05-15T00:00:00Z' },
];

function makePdfFile(name = 'protocol.pdf'): File {
  return new File(['%PDF-1.4 fake'], name, { type: 'application/pdf' });
}

async function fillRequiredFieldsForUploadFlow(user: ReturnType<typeof userEvent.setup>) {
  // Audit name
  await user.type(
    screen.getByPlaceholderText(/Q2 2026 ePRO platform audit/i),
    'Test audit',
  );

  // Bootstrap wait — findByRole retries until the seeded vendor option
  // renders, which means listVendors resolved AND setVendors ran AND the
  // select re-rendered. Caller does not need a separate waitFor.
  await screen.findByRole('option', { name: /Vendor One/i });

  // Vendor — the <Field>'s <label> isn't associated to the <select> via
  // htmlFor, so getByRole({ name }) won't find it by accessible name.
  // Find by the placeholder-option text instead ("Pick the vendor…"),
  // then walk up to the parent select.
  const vendorPlaceholderOption = screen.getByText(/Pick the vendor you're auditing/i);
  const vendorSelect = vendorPlaceholderOption.closest('select');
  if (!vendorSelect) throw new Error('Vendor select not found');
  await user.selectOptions(vendorSelect, 'vendor-1');

  // Switch to Upload tab (defaults to upload when library is empty, but
  // be explicit so the test reads cleanly).
  await user.click(screen.getByRole('button', { name: /upload new pdf/i }));

  // File input is sr-only — query by type and fire a synthetic change.
  // user-event's .upload() is an alternative but fireEvent.change keeps
  // the test independent of upload-helper internals.
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [makePdfFile()] } });

  // Required text fields for the upload branch
  await user.type(
    screen.getByPlaceholderText(/Protocol title \(required\)/i),
    'Test Protocol Title',
  );
  await user.type(
    screen.getByPlaceholderText(/Sponsor \(required\)/i),
    'Test Sponsor',
  );
}

// ----------------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------------

describe('NewAuditDrawer — orphan-document retry (PR #61)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Bootstrap effect reads vendors + library. Library empty → drawer
    // defaults to upload mode, which is the path we're testing.
    mockListVendors.mockResolvedValue(VENDORS);
    mockListSites.mockResolvedValue([]);
    mockListLibrary.mockResolvedValue([]);
    // Suppress the expected '[NewAuditDrawer] submit error:' logs in the
    // failure-path tests. The drawer logs every caught error; we don't
    // want a noisy test report. Per-test assertions on errorSpy would
    // catch accidental over-suppression but none of these tests need
    // them — the call-count assertions on the API mocks are the real
    // signal.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('caches uploaded document id; retry after step-2 failure does NOT re-upload', async () => {
    // First submit: upload succeeds, createProtocolFromDocument fails.
    // mockResolvedValueOnce (not mockResolvedValue) so an unexpected second
    // upload would resolve to undefined rather than a fake doc-id — gives a
    // clearer failure if the invariant ever regresses.
    mockUploadPdf.mockResolvedValueOnce({ document_id: 'doc-1' });
    mockCreateProtocol.mockRejectedValueOnce(new Error('promote failed'));

    const onClose = vi.fn();
    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewAuditDrawer onClose={onClose} onCreated={onCreated} />);

    await fillRequiredFieldsForUploadFlow(user);

    // Pre-state: cached indicator must NOT be visible before any submit.
    // Locks the "indicator only appears after a successful upload" half of
    // the invariant — without this, a regression that always shows the
    // indicator would pass the post-state assertion below.
    expect(screen.queryByTestId('upload-cached-indicator')).not.toBeInTheDocument();

    // First submit — should call upload, then fail on createProtocolFromDocument.
    await user.click(screen.getByRole('button', { name: /create audit/i }));

    await waitFor(() => {
      expect(mockUploadPdf).toHaveBeenCalledTimes(1);
      expect(mockCreateProtocol).toHaveBeenCalledTimes(1);
    });

    // The cached-document indicator should now be visible — the auditor's
    // next-action signal that retry will skip the upload.
    expect(screen.getByTestId('upload-cached-indicator')).toBeInTheDocument();

    // Set up the retry: createProtocolFromDocument now succeeds, then so does createAudit.
    mockCreateProtocol.mockResolvedValueOnce({
      id: 'pv-1',
      protocol_id: 'protocol-1',
      title: 'Test Protocol Title',
    });
    mockCreateAudit.mockResolvedValueOnce({ id: 'audit-1' });

    // Retry — click Create audit again.
    await user.click(screen.getByRole('button', { name: /create audit/i }));

    await waitFor(() => {
      expect(mockCreateAudit).toHaveBeenCalledTimes(1);
    });

    // THE INVARIANT: uploadProtocolPdf was NOT called a second time across
    // the retry. This is the orphan-document protection from PR #61 —
    // anything else (call count = 2, document_id mismatch on second call)
    // means the cache layer regressed and we're burning Reducto credits +
    // leaking documents rows on every retry.
    expect(mockUploadPdf).toHaveBeenCalledTimes(1);
    // createProtocolFromDocument fired again as the actual retry point.
    expect(mockCreateProtocol).toHaveBeenCalledTimes(2);
    // The flow completed — onCreated fired with the new audit id.
    expect(onCreated).toHaveBeenCalledWith('audit-1');
  });

  it('picking a new file clears the cache and re-arms the upload', async () => {
    mockUploadPdf
      .mockResolvedValueOnce({ document_id: 'doc-1' })   // first file
      .mockResolvedValueOnce({ document_id: 'doc-2' });  // second file
    // Fail step 2 on first attempt so we don't navigate away.
    mockCreateProtocol.mockRejectedValueOnce(new Error('promote failed'));

    const user = userEvent.setup();
    render(<NewAuditDrawer onClose={vi.fn()} onCreated={vi.fn()} />);

    await fillRequiredFieldsForUploadFlow(user);
    await user.click(screen.getByRole('button', { name: /create audit/i }));

    await waitFor(() =>
      expect(screen.getByTestId('upload-cached-indicator')).toBeInTheDocument(),
    );

    // Pick a NEW file — the cached indicator should disappear immediately.
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [makePdfFile('different.pdf')] },
    });

    await waitFor(() =>
      expect(screen.queryByTestId('upload-cached-indicator')).not.toBeInTheDocument(),
    );

    // Set up retry to succeed end-to-end.
    mockCreateProtocol.mockResolvedValueOnce({
      id: 'pv-1',
      protocol_id: 'protocol-1',
      title: 'Test Protocol Title',
    });
    mockCreateAudit.mockResolvedValueOnce({ id: 'audit-1' });

    await user.click(screen.getByRole('button', { name: /create audit/i }));

    await waitFor(() => expect(mockCreateAudit).toHaveBeenCalled());

    // Upload was called TWICE — once for each distinct file. The cache
    // correctly invalidated when the file changed.
    expect(mockUploadPdf).toHaveBeenCalledTimes(2);
  });

  it('happy path — single successful submit fires each step exactly once', async () => {
    mockUploadPdf.mockResolvedValueOnce({ document_id: 'doc-1' });
    mockCreateProtocol.mockResolvedValueOnce({
      id: 'pv-1',
      protocol_id: 'protocol-1',
      title: 'Test Protocol Title',
    });
    mockCreateAudit.mockResolvedValueOnce({ id: 'audit-1' });

    const onCreated = vi.fn();
    const user = userEvent.setup();
    render(<NewAuditDrawer onClose={vi.fn()} onCreated={onCreated} />);

    await fillRequiredFieldsForUploadFlow(user);
    await user.click(screen.getByRole('button', { name: /create audit/i }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('audit-1'));

    expect(mockUploadPdf).toHaveBeenCalledTimes(1);
    expect(mockCreateProtocol).toHaveBeenCalledTimes(1);
    expect(mockCreateAudit).toHaveBeenCalledTimes(1);
    expect(mockRefreshAudits).toHaveBeenCalledTimes(1);
    // Defensive: a clean happy-path run must not emit ANY console.error.
    // If a future refactor introduces a swallowed error or stray log, this
    // catches it. errorSpy is suppressed-but-spied, not unmocked — call
    // counts still register.
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
