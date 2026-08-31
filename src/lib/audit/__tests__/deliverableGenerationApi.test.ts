// Unit tests for deliverableGenerationApi (PR-C1 checklist, PR-C2 fan-out).
//
// Locks the contracts that keep generation honest at the API boundary:
//   - no session is a hard fail (never the anon key), and a thrown fetch maps
//     to a Result error so the caller's busy state can't stick
//   - apply routes each deliverable to its own RPC and sends the proposal's
//     OWN grounding through verbatim — the snapshot records what generation
//     saw, not what the client believes
//   - the letter's recipients are merged client-side at apply — generation
//     never sees or emits them
//   - computeDeliverableCurrency: pure set-diff, flag-never-block semantics,
//     null when the deliverable was never generated
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
  applyDeliverableGeneration,
  computeDeliverableCurrency,
  requestDeliverableDraft,
  type DeliverableDraftProposal,
} from '../deliverableGenerationApi';
import type { AuditEvidenceListRow, DeliverableGroundingSnapshot } from '../../../types/audit';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const SESSION = { data: { session: { access_token: 'jwt-token' } } };

const GROUNDING: DeliverableGroundingSnapshot = {
  protocol_document_ids: ['pd1'],
  evidence: [{ document_id: 'd1', content_hash: 'abc', title: 'QA SOP v3', source_type: 'SOP' }],
};

const CHECKLIST_PROPOSAL: DeliverableDraftProposal = {
  mode: 'generate',
  deliverable: 'checklist',
  content_patch: {
    items: [
      { id: 'i1', prompt: 'Verify SOP index is current', checkpoint_ref: null, evidence_expected: true },
    ],
  },
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
  grounding: GROUNDING,
  dropped_count: 0,
  stripped_ref_count: 0,
  protocol_source: 'ready',
  evidence_doc_count: 1,
};

const LETTER_PROPOSAL: DeliverableDraftProposal = {
  ...CHECKLIST_PROPOSAL,
  deliverable: 'confirmation_letter',
  mode: 'revise',
  content_patch: {
    body_text: 'This letter confirms the audit…',
    scope: ['Quality management system', 'Data integrity'],
  },
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

describe('requestDeliverableDraft', () => {
  beforeEach(() => {
    mockGetSession.mockReset();
    mockFetch.mockReset();
  });

  it('hard-fails without a session and never calls fetch', async () => {
    mockGetSession.mockResolvedValueOnce({ data: { session: null } });
    const res = await requestDeliverableDraft('a1', 'agenda');
    expect(res.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('posts the audit id + deliverable and returns the proposal', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => CHECKLIST_PROPOSAL });
    const res = await requestDeliverableDraft('a1', 'checklist');

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain('/functions/v1/audit-deliverable-draft');
    expect(init.headers.Authorization).toBe('Bearer jwt-token');
    expect(JSON.parse(init.body)).toEqual({ audit_id: 'a1', deliverable: 'checklist' });
    expect(res).toEqual({ ok: true, data: CHECKLIST_PROPOSAL });
  });

  it('surfaces the server error message on a non-OK response', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: 'Deliverable drafting is only available on vendor audits' }),
    });
    const res = await requestDeliverableDraft('a1', 'agenda');
    expect(res).toEqual({
      ok: false,
      error: 'Deliverable drafting is only available on vendor audits',
    });
  });

  it('maps a thrown fetch (network drop) to a Result error — busy state must never stick', async () => {
    mockGetSession.mockResolvedValueOnce(SESSION);
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const res = await requestDeliverableDraft('a1', 'confirmation_letter');
    expect(res.ok).toBe(false);
  });
});

