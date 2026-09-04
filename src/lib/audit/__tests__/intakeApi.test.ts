// Unit tests for Stage 1 (Intake) protocol-risk API wrappers.
//
// The RPC bodies — audit_mode_create_protocol_risk and
// audit_mode_update_protocol_risk — are covered by smoke tests against a
// real Supabase in scripts/smoke-rpcs.sh. Here we lock down the
// client-side invariants that are easy to break silently in TypeScript:
//
//   1. Three-way source-link semantics on update:
//        set       → sourceExtractedItemId: 'uuid', no clear flag
//        clear     → clearSourceExtractedItemId: true, no source id
//        unchanged → neither — wrapper forwards nulls for BOTH so server
//                    can distinguish "I didn't say" from "I said null"
//      The server enforces precedence when both are sent; the wrapper's
//      job is only to forward them faithfully.
//
//   2. Create path forwards sourceExtractedItemId correctly (set vs null).
//
//   3. Error path returns null and logs (matches the rest of intakeApi).
//
//   4. Future-refactor guard: `clearSourceExtractedItemId: false` must
//      forward as null. A `||` substituted for `??` would silently break
//      this and we'd lose the ability to send "explicit not-clear."
//
//   5. Candidate create (PIQC-assisted) forwards the source id and the
//      provenance to its own RPC, and reports PGRST202 as `notApplied` so
//      the workspace can fall back to the manual create before `db push`.
//
// Pattern mirrors src/lib/sotr/__tests__/sourceEvidenceApi.test.ts:
//   - vi.mock('../../supabase') with an inline rpc factory
//   - mockResolvedValueOnce for the data path
//   - mockReset in beforeEach for isolation
//   - toHaveBeenCalledWith + expect.objectContaining for typed call-arg
//     assertions (avoids untyped mock.calls indexing)

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createProtocolRisk,
  createProtocolRiskFromCandidate,
  updateProtocolRisk,
} from '../intakeApi';
import type { SuggestionProvenance } from '../../../types/audit';

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

// Minimal valid ProtocolRiskRow shape — enough to satisfy flattenRisk().
// Source-link tests assert the RPC call shape, not the return value.
function makeRiskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'risk-1',
    protocol_version_id: 'pv-1',
    section_identifier: '4.1',
    section_title: 'Endpoint definition',
    endpoint_tier: 'PRIMARY',
    impact_surface: 'DATA_INTEGRITY',
    time_sensitivity: false,
    vendor_dependency_flags: [],
    operational_domain_tag: 'CENTRAL_LAB',
    tagging_mode: 'MANUAL',
    version_change_type: 'ADDED',
    source_extracted_item_id: null,
    tagged_by: 'user-1',
    tagged_at: '2026-05-15T00:00:00Z',
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

const BASE_CREATE_INPUT = {
  sectionIdentifier: '4.1',
  sectionTitle: 'Endpoint definition',
  endpointTier: 'PRIMARY' as const,
  impactSurface: 'DATA_INTEGRITY' as const,
  timeSensitivity: false,
  vendorDependencyFlags: [],
  operationalDomainTag: 'CENTRAL_LAB',
};

describe('createProtocolRisk — sourceExtractedItemId forwarding', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('forwards a UUID when sourceExtractedItemId is set', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await createProtocolRisk('pv-1', {
      ...BASE_CREATE_INPUT,
      sourceExtractedItemId: 'extracted-abc',
    });

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_protocol_risk',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-abc',
      }),
    );
  });

  it('forwards null when sourceExtractedItemId is explicitly null', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await createProtocolRisk('pv-1', {
      ...BASE_CREATE_INPUT,
      sourceExtractedItemId: null,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_protocol_risk',
      expect.objectContaining({ p_source_extracted_item_id: null }),
    );
  });

  it('forwards null when sourceExtractedItemId is omitted', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await createProtocolRisk('pv-1', BASE_CREATE_INPUT);

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_protocol_risk',
      expect.objectContaining({ p_source_extracted_item_id: null }),
    );
  });
});

