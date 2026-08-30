// Unit tests for deliverableGenerationApi (PR-C1 — grounded checklist slice).
//
// Locks the contracts that keep generation honest at the API boundary:
//   - no session is a hard fail (never the anon key), and a thrown fetch maps
//     to a Result error so the caller's busy state can't stick
//   - apply sends the proposal's OWN grounding through to the RPC verbatim —
//     the snapshot records what generation saw, not what the client believes
//   - computeChecklistCurrency: pure set-diff, flag-never-block semantics,
//     null when the checklist was never generated
//
// Mock surface mirrors evidenceApi.test.ts (vi.hoisted supabase mock +
// stubbed global fetch).

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockGetSession } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock('../../supabase', () => ({
  supabase: {
    rpc: mockRpc,
    auth: { getSession: mockGetSession },
  },
}));

import {
  applyChecklistGeneration,
  computeChecklistCurrency,
  requestChecklistDraft,
  type ChecklistDraftProposal,
} from '../deliverableGenerationApi';
import type { AuditEvidenceListRow, ChecklistGroundingSnapshot } from '../../../types/audit';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SESSION = { data: { session: { access_token: 'jwt-token' } } };

const PROPOSAL: ChecklistDraftProposal = {
  mode: 'generate',
  items: [
    { id: 'i1', prompt: 'Verify SOP index is current', checkpoint_ref: null, evidence_expected: true },
  ],
  generation_refs: [
    {
      item_id: 'i1',
      chunk_id: 'c1',
      document_id: 'd1',
      source: 'EVIDENCE',
      quote: 'the SOP index shall be reviewed annually',
      doc_title: 'QA SOP v3',
      section_heading: null,
      page_start: null,
      page_end: null,
    },
  ],
  grounding: {
    protocol_document_ids: ['pd1'],
    evidence: [{ document_id: 'd1', content_hash: 'abc', title: 'QA SOP v3', source_type: 'SOP' }],
  },
  dropped_count: 0,
  stripped_ref_count: 0,
  protocol_source: 'ready',
  evidence_doc_count: 1,
};

function evidenceRow(overrides: Partial<AuditEvidenceListRow>): AuditEvidenceListRow {
  return {
    audit_id: 'a1',
    document_id: 'd1',
    added_by: 'u1',
    added_at: '2026-08-30T12:00:00Z',
    source_type: 'SOP',
    source_system: null,
    source_locator: null,
    include_in_generation: true,
    title: 'QA SOP v3',
    status: 'ready',
    ...overrides,
  };
}

describe('requestChecklistDraft', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockFetch.mockReset();
  });

  it('hard-fails without a session and never calls fetch', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await requestChecklistDraft('a1');
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts the audit id and returns the proposal', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => PROPOSAL });
    const res = await requestChecklistDraft('a1');

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/audit-checklist-draft');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body)).toEqual({ audit_id: 'a1' });
    expect(res).toEqual({ ok: true, data: PROPOSAL });
  });

  it('surfaces the server error message on a non-OK response', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Checklist drafting is only available on vendor audits' }),
    });
    const res = await requestChecklistDraft('a1');
    expect(res).toEqual({
      ok: false,
      error: 'Checklist drafting is only available on vendor audits',
    });
  });

  it('maps a thrown fetch (network drop) to a Result error — busy state must never stick', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await requestChecklistDraft('a1');
    expect(res.ok).toBe(false);
  });
});

describe('applyChecklistGeneration', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('passes the proposal grounding through verbatim with generate attribution', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'ch1' }, error: null });
    const res = await applyChecklistGeneration('a1', PROPOSAL);
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_apply_checklist_generation', {
      p_audit_id: 'a1',
      p_content: { items: PROPOSAL.items },
      p_generation_refs: PROPOSAL.generation_refs,
      p_grounding_snapshot: PROPOSAL.grounding,
      p_reason: 'Checklist drafted by PIQC from protocol + evidence',
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it('uses the revise attribution when the proposal was a revision', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await applyChecklistGeneration('a1', { ...PROPOSAL, mode: 'revise' });
    expect(mockRpc.mock.calls[0][1].p_reason).toBe(
      'Checklist revised by PIQC from protocol + evidence',
    );
  });

  it('prefers the RPC hint over the raw message on failure', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: '23514', hint: 'grounding_snapshot must be a JSON object' },
    });
    const res = await applyChecklistGeneration('a1', PROPOSAL);
    expect(res).toEqual({ ok: false, error: 'grounding_snapshot must be a JSON object' });
  });
});

describe('computeChecklistCurrency', () => {
  const SNAPSHOT: ChecklistGroundingSnapshot = {
    protocol_document_ids: ['pd1'],
    evidence: [{ document_id: 'd1', content_hash: 'abc', title: 'QA SOP v3', source_type: 'SOP' }],
  };

  it('returns null when the checklist was never generated', () => {
    expect(computeChecklistCurrency(null, [evidenceRow({})])).toBeNull();
    expect(computeChecklistCurrency(undefined, [])).toBeNull();
  });

  it('is current when the live register matches the snapshot', () => {
    const currency = computeChecklistCurrency(SNAPSHOT, [evidenceRow({})]);
    expect(currency).toEqual({
      newSinceGeneration: [],
      removedSinceGeneration: [],
      isCurrent: true,
    });
  });

  it('flags a source added after generation', () => {
    const currency = computeChecklistCurrency(SNAPSHOT, [
      evidenceRow({}),
      evidenceRow({ document_id: 'd2', title: 'Training matrix' }),
    ]);
    expect(currency?.isCurrent).toBe(false);
    expect(currency?.newSinceGeneration).toEqual([{ document_id: 'd2', title: 'Training matrix' }]);
    expect(currency?.removedSinceGeneration).toEqual([]);
  });

  it('flags a grounded source removed after generation', () => {
    const currency = computeChecklistCurrency(SNAPSHOT, []);
    expect(currency?.isCurrent).toBe(false);
    expect(currency?.removedSinceGeneration).toEqual([{ document_id: 'd1', title: 'QA SOP v3' }]);
  });

  it('ignores register rows withheld from generation', () => {
    const currency = computeChecklistCurrency(SNAPSHOT, [
      evidenceRow({}),
      evidenceRow({ document_id: 'd3', title: 'Withheld doc', include_in_generation: false }),
    ]);
    expect(currency?.isCurrent).toBe(true);
  });
});
