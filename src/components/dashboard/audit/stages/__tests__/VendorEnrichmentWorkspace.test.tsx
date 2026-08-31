// PR-UX2 — one-ahead preview guard for Stage 2. Previewing from Intake used
// to render the live vendor-service and trust-assessment entry FORMS (the
// sections show forms whenever no record exists) — the preview must show
// placeholders instead. Mock idiom follows ReportDraftingWorkspace.test.tsx.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

vi.mock('../../../../../context/AuditDataContext', () => ({
  useAuditData: () => ({
    vendorServices: {},
    setVendorServices: vi.fn(),
    serviceMappings: {},
    setServiceMappings: vi.fn(),
    trustAssessments: {},
    setTrustAssessments: vi.fn(),
    protocolRisks: {},
  }),
}));

vi.mock('../../../../../lib/audit/vendorEnrichmentApi', () => ({
  fetchVendorService: vi.fn(() => Promise.resolve(null)),
  createVendorService: vi.fn(),
  updateVendorService: vi.fn(),
  fetchServiceMappingsByAudit: vi.fn(() => Promise.resolve([])),
  createServiceMapping: vi.fn(),
  updateServiceMapping: vi.fn(),
  deleteServiceMapping: vi.fn(),
  fetchTrustAssessment: vi.fn(() => Promise.resolve(null)),
  upsertTrustAssessment: vi.fn(),
}));

import VendorEnrichmentWorkspace from '../VendorEnrichmentWorkspace';
import { fetchVendorService } from '../../../../../lib/audit/vendorEnrichmentApi';

const mockFetchService = fetchVendorService as ReturnType<typeof vi.fn>;

describe('VendorEnrichmentWorkspace — one-ahead preview guard (PR-UX2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('PREVIEW (audit at Intake), no data: placeholders render instead of live entry forms', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'INTAKE' };

    render(<VendorEnrichmentWorkspace />);

    await waitFor(() => expect(mockFetchService).toHaveBeenCalledWith('audit-1'));
    expect(screen.getByText(/has not reached this stage yet/i)).toBeInTheDocument();
    // Service + trust sections both fall back to the placeholder.
    expect(screen.getAllByText('Nothing recorded yet.')).toHaveLength(2);
    // No live form: the service form's save affordance must be absent.
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });

  it('AT STAGE, no data: the entry forms render (pre-UX2 behavior preserved)', async () => {
    mockActiveAudit = { ...mockActiveAudit, current_stage: 'VENDOR_ENRICHMENT' };

    render(<VendorEnrichmentWorkspace />);

    await waitFor(() => expect(mockFetchService).toHaveBeenCalled());
    expect(screen.queryByText(/has not reached this stage yet/i)).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing recorded yet.')).not.toBeInTheDocument();
  });
});
