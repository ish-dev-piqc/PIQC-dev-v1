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
import {
  createWorkspaceEntry,
  fetchWorkspaceEntries,
  promoteWorkspaceCandidate,
  updateWorkspaceEntry,
} from '../workspaceEntriesApi';

// Mock supabase, routed by table (PR-5): the entries read chains
// .select().eq().order(); the batched creator-name resolve chains
// .select().in(). Defaults resolve empty so flatten falls back to
// '(unknown)' without the network; tests override per case.
const { mockOrder, mockIn, mockFrom, mockRpc } = vi.hoisted(() => {
  const mockOrder = vi.fn().mockResolvedValue({ data: [], error: null });
  const mockIn = vi.fn().mockResolvedValue({ data: [], error: null });
  const entriesChain = { select: vi.fn(() => ({ eq: vi.fn(() => ({ order: mockOrder })) })) };
  const profilesChain = { select: vi.fn(() => ({ in: mockIn })) };
  const mockFrom = vi.fn((table: string) =>
    table === 'user_profiles' ? profilesChain : entriesChain,
  );
  return { mockOrder, mockIn, mockFrom, mockRpc: vi.fn() };
});

vi.mock('../../supabase', () => ({ supabase: { rpc: mockRpc, from: mockFrom } }));

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

// ---------------------------------------------------------------------------
// PR-5 — the READ path, tested for the first time (this is PR-D4's primary
// grounding read), including the batched creator-name resolve.
// ---------------------------------------------------------------------------