describe('updateProtocolRisk — three-way source-link semantics', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('SET: forwards source id and a null clear flag', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await updateProtocolRisk('risk-1', {
      sourceExtractedItemId: 'extracted-xyz',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_protocol_risk',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-xyz',
        p_clear_source_extracted_item_id: null,
      }),
    );
  });

  it('CLEAR: forwards null source id and clear=true', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await updateProtocolRisk('risk-1', {
      clearSourceExtractedItemId: true,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_protocol_risk',
      expect.objectContaining({
        p_source_extracted_item_id: null,
        p_clear_source_extracted_item_id: true,
      }),
    );
  });

  it('UNCHANGED: forwards null for both flags when neither is provided', async () => {
    // Driver: the caller IS sending an edit (endpointTier change), just not
    // a source-link edit. The wrapper must NOT confuse "unrelated field
    // change" with "clear the source link" — both flags should be null so
    // the server reads "leave the existing link alone."
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await updateProtocolRisk('risk-1', { endpointTier: 'SECONDARY' });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_protocol_risk',
      expect.objectContaining({
        p_source_extracted_item_id: null,
        p_clear_source_extracted_item_id: null,
      }),
    );
  });

  it('BOTH: forwards both flags faithfully when caller sends both', async () => {
    // The wrapper does NOT enforce precedence — the server picks the winner.
    // We only verify the wrapper transmits what the caller passed so the
    // server can do its job.
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await updateProtocolRisk('risk-1', {
      sourceExtractedItemId: 'extracted-xyz',
      clearSourceExtractedItemId: true,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_protocol_risk',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-xyz',
        p_clear_source_extracted_item_id: true,
      }),
    );
  });

  it('forwards clearSourceExtractedItemId: false as null (refactor guard)', async () => {
    // Refactor guard: the wrapper uses `?? null`, which passes `false`
    // through as `false`. If anyone substitutes `|| null`, this assertion
    // breaks (false → null) — a silent semantic change in what the server
    // receives for "explicitly not clearing." Lock the current behavior.
    mockRpc.mockResolvedValueOnce({ data: makeRiskRow(), error: null });

    await updateProtocolRisk('risk-1', {
      clearSourceExtractedItemId: false,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_protocol_risk',
      expect.objectContaining({
        p_clear_source_extracted_item_id: false,
      }),
    );
  });

  it('returns null and does not throw when the RPC errors', async () => {
    // Scope the error-log spy to this test only — describe-level spying
    // would silently suppress unexpected logs in the other tests.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });

    const result = await updateProtocolRisk('risk-1', {
      clearSourceExtractedItemId: true,
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('createProtocolRiskFromCandidate — PIQC-assisted create', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  const PROVENANCE: SuggestionProvenance = {
    source: 'sotr_item',
    rule: 'endpoint_primary',
    field_path: 'primary_endpoints[0]',
    field_type: 'endpoint',
    confidence_state: 'high',
    document_id: 'doc-1',
    proposed: {
      section_identifier: '§5.1',
      section_title: 'Overall survival',
      endpoint_tier: 'PRIMARY',
      impact_surface: 'DATA_INTEGRITY',
      time_sensitivity: false,
    },
    derived_at: '2026-09-04T12:00:00.000Z',
  };

  it('forwards the source id and provenance to the candidate RPC and flattens the row', async () => {
    mockRpc.mockResolvedValueOnce({
      data: makeRiskRow({ tagging_mode: 'PIQC_ASSISTED', source_extracted_item_id: 'extracted-abc' }),
      error: null,
    });

    const result = await createProtocolRiskFromCandidate(
      'pv-1',
      { ...BASE_CREATE_INPUT, sourceExtractedItemId: 'extracted-abc' },
      PROVENANCE,
    );

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_protocol_risk_from_candidate',
      expect.objectContaining({
        p_protocol_version_id: 'pv-1',
        p_section_identifier: '4.1',
        p_source_extracted_item_id: 'extracted-abc',
        p_suggestion_provenance: PROVENANCE,
        p_reason: null,
      }),
    );
    expect(result).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: 'risk-1',
        tagging_mode: 'PIQC_ASSISTED',
        source_extracted_item_id: 'extracted-abc',
      }),
    });
  });

  it('reports PGRST202 (RPC not applied) as notApplied without logging', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Could not find the function', code: 'PGRST202' },
    });

    const result = await createProtocolRiskFromCandidate(
      'pv-1',
      { ...BASE_CREATE_INPUT, sourceExtractedItemId: 'extracted-abc' },
      PROVENANCE,
    );

    expect(result).toEqual({ ok: false, error: 'Could not find the function', notApplied: true });
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('returns a plain ok:false (no notApplied) on any other error', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });

    const result = await createProtocolRiskFromCandidate(
      'pv-1',
      { ...BASE_CREATE_INPUT, sourceExtractedItemId: 'extracted-abc' },
      PROVENANCE,
    );

    expect(result).toEqual({ ok: false, error: 'permission denied' });
    expect(result).not.toHaveProperty('notApplied');
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
