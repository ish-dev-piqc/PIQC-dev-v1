// Unit tests for Stage 6 (Audit Conduct) workspace-entry API wrappers.
//
// Mirrors PR #64 (intakeApi.test.ts) applied to the workspace-entry surface
// shipped in PR #67 (B2). The wrapper-side three-way source-link contract is
// identical across the two stages:
//
//   updateWorkspaceEntry source_extracted_item_id semantics:
//     SET       → sourceExtractedItemId only       → p_source: uuid, p_clear: null
//     CLEAR     → clearSourceExtractedItemId only  → p_source: null, p_clear: true
//     UNCHANGED → neither                          → p_source: null, p_clear: null
//                 (wrapper forwards nulls for BOTH so server can distinguish
//                 "no edit" from "edit to null")
//     BOTH      → wrapper forwards both faithfully → server picks the winner
//                 (server precedence: clear wins; tested via real-Supabase
//                 smoke, not asserted here — wrapper concern is fidelity only)
//
// Also locked: createWorkspaceEntry forwarding (set / null / omit) and the
// error-return-null contract on both wrappers.
//
// Pattern parity with src/lib/audit/__tests__/intakeApi.test.ts:
//   - vi.mock('../../supabase') with inline rpc factory
//   - mockReset in beforeEach for isolation
//   - toHaveBeenCalledWith + expect.objectContaining for typed call-arg
//     assertions (no untyped mock.calls indexing)
//   - Per-test error-log spy where it matters; otherwise describe-level
//     with explicit call-count assertions
//
// This is the THIRD test file with this shape (intakeApi, preAuditApi,
// workspaceEntriesApi). Convention: three is parity that proves the pattern;
// four is missing abstraction. If a 4th wrapper takes the same source-link
// shape, extract __testHelpers__/threeWaySourceLink.ts at that point — not
// before. Premature extraction would over-shape the abstraction.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkspaceEntry, updateWorkspaceEntry } from '../workspaceEntriesApi';

// Mock supabase. flattenEntry calls supabase.from('user_profiles') via
// resolveCreatorName — stub a chainable that returns data: null so the
// flatten path resolves to '(unknown)' without going through the network.
vi.mock('../../supabase', () => {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null });
  const eq          = vi.fn(() => ({ maybeSingle }));
  const select      = vi.fn(() => ({ eq }));
  const from        = vi.fn(() => ({ select }));
  const rpc         = vi.fn();
  return { supabase: { rpc, from } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

// Minimal WorkspaceEntryRow shape. The RPC returns the inserted/updated row
// and the wrapper flattens it; tests assert the RPC call shape, not the
// returned value beyond truthiness.
function makeEntryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'we-1',
    audit_id: 'audit-1',
    protocol_risk_id: null,
    vendor_service_mapping_id: null,
    questionnaire_response_id: null,
    checkpoint_ref: null,
    vendor_domain: 'Validation',
    observation_text: 'Vendor SOP signed and current.',
    provisional_impact: 'NONE',
    provisional_classification: 'NOT_YET_CLASSIFIED',
    risk_attrs_inherited: false,
    inherited_endpoint_tier: null,
    inherited_impact_surface: null,
    inherited_time_sensitivity: null,
    risk_context_outdated: false,
    risk_context_confirmed_at: null,
    risk_context_confirmed_by: null,
    source_extracted_item_id: null,
    created_by: 'user-1',
    created_at: '2026-05-15T00:00:00Z',
    updated_at: '2026-05-15T00:00:00Z',
    ...overrides,
  };
}

const BASE_CREATE_INPUT = {
  vendorDomain: 'Validation',
  observationText: 'Vendor SOP signed and current.',
};

