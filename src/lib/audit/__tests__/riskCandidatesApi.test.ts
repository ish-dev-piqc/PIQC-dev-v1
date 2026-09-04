// Unit tests for the risk-candidate read path.
//
//   1. Query shape — ready documents of the protocol only, the four candidate
//      field types, never quoted_text (neither select names it).
//   2. Evidence merge — the primary link's section/page land on the item;
//      items without one get nulls; an array-shaped embed is tolerated.
//   3. Empty items short-circuit (no evidence query); errors are ok:false.
//   4. Large worksheets chunk the evidence lookup.
//
// Mock idiom: riskSummaryApi.test.ts (vi.hoisted self-returning chains), one
// chain per table because the two queries end on different methods.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { itemsChain, linksChain, mockFrom } = vi.hoisted(() => {
  const itemsChain = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), order: vi.fn() };
  itemsChain.select.mockImplementation(() => itemsChain);
  itemsChain.eq.mockImplementation(() => itemsChain);
  itemsChain.in.mockImplementation(() => itemsChain);

  const linksChain = { select: vi.fn(), in: vi.fn(), eq: vi.fn() };
  linksChain.select.mockImplementation(() => linksChain);
  linksChain.in.mockImplementation(() => linksChain);

  const mockFrom = vi.fn((table: string) =>
    table === 'protocol_extracted_items' ? itemsChain : linksChain,
  );
  return { itemsChain, linksChain, mockFrom };
});

vi.mock('../../supabase', () => ({
  supabase: { from: mockFrom },
}));

import { fetchCandidateSourceItems } from '../riskCandidatesApi';

function itemRow(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    document_id: 'doc-1',
    field_path: `primary_endpoints[${id}]`,
    field_type: 'endpoint',
    extracted_value: `Endpoint ${id}`,
    confidence_state: 'high',
    review_status: 'draft',
    current_text: null,
    documents: { protocol_id: 'protocol-1', status: 'ready' },
    ...patch,
  };
}

beforeEach(() => {
  mockFrom.mockClear();
  itemsChain.select.mockClear();
  itemsChain.eq.mockClear();
  itemsChain.in.mockClear();
  itemsChain.order.mockReset();
  linksChain.select.mockClear();
  linksChain.in.mockClear();
  linksChain.eq.mockReset();
});

describe('fetchCandidateSourceItems — query shape', () => {
  it('reads candidate-type items of the protocol from READY documents and never the quoted text', async () => {
    itemsChain.order.mockResolvedValue({ data: [itemRow('1')], error: null });
    linksChain.eq.mockResolvedValue({ data: [], error: null });

    await fetchCandidateSourceItems('protocol-1');

    expect(mockFrom).toHaveBeenCalledWith('protocol_extracted_items');
    const itemSelect = itemsChain.select.mock.calls[0][0] as string;
    expect(itemSelect).toContain('documents!inner(protocol_id, status)');
    expect(itemSelect).not.toContain('quoted_text');
    expect(itemsChain.eq).toHaveBeenCalledWith('documents.protocol_id', 'protocol-1');
    expect(itemsChain.eq).toHaveBeenCalledWith('documents.status', 'ready');
    expect(itemsChain.in).toHaveBeenCalledWith('field_type', ['endpoint', 'dosing', 'visit', 'criterion']);

    expect(mockFrom).toHaveBeenCalledWith('protocol_item_evidence_links');
    const linkSelect = linksChain.select.mock.calls[0][0] as string;
    expect(linkSelect).toContain('protocol_source_evidence(section_number, page_number)');
    expect(linkSelect).not.toContain('quoted_text');
    expect(linksChain.in).toHaveBeenCalledWith('extracted_item_id', ['1']);
    expect(linksChain.eq).toHaveBeenCalledWith('is_primary_source', true);
  });
});

describe('fetchCandidateSourceItems — evidence merge', () => {
  it('attaches the primary evidence coordinates and nulls the rest', async () => {
    itemsChain.order.mockResolvedValue({
      data: [itemRow('1', { review_status: undefined, current_text: undefined }), itemRow('2', { current_text: 'edited' })],
      error: null,
    });
    linksChain.eq.mockResolvedValue({
      data: [
        { extracted_item_id: '2', protocol_source_evidence: { section_number: '5.1', page_number: 12 } },
        // a second primary link for the same item is ignored
        { extracted_item_id: '2', protocol_source_evidence: { section_number: '9.9', page_number: 99 } },
      ],
      error: null,
    });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result).toEqual({
      ok: true,
      data: [
        expect.objectContaining({
          id: '1',
          review_status: null,
          current_text: null,
          section_number: null,
          page_number: null,
        }),
        expect.objectContaining({
          id: '2',
          current_text: 'edited',
          section_number: '5.1',
          page_number: 12,
        }),
      ],
    });
    // The joined documents row does not leak onto the item.
    if (result.ok) expect(result.data[0]).not.toHaveProperty('documents');
  });

  it('tolerates an array-shaped evidence embed', async () => {
    itemsChain.order.mockResolvedValue({ data: [itemRow('1')], error: null });
    linksChain.eq.mockResolvedValue({
      data: [{ extracted_item_id: '1', protocol_source_evidence: [{ section_number: '3', page_number: null }] }],
      error: null,
    });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result.ok && result.data[0].section_number).toBe('3');
    expect(result.ok && result.data[0].page_number).toBeNull();
  });
});

describe('fetchCandidateSourceItems — edges and errors', () => {
  it('returns an empty list without querying evidence when there are no items', async () => {
    itemsChain.order.mockResolvedValue({ data: [], error: null });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result).toEqual({ ok: true, data: [] });
    expect(mockFrom).not.toHaveBeenCalledWith('protocol_item_evidence_links');
  });

  it('is ok:false when the item query fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    itemsChain.order.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result).toEqual({ ok: false, error: 'permission denied' });
    expect(linksChain.eq).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('is ok:false when the evidence query fails — identifiers must not silently degrade', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    itemsChain.order.mockResolvedValue({ data: [itemRow('1')], error: null });
    linksChain.eq.mockResolvedValue({ data: null, error: { message: 'timeout' } });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result).toEqual({ ok: false, error: 'timeout' });
    errorSpy.mockRestore();
  });

  it('chunks the evidence lookup by 100 item ids', async () => {
    const rows = Array.from({ length: 250 }, (_, i) => itemRow(String(i)));
    itemsChain.order.mockResolvedValue({ data: rows, error: null });
    linksChain.eq.mockResolvedValue({ data: [], error: null });

    const result = await fetchCandidateSourceItems('protocol-1');

    expect(result.ok).toBe(true);
    const sizes = linksChain.in.mock.calls.map((call) => (call[1] as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
  });
});