describe('fetchWorkspaceEntries — batched read (PR-5)', () => {
  beforeEach(() => {
    mockOrder.mockReset().mockResolvedValue({ data: [], error: null });
    mockIn.mockReset().mockResolvedValue({ data: [], error: null });
    mockFrom.mockClear();
  });

  it('flattens rows with ONE user_profiles query for N entries (unique ids)', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [
        makeEntryRow({ id: 'we-1', created_by: 'user-1' }),
        makeEntryRow({ id: 'we-2', created_by: 'user-2', observation_text: 'Second.' }),
        makeEntryRow({ id: 'we-3', created_by: 'user-1', observation_text: 'Third.' }),
      ],
      error: null,
    });
    mockIn.mockResolvedValueOnce({
      data: [
        { id: 'user-1', name: 'Ana Auditor' },
        { id: 'user-2', name: 'Ben Auditor' },
      ],
      error: null,
    });

    const entries = await fetchWorkspaceEntries('audit-1');

    expect(entries).toHaveLength(3);
    expect(entries[0].created_by_name).toBe('Ana Auditor');
    expect(entries[1].created_by_name).toBe('Ben Auditor');
    expect(entries[2].created_by_name).toBe('Ana Auditor');
    // The batching pin: exactly one profiles query, deduped ids.
    expect(mockFrom.mock.calls.filter(([t]) => t === 'user_profiles')).toHaveLength(1);
    expect(mockIn).toHaveBeenCalledTimes(1);
    expect(mockIn).toHaveBeenCalledWith('id', ['user-1', 'user-2']);
  });

  it('a missing profile falls back to (unknown) — same contract as before', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [makeEntryRow({ created_by: 'user-gone' })],
      error: null,
    });
    mockIn.mockResolvedValueOnce({ data: [], error: null });

    const entries = await fetchWorkspaceEntries('audit-1');
    expect(entries[0].created_by_name).toBe('(unknown)');
  });

  it('empty register → [] with NO profiles query at all', async () => {
    mockOrder.mockResolvedValueOnce({ data: [], error: null });
    const entries = await fetchWorkspaceEntries('audit-1');
    expect(entries).toEqual([]);
    expect(mockIn).not.toHaveBeenCalled();
  });

  it('a read error returns [] (current contract, pinned as-is)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const entries = await fetchWorkspaceEntries('audit-1');
    expect(entries).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('flatten output carries the row fields through unchanged', async () => {
    mockOrder.mockResolvedValueOnce({
      data: [makeEntryRow({ checkpoint_ref: 'SOP-12 §4', provisional_impact: 'MAJOR' })],
      error: null,
    });
    const entries = await fetchWorkspaceEntries('audit-1');
    expect(entries[0]).toMatchObject({
      id: 'we-1',
      audit_id: 'audit-1',
      vendor_domain: 'Validation',
      observation_text: 'Vendor SOP signed and current.',
      checkpoint_ref: 'SOP-12 §4',
      provisional_impact: 'MAJOR',
      risk_context_outdated: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Fieldwork lane, slice 2 — promoting a PIQC-drafted candidate. The wrapper's
// contract: origin is derived from `edited` (verbatim → PIQC_DRAFTED, any
// edit → PIQC_EDITED), the post-gate evidence is forwarded untouched (the RPC
// derives source_note_ids from it), and the auditor-owned classification /
// impact default exactly like createWorkspaceEntry.
// ---------------------------------------------------------------------------

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const EVIDENCE = [
  { text: 'Two excursions were logged five days late.', source_note_ids: [NOTE_A], source_passages: [] },
];

describe('promoteWorkspaceCandidate — origin + defaults', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    mockIn.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it('verbatim acceptance → PIQC_DRAFTED with the create-RPC defaults, evidence forwarded as-is', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow({ id: 'we-9' }), error: null });

    const result = await promoteWorkspaceCandidate('audit-1', {
      vendorDomain: 'Data integrity',
      observationText: 'Excursions were not documented within the required window.',
      evidence: EVIDENCE,
      edited: false,
    });

    expect(mockRpc).toHaveBeenCalledOnce();
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_promote_workspace_candidate', {
      p_audit_id: 'audit-1',
      p_vendor_domain: 'Data integrity',
      p_observation_text: 'Excursions were not documented within the required window.',
      p_origin: 'PIQC_DRAFTED',
      p_evidence: EVIDENCE,
      p_checkpoint_ref: null,
      p_protocol_ref: null,
      p_provisional_impact: 'NONE',
      p_provisional_classification: 'NOT_YET_CLASSIFIED',
      p_reason: null,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.id).toBe('we-9');
  });

  it('an edited candidate → PIQC_EDITED, with the auditor classification, checkpoint, and protocol quote forwarded', async () => {
    mockRpc.mockResolvedValueOnce({ data: makeEntryRow(), error: null });
    const protocolRef = {
      chunk_id: 'chunk-p1',
      document_id: 'doc-p',
      quote: 'any excursion documented and reported to the sponsor',
      section_heading: '6.3 Storage',
      page_start: 47,
      page_end: 47,
    };

    await promoteWorkspaceCandidate('audit-1', {
      vendorDomain: 'Data integrity',
      observationText: 'Edited text.',
      evidence: EVIDENCE,
      edited: true,
      checkpointRef: 'SOP-014 rev 3 §4.2',
      protocolRef,
      provisionalClassification: 'FINDING',
    });

    expect(mockRpc).toHaveBeenCalledWith(
      'audit_mode_promote_workspace_candidate',
      expect.objectContaining({
        p_origin: 'PIQC_EDITED',
        p_checkpoint_ref: 'SOP-014 rev 3 §4.2',
        p_protocol_ref: protocolRef,
        p_provisional_classification: 'FINDING',
        p_provisional_impact: 'NONE',
      }),
    );
  });

  it('an RPC refusal (already-promoted note) surfaces as ok:false with the server message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'candidate cites a note already promoted into an accepted observation — re-run drafting' },
    });

    const result = await promoteWorkspaceCandidate('audit-1', {
      vendorDomain: 'x',
      observationText: 'y',
      evidence: EVIDENCE,
      edited: false,
    });

    expect(result).toEqual({
      ok: false,
      error: 'candidate cites a note already promoted into an accepted observation — re-run drafting',
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