describe('applyDeliverableGeneration', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('routes the checklist to its RPC with items content and generate attribution', async () => {
    mockRpc.mockResolvedValueOnce({ data: { id: 'ch1' }, error: null });
    const res = await applyDeliverableGeneration('a1', CHECKLIST_PROPOSAL);
    expect(mockRpc).toHaveBeenCalledWith('audit_mode_apply_checklist_generation', {
      p_audit_id: 'a1',
      p_content: { items: CHECKLIST_PROPOSAL.content_patch.items },
      p_generation_refs: CHECKLIST_PROPOSAL.generation_refs,
      p_grounding_snapshot: CHECKLIST_PROPOSAL.grounding,
      p_reason: 'Checklist drafted by PIQC from protocol + evidence',
    });
    expect(res).toEqual({ ok: true, data: null });
  });

  it('routes the agenda to its RPC with revise attribution', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await applyDeliverableGeneration('a1', {
      ...CHECKLIST_PROPOSAL,
      deliverable: 'agenda',
      mode: 'revise',
    });
    const [rpcName, args] = mockRpc.mock.calls[0];
    expect(rpcName).toBe('audit_mode_apply_agenda_generation');
    expect(args.p_reason).toBe('Agenda revised by PIQC from protocol + evidence');
  });

  it('merges current recipients into letter content — generation never emits them', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await applyDeliverableGeneration('a1', LETTER_PROPOSAL, {
      currentRecipients: ['Quality Assurance Team'],
    });
    const [rpcName, args] = mockRpc.mock.calls[0];
    expect(rpcName).toBe('audit_mode_apply_confirmation_letter_generation');
    expect(args.p_content).toEqual({
      body_text: 'This letter confirms the audit…',
      scope: ['Quality management system', 'Data integrity'],
      recipients: ['Quality Assurance Team'],
    });
  });

  it('defaults letter recipients to empty when none are supplied', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await applyDeliverableGeneration('a1', LETTER_PROPOSAL);
    expect(mockRpc.mock.calls[0][1].p_content.recipients).toEqual([]);
  });

  it('routes the internal notification letter-shaped WITHOUT a recipients field (PR-D1)', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await applyDeliverableGeneration(
      'a1',
      { ...LETTER_PROPOSAL, deliverable: 'internal_notification', mode: 'generate' },
      // Even if a caller passes recipients, the notification content must
      // never carry them — the deliverable is name-free by design.
      { currentRecipients: ['Quality Assurance Team'] },
    );
    const [rpcName, args] = mockRpc.mock.calls[0];
    expect(rpcName).toBe('audit_mode_apply_internal_notification_generation');
    expect(args.p_content).toEqual({
      body_text: 'This letter confirms the audit…',
      scope: ['Quality management system', 'Data integrity'],
    });
    expect(args.p_reason).toBe('Internal notification drafted by PIQC from protocol + evidence');
  });

  it('prefers the RPC hint over the raw message on failure', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { message: '23514', hint: 'grounding_snapshot must be a JSON object' },
    });
    const res = await applyDeliverableGeneration('a1', CHECKLIST_PROPOSAL);
    expect(res).toEqual({ ok: false, error: 'grounding_snapshot must be a JSON object' });
  });
});

describe('computeDeliverableCurrency', () => {
  const SNAPSHOT = GROUNDING;

  it('returns null when the deliverable was never generated', () => {
    expect(computeDeliverableCurrency(null, [evidenceRow({})])).toBeNull();
    expect(computeDeliverableCurrency(undefined, [])).toBeNull();
  });

  it('is current when the live register matches the snapshot', () => {
    const currency = computeDeliverableCurrency(SNAPSHOT, [evidenceRow({})]);
    expect(currency).toEqual({
      newSinceGeneration: [],
      removedSinceGeneration: [],
      isCurrent: true,
    });
  });

  it('flags a source added after generation', () => {
    const currency = computeDeliverableCurrency(SNAPSHOT, [
      evidenceRow({}),
      evidenceRow({ document_id: 'd2', title: 'Training matrix' }),
    ]);
    expect(currency?.isCurrent).toBe(false);
    expect(currency?.newSinceGeneration).toEqual([{ document_id: 'd2', title: 'Training matrix' }]);
    expect(currency?.removedSinceGeneration).toEqual([]);
  });

  it('flags a grounded source removed after generation', () => {
    const currency = computeDeliverableCurrency(SNAPSHOT, []);
    expect(currency?.isCurrent).toBe(false);
    expect(currency?.removedSinceGeneration).toEqual([{ document_id: 'd1', title: 'QA SOP v3' }]);
  });

  it('ignores register rows withheld from generation', () => {
    const currency = computeDeliverableCurrency(SNAPSHOT, [
      evidenceRow({}),
      evidenceRow({ document_id: 'd3', title: 'Withheld doc', include_in_generation: false }),
    ]);
    expect(currency?.isCurrent).toBe(true);
  });
});