describe('createWorkspaceEntry — sourceExtractedItemId forwarding', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('forwards a UUID when sourceExtractedItemId is set, and round-trips it through flattenEntry', async () => {
    // Mock the row to echo the source id back — verifies BOTH:
    //   1. wrapper forwards the UUID to the RPC (the obvious assertion)
    //   2. flattenEntry preserves source_extracted_item_id on the
    //      row → MockWorkspaceEntry mapping (the non-obvious one — if
    //      flattenEntry ever drops this field, every other test would
    //      still pass because they only check the RPC call args)
    mockRpc.mockResolvedValueOnce({
      data: makeEntryRow({ source_extracted_item_id: 'extracted-abc' }),
      error: null,
    });

    const result = await createWorkspaceEntry('audit-1', {
      ...BASE_CREATE_INPUT,
      sourceExtractedItemId: 'extracted-abc',
    });

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_workspace_entry',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-abc',
      }),
    );
    // Row → client mapping contract (createWorkspaceEntry now returns a
    // discriminated result — AUD-301).
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source_extracted_item_id).toBe('extracted-abc');
    }
  });

  it('forwards null when sourceExtractedItemId is explicitly null', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await createWorkspaceEntry('audit-1', {
      ...BASE_CREATE_INPUT,
      sourceExtractedItemId: null,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_workspace_entry',
      expect.objectContaining({ p_source_extracted_item_id: null }),
    );
  });

  it('forwards null when sourceExtractedItemId is omitted', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await createWorkspaceEntry('audit-1', BASE_CREATE_INPUT);

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_create_workspace_entry',
      expect.objectContaining({ p_source_extracted_item_id: null }),
    );
  });
});

describe('updateWorkspaceEntry — three-way source-link semantics', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('SET: forwards source id and a null clear flag', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await updateWorkspaceEntry('we-1', {
      sourceExtractedItemId: 'extracted-xyz',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_workspace_entry',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-xyz',
        p_clear_source_extracted_item_id: null,
      }),
    );
  });

  it('CLEAR: forwards null source id and clear=true', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await updateWorkspaceEntry('we-1', {
      clearSourceExtractedItemId: true,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_workspace_entry',
      expect.objectContaining({
        p_source_extracted_item_id: null,
        p_clear_source_extracted_item_id: true,
      }),
    );
  });

  it('UNCHANGED: forwards null for both flags when neither is provided', async () => {
    // Driver: caller is editing an unrelated field (observationText) and is
    // not touching the source link. The wrapper must NOT confuse "unrelated
    // edit" with "clear the source link" — both flags must be null so the
    // server reads "leave the existing link alone."
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await updateWorkspaceEntry('we-1', {
      observationText: 'Updated observation text.',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_workspace_entry',
      expect.objectContaining({
        p_source_extracted_item_id: null,
        p_clear_source_extracted_item_id: null,
      }),
    );
  });

  it('BOTH: forwards both flags faithfully when caller sends both', async () => {
    // The wrapper does NOT enforce precedence — the server picks the winner.
    // The wrapper's job is to transmit faithfully so the server can do its.
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await updateWorkspaceEntry('we-1', {
      sourceExtractedItemId: 'extracted-xyz',
      clearSourceExtractedItemId: true,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_workspace_entry',
      expect.objectContaining({
        p_source_extracted_item_id: 'extracted-xyz',
        p_clear_source_extracted_item_id: true,
      }),
    );
  });

  it('forwards clearSourceExtractedItemId: false as null (refactor guard)', async () => {
    // Refactor guard: the wrapper uses `?? null`, which passes `false`
    // through as `false`. If anyone substitutes `|| null`, `false` would
    // silently coerce to `null` — a subtle semantic change in what the
    // server receives for "explicitly not clearing." Lock current behavior.
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });

    await updateWorkspaceEntry('we-1', {
      clearSourceExtractedItemId: false,
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_update_workspace_entry',
      expect.objectContaining({
        p_clear_source_extracted_item_id: false,
      }),
    );
  });

  it('returns null and does not throw when the RPC errors', async () => {
    // Scope the spy to this test only — describe-level spying would silently
    // suppress unexpected logs in the other tests.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied', code: '42501' },
    });

    const result = await updateWorkspaceEntry('we-1', {
      clearSourceExtractedItemId: true,
    });

    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[workspaceEntriesApi] updateWorkspaceEntry'),
      expect.anything(),
    );
    errorSpy.mockRestore();
  });
});
