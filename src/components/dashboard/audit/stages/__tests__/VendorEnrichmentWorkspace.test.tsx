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
vi.mock('../../../../../context/AuditContext', () => ({
  useAudit: () => ({ activeAudit: mockActiveAudit }),
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
    };
  },
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

  it('a failed read renders the error card — never entry forms over unknown server state', async () => {
    mockFetchService.mockResolvedValue({ ok: false, error: 'permission denied' });

    render(<VendorEnrichmentWorkspace />);

    expect(await screen.findByTestId('vendor-load-error')).toBeInTheDocument();
    // No section cards, no forms, no save affordances.
    expect(screen.queryByText('Vendor service')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('Retry recovers from a failed read', async () => {
    mockFetchService
      .mockResolvedValueOnce({ ok: false, error: 'transient' })
      .mockResolvedValue({ ok: true, data: SERVICE_ROW });

    render(<VendorEnrichmentWorkspace />);
    await screen.findByTestId('vendor-load-error');

    fireEvent.click(screen.getByRole('button', { name: /^retry$/i }));

    expect(await screen.findByText('eCOA hosting')).toBeInTheDocument();
    expect(screen.queryByTestId('vendor-load-error')).not.toBeInTheDocument();
  });

  it('a legitimately-empty server response CLEARS a stale cache entry', async () => {
    // Cache claims a service exists; the server says it no longer does.
    // The old truthiness guard (`if (service)`) kept the stale record
    // rendering forever — absence must win when the read is healthy.
    initialVendorServices = { 'audit-1': SERVICE_ROW };
    resetTrioMocks(); // all three reads ok and empty

    render(<VendorEnrichmentWorkspace />);

    await waitFor(() =>
      expect(screen.queryByText('eCOA hosting')).not.toBeInTheDocument(),
    );
    // The section is back to its pending/entry state, not the stale record.
    expect(await screen.findByText('Vendor service')).toBeInTheDocument();
  });
});
