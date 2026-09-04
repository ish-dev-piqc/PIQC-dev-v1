// PR-UX2 — one-ahead preview guard for Stage 2. Previewing from Intake used
// to render the live vendor-service and trust-assessment entry FORMS (the
// sections show forms whenever no record exists) — the preview must show
// placeholders instead. Mock idiom follows ReportDraftingWorkspace.test.tsx.
//
// Hardening PR-2 (load-path honesty): the fetch trio returns Result<T>;
// a failed read renders an error card instead of entry forms, a legitimate
// empty CLEARS a stale cache entry, and Retry recovers.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('../../../../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light' as const, toggleTheme: () => {} }),
}));

let mockActiveAudit = {
  id: 'audit-1',
  workflow_type: 'VENDOR_AUDIT',
  current_stage: 'VENDOR_ENRICHMENT',
};
const mockAdvanceStage = vi.fn();
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({
    activeAudit: mockActiveAudit,
    advanceStage: mockAdvanceStage,
    advanceStageError: null,
  }),
}));

// Real useState behind the three vendor stores so the component's own cache
// writes (including the clear-on-legitimate-empty) actually re-render —
// same pattern as PreAuditDraftingWorkspace.test.tsx's bundle store.
let initialVendorServices: Record<string, unknown> = {};
let initialServiceMappings: Record<string, unknown[]> = {};
let initialTrustAssessments: Record<string, unknown> = {};
vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => {
    const [vendorServices, setVendorServices] = useState(initialVendorServices);
    const [serviceMappings, setServiceMappings] = useState(initialServiceMappings);
    const [trustAssessments, setTrustAssessments] = useState(initialTrustAssessments);
    return {
      vendorServices,
      setVendorServices,
      serviceMappings,
      setServiceMappings,
      trustAssessments,
      setTrustAssessments,
      protocolRisks: {},
      setProtocolRisks: vi.fn(),
    };
  },
}));

vi.mock('../../../../../lib/audit/intakeApi', () => ({
  fetchProtocolRisksForAudit: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../../../../lib/audit/vendorEnrichmentApi', () => ({
  fetchVendorService: vi.fn(() => Promise.resolve({ ok: true, data: null })),
  createVendorService: vi.fn(),
  updateVendorService: vi.fn(),
  fetchServiceMappingsByAudit: vi.fn(() => Promise.resolve({ ok: true, data: [] })),
  createServiceMapping: vi.fn(),
  updateServiceMapping: vi.fn(),
  deleteServiceMapping: vi.fn(),
  fetchTrustAssessment: vi.fn(() => Promise.resolve({ ok: true, data: null })),
  upsertTrustAssessment: vi.fn(),
}));

import VendorEnrichmentWorkspace from '../VendorEnrichmentWorkspace';
import {
  fetchVendorService,
  fetchServiceMappingsByAudit,
  fetchTrustAssessment,
} from '../../../../../lib/audit/vendorEnrichmentApi';

const mockFetchService = fetchVendorService as ReturnType<typeof vi.fn>;
const mockFetchMappings = fetchServiceMappingsByAudit as ReturnType<typeof vi.fn>;
const mockFetchTrust = fetchTrustAssessment as ReturnType<typeof vi.fn>;

const SERVICE_ROW = {
  id: 'vs-1',
  audit_id: 'audit-1',
  service_name: 'eCOA hosting',
  service_type: 'PLATFORM',
  service_description: null,
};

function resetTrioMocks() {
  mockFetchService.mockResolvedValue({ ok: true, data: null });
  mockFetchMappings.mockResolvedValue({ ok: true, data: [] });
  mockFetchTrust.mockResolvedValue({ ok: true, data: null });
}

describe('VendorEnrichmentWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrioMocks();
    initialVendorServices = {};
    initialServiceMappings = {};
    initialTrustAssessments = {};
  });

  it('PREVIEW (audit at Intake), no data: placeholders render instead of live entry forms', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'INTAKE' };

    render(<VendorEnrichmentWorkspace />);

    // Service + trust sections both fall back to the placeholder (findAll
    // also waits out the load gate).
    expect(await screen.findAllByText('Nothing recorded yet.')).toHaveLength(2);
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    // No live form: the service form's save affordance must be absent.
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('AT STAGE, no data: the entry forms render (pre-UX2 behavior preserved)', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'VENDOR_ENRICHMENT' };

    render(<VendorEnrichmentWorkspace />);

    // Wait for the ok state (section card title only renders post-load).
    expect(await screen.findByText('Vendor service')).toBeInTheDocument();
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing recorded yet.')).not.toBeInTheDocument();
  });
});

