// Hardening PR-2 — the audit-scoped vendor fetch trio returns Result<T>.
// The contract under test: "legitimately empty" is { ok: true, data: null/[] }
// and a DB error is { ok: false, error } — never the same value. Collapsing
// both into null/[] is what let a failed read render create-mode forms over
// rows that exist, and let a legitimate empty fail to clear a stale cache.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchVendorService,
  fetchServiceMappingsByAudit,
  fetchTrustAssessment,
} from '../vendorEnrichmentApi';

vi.mock('../../supabase', () => {
  const from = vi.fn();
  const rpc = vi.fn();
  return { supabase: { from, rpc } };
});

import { supabase } from '../../supabase';
const mockFrom = supabase.from as unknown as ReturnType<typeof vi.fn>;

const DB_ERROR = { code: '42501', message: 'permission denied' };

// .from(t).select(...).eq(...).maybeSingle() — service and trust reads.
const singleChain = (result: { data: unknown; error: unknown }) => ({
  select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve(result) }) }),
});
// .from(t).select(...).eq(...).order(...) — the mappings read.
const listChain = (result: { data: unknown; error: unknown }) => ({
  select: () => ({ eq: () => ({ order: () => Promise.resolve(result) }) }),
});

const SERVICE_ROW = {
  id: 'vs-1',
  audit_id: 'audit-1',
  service_name: 'eCOA hosting',
  service_type: 'PLATFORM',
  service_description: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const MAPPING_ROW = {
  id: 'sm-1',
  vendor_service_id: 'vs-1',
  protocol_risk_id: 'pr-1',
  derived_criticality: 'HIGH',
  criticality_rationale: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

const TRUST_ROW = {
  id: 'ta-1',
  audit_id: 'audit-1',
  certifications_claimed: [],
  regulatory_claims: [],
  compliance_posture: 'CLAIMS_ALIGNED',
  maturity_posture: 'ESTABLISHED',
  provisional_trust_posture: 'STANDARD',
  risk_hypotheses: [],
  notes: null,
  assessed_by: 'u1',
  assessed_at: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  // Restore rather than letting spies nest one level per test.
  errorSpy.mockRestore();
});

describe('fetchVendorService — Result contract (PR-2)', () => {
  it('row present → ok with the flattened service', async () => {
    mockFrom.mockReturnValue(singleChain({ data: SERVICE_ROW, error: null }));
    const res = await fetchVendorService('audit-1');
    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ id: 'vs-1', service_name: 'eCOA hosting' }),
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('legitimately empty → ok with null (NOT an error)', async () => {
    mockFrom.mockReturnValue(singleChain({ data: null, error: null }));
    const res = await fetchVendorService('audit-1');
    expect(res).toEqual({ ok: true, data: null });
  });

  it('DB error → ok:false with the message, and logged', async () => {
    mockFrom.mockReturnValue(singleChain({ data: null, error: DB_ERROR }));
    const res = await fetchVendorService('audit-1');
    expect(res).toEqual({ ok: false, error: 'permission denied' });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('fetchServiceMappingsByAudit — Result contract (PR-2)', () => {
  it('rows present → ok with flattened mappings', async () => {
    mockFrom.mockReturnValue(listChain({ data: [MAPPING_ROW], error: null }));
    const res = await fetchServiceMappingsByAudit('audit-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data).toHaveLength(1);
  });

  it('legitimately empty → ok with [] (NOT an error)', async () => {
    mockFrom.mockReturnValue(listChain({ data: [], error: null }));
    const res = await fetchServiceMappingsByAudit('audit-1');
    expect(res).toEqual({ ok: true, data: [] });
  });

  it('DB error → ok:false, never a silent []', async () => {
    mockFrom.mockReturnValue(listChain({ data: null, error: DB_ERROR }));
    const res = await fetchServiceMappingsByAudit('audit-1');
    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('fetchTrustAssessment — Result contract (PR-2)', () => {
  it('row present → ok with the flattened assessment', async () => {
    mockFrom.mockReturnValue(singleChain({ data: TRUST_ROW, error: null }));
    const res = await fetchTrustAssessment('audit-1');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data?.id).toBe('ta-1');
  });

  it('legitimately empty → ok with null (NOT an error)', async () => {
    mockFrom.mockReturnValue(singleChain({ data: null, error: null }));
    const res = await fetchTrustAssessment('audit-1');
    expect(res).toEqual({ ok: true, data: null });
  });

  it('DB error → ok:false with the message', async () => {
    mockFrom.mockReturnValue(singleChain({ data: null, error: DB_ERROR }));
    const res = await fetchTrustAssessment('audit-1');
    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});
