// Unit tests for riskSummaryApi's generate-from-protocol inputs.
//
//   1. buildStudyContext / manualStudyContext — the snapshot is built from the
//      Reducto extraction with junk dropped, the audit's phase authoritative,
//      provenance recorded; the manual variant is the honest empty.
//   2. focusAreasFromRisks — domain labels, deduped, alphabetical, drift-safe.
//   3. fetchParsedStudyContext — most recent READY PROTOCOL document only; no
//      row is { ok: true, data: null }, a query error is ok:false.
//   4. linkProtocolRisksToSummary — sequential, reports how far it got.
//
// Mock idiom: auditCreationApi.test.ts (vi.hoisted mocks behind an inline
// supabase module) with a self-returning query chain for the documents read.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { chain, mockRpc } = vi.hoisted(() => {
  const chain = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };
  chain.select.mockImplementation(() => chain);
  chain.eq.mockImplementation(() => chain);
  chain.order.mockImplementation(() => chain);
  chain.limit.mockImplementation(() => chain);
  return { chain, mockRpc: vi.fn() };
});

vi.mock('../../supabase', () => ({
  supabase: {
    from: vi.fn(() => chain),
    rpc: mockRpc,
  },
}));

import {
  buildStudyContext,
  fetchParsedStudyContext,
  focusAreasFromRisks,
  linkProtocolRisksToSummary,
  manualStudyContext,
} from '../riskSummaryApi';

describe('buildStudyContext', () => {
  it('captures therapeutic area and endpoints, records provenance, keeps the audit phase', () => {
    const ctx = buildStudyContext(
      {
        therapeutic_area: '  Oncology — NSCLC ',
        primary_endpoints: ['Overall survival', '', 42, '  PFS '],
        secondary_endpoints: ['ORR'],
        study_phase: 'Phase III',
        sponsor_name: 'Acme Pharma',
      },
      'PHASE_2',
      'doc-1',
      '2026-09-04T10:00:00.000Z',
    );
    expect(ctx).toEqual({
      therapeutic_space: 'Oncology — NSCLC',
      primary_endpoints: ['Overall survival', 'PFS'],
      secondary_endpoints: ['ORR'],
      clinical_trial_phase: 'PHASE_2',
      captured_at: '2026-09-04T10:00:00.000Z',
      source: 'parsed_document',
      source_document_id: 'doc-1',
    });
    // Sponsor-name-free by rule: nothing from sponsor_name leaks into the snapshot.
    expect(JSON.stringify(ctx)).not.toContain('Acme');
  });

  it('treats a non-object or missing extraction as empty fields, never guesses', () => {
    for (const junk of [null, undefined, 'text', 7, ['a']]) {
      const ctx = buildStudyContext(junk, 'PHASE_1', 'doc-1', 't');
      expect(ctx.therapeutic_space).toBe('');
      expect(ctx.primary_endpoints).toEqual([]);
      expect(ctx.secondary_endpoints).toEqual([]);
      expect(ctx.source).toBe('parsed_document');
    }
    expect(buildStudyContext({ primary_endpoints: 'not a list' }, 'PHASE_1', 'd', 't').primary_endpoints).toEqual([]);
  });

  it('manualStudyContext is the honest empty with manual provenance', () => {
    expect(manualStudyContext('PHASE_3', 't')).toEqual({
      therapeutic_space: '',
      primary_endpoints: [],
      secondary_endpoints: [],
      clinical_trial_phase: 'PHASE_3',
      captured_at: 't',
      source: 'manual',
      source_document_id: null,
    });
  });
});

describe('focusAreasFromRisks', () => {
  it('maps domains to labels, dedupes, sorts, and keeps unknown values verbatim', () => {
    expect(
      focusAreasFromRisks([
        { operational_domain_tag: 'ePRO' },
        { operational_domain_tag: 'central_lab' },
        { operational_domain_tag: 'ePRO' },
        { operational_domain_tag: 'mystery_domain' },
        { operational_domain_tag: '' },
      ]),
    ).toEqual(['Central laboratory', 'ePRO platform', 'mystery_domain']);
  });

  it('is empty for no risks', () => {
    expect(focusAreasFromRisks([])).toEqual([]);
  });
});

describe('fetchParsedStudyContext', () => {
  beforeEach(() => {
    chain.maybeSingle.mockReset();
    chain.eq.mockClear();
    chain.order.mockClear();
    chain.limit.mockClear();
  });

  it('reads only the most recent READY PROTOCOL document of the protocol', async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const res = await fetchParsedStudyContext('protocol-1', 'PHASE_2');
    expect(res).toEqual({ ok: true, data: null });
    expect(chain.eq).toHaveBeenCalledWith('protocol_id', 'protocol-1');
    expect(chain.eq).toHaveBeenCalledWith('kind', 'PROTOCOL');
    expect(chain.eq).toHaveBeenCalledWith('status', 'ready');
    expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    expect(chain.limit).toHaveBeenCalledWith(1);
  });

  it('returns the built context with the document id on a row', async () => {
    chain.maybeSingle.mockResolvedValueOnce({
      data: { id: 'doc-7', extracted_fields: { therapeutic_area: 'Cardiology', primary_endpoints: ['MACE'] } },
      error: null,
    });
    const res = await fetchParsedStudyContext('protocol-1', 'PHASE_3');
    expect(res.ok).toBe(true);
    if (!res.ok || !res.data) throw new Error('expected a context');
    expect(res.data.source_document_id).toBe('doc-7');
    expect(res.data.context.therapeutic_space).toBe('Cardiology');
    expect(res.data.context.primary_endpoints).toEqual(['MACE']);
    expect(res.data.context.clinical_trial_phase).toBe('PHASE_3');
    expect(res.data.context.source).toBe('parsed_document');
  });

  it('is ok:false on a query error, never a silent "no document"', async () => {
    chain.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'permission denied' } });
    const res = await fetchParsedStudyContext('protocol-1', 'PHASE_2');
    expect(res).toEqual({ ok: false, error: 'permission denied' });
  });
});

describe('linkProtocolRisksToSummary', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('links every id in order and reports the count', async () => {
    mockRpc.mockResolvedValue({ data: true, error: null });
    const res = await linkProtocolRisksToSummary('sum-1', ['r1', 'r2', 'r3'], 'Linked at generation');
    expect(res).toEqual({ ok: true, data: { linked: 3 } });
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(mockRpc).toHaveBeenNthCalledWith(2, 'audit_mode_link_protocol_risk_to_summary', {
      p_summary_id: 'sum-1',
      p_protocol_risk_id: 'r2',
      p_reason: 'Linked at generation',
    });
  });

  it('stops at the first error and says how far it got', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Risk summary sum-1 not found' } });
    const res = await linkProtocolRisksToSummary('sum-1', ['r1', 'r2', 'r3']);
    expect(res).toEqual({ ok: false, error: 'Risk summary sum-1 not found (1 of 3 linked)' });
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('is a no-op for an empty id list', async () => {
    const res = await linkProtocolRisksToSummary('sum-1', []);
    expect(res).toEqual({ ok: true, data: { linked: 0 } });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