describe('VendorEnrichmentWorkspace — load-path honesty (hardening PR-2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrioMocks();
    mockActiveAudit = {
      id: 'audit-1',
      workflow_type: 'VENDOR_AUDIT',
      current_stage: 'VENDOR_ENRICHMENT',
    };
    initialVendorServices = {};
    initialServiceMappings = {};
    initialTrustAssessments = {};
  });

  it('audit id threads into all three fetches', async () => {
    render(<VendorEnrichmentWorkspace />);
    await waitFor(() => expect(mockFetchService).toHaveBeenCalledWith('audit-1'));
    expect(mockFetchMappings).toHaveBeenCalledWith('audit-1');
    expect(mockFetchTrust).toHaveBeenCalledWith('audit-1');
  });

  it('a failed read swaps ITS sections for error cards — healthy sections survive (per-axis)', async () => {
    // Service read fails; trust read is healthy. The service section AND the
    // mapping section (unknowable — its query inner-joins the service) show
    // error cards, while the trust section still renders its form.
    mockFetchService.mockResolvedValue({ ok: false, error: 'permission denied' });

    render(<VendorEnrichmentWorkspace />);

    expect(await screen.findAllByTestId('vendor-load-error')).toHaveLength(2);
    expect(screen.queryByText('Vendor service')).not.toBeInTheDocument();
    expect(screen.queryByText('Protocol section mapping')).not.toBeInTheDocument();
    // The healthy section is NOT locked out by an unrelated failure.
    expect(screen.getByText('Trust intelligence')).toBeInTheDocument();
  });

  it('Retry recovers from a failed read', async () => {
    mockFetchService
      .mockResolvedValueOnce({ ok: false, error: 'transient' })
      .mockResolvedValue({ ok: true, data: SERVICE_ROW });

    render(<VendorEnrichmentWorkspace />);
    await screen.findAllByTestId('vendor-load-error');

    fireEvent.click(screen.getAllByRole('button', { name: /^retry$/i })[0]);

    expect(await screen.findByText('eCOA hosting')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-load-error')).not.toBeInTheDocument();
  });

  it('a legitimately-empty server response CLEARS a stale cache entry', async () => {
    // Cache claims a service exists; the server says it no longer does.
    // The old truthiness guard (`if (service)`) kept the stale record
    // rendering forever — absence must win when the read is healthy.
    // Order matters: wait out the loading gate FIRST, then assert the stale
    // record is gone — asserting absence during 'loading' is vacuous.
    initialVendorServices = { 'audit-1': SERVICE_ROW };

    render(<VendorEnrichmentWorkspace />);

    expect(await screen.findByText('Vendor service')).toBeInTheDocument();
    expect(screen.queryByText('eCOA hosting')).not.toBeInTheDocument();
  });

  it('a failed WRITE reverts the optimistic row and banners — never shown as saved', async () => {
    const { createVendorService } = await import(
      '../../../../../lib/audit/vendorEnrichmentApi'
    );
    (createVendorService as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    render(<VendorEnrichmentWorkspace />);
    await screen.findByText('Vendor service');

    // The form's own validation requires BOTH fields — without picking a
    // service type, handleSubmit short-circuits and onSubmit never fires
    // (the first version of this test died exactly there).
    fireEvent.change(
      screen.getByPlaceholderText(/central laboratory services/i),
      { target: { value: 'Phantom service' } },
    );
    fireEvent.click(screen.getByRole('button', { name: /^central laboratory$/i }));
    fireEvent.click(screen.getByRole('button', { name: /save vendor service/i }));

    // Pin that the handler actually reached the RPC wrapper — a validation
    // short-circuit must fail THIS line, not surface as a missing banner.
    await waitFor(() => expect(createVendorService).toHaveBeenCalled());

    const banner = await screen.findByTestId('vendor-mutation-error');
    expect(banner.textContent).toMatch(/was not saved/i);
    // Reverted: the section is back to its entry form — no summary card
    // rendering the phantom row as a saved service.
    expect(screen.getByRole('button', { name: /save vendor service/i })).toBeInTheDocument();
    expect(screen.queryByText('Phantom service')).not.toBeInTheDocument();
  });
});

// vendor-early-stage-advance: the ungated Stage 2 → 3 transition. The card's
// own states are pinned in StageTransitionCard.test.tsx; here we lock that it
// is MOUNTED on this workspace with the right target — enabled at the stage,
// disabled in the one-ahead preview.
describe('VendorEnrichmentWorkspace — stage transition (vendor-early-stage-advance)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetTrioMocks();
    initialVendorServices = {};
    initialServiceMappings = {};
    initialTrustAssessments = {};
  });

  it('AT STAGE: offers "Advance to Questionnaire review" and advances to that stage', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'VENDOR_ENRICHMENT' };

    render(<VendorEnrichmentWorkspace />);

    const button = await screen.findByRole('button', { name: /advance to questionnaire review/i });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(mockAdvanceStage).toHaveBeenCalledWith('QUESTIONNAIRE_REVIEW');
  });

  it('PREVIEW (audit at Intake): the transition button is present but disabled', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'INTAKE' };

    render(<VendorEnrichmentWorkspace />);

    const button = await screen.findByRole('button', { name: /advance to questionnaire review/i });
    expect(button).toBeDisabled();
    expect(mockAdvanceStage).not.toHaveBeenCalled();
  });
});
