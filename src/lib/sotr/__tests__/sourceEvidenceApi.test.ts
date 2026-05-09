// Unit tests for the review-screen client wrappers.
//
// The RPC bodies (auth, study membership, sort order, sensitive-data
// handling) are covered by smoke tests against a real Supabase in
// scripts/smoke-rpcs.sh (T18–T26). Here we cover only the client-side
// invariants: batch-size guard, safe-log shape, and the constant value.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchWorksheetItemSourceEvidence,
  fetchWorksheetItemsSourceEvidenceBatch,
  WorksheetItemBatchTooLargeError,
} from '../sourceEvidenceApi';
import { MAX_WORKSHEET_ITEM_BATCH_SIZE } from '../../../types/sotr';

// Mock the Supabase client used by the API module.
vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('MAX_WORKSHEET_ITEM_BATCH_SIZE', () => {
  it('matches the RPC-side limit (100)', () => {
    expect(MAX_WORKSHEET_ITEM_BATCH_SIZE).toBe(100);
  });
});

describe('fetchWorksheetItemsSourceEvidenceBatch — client-side validation', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('rejects more than MAX_WORKSHEET_ITEM_BATCH_SIZE ids without calling the RPC', async () => {
    const tooMany = Array.from(
      { length: MAX_WORKSHEET_ITEM_BATCH_SIZE + 1 },
      (_, i) => `id-${i}`,
    );

    await expect(
      fetchWorksheetItemsSourceEvidenceBatch('study-1', tooMany),
    ).rejects.toBeInstanceOf(WorksheetItemBatchTooLargeError);

    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('accepts exactly MAX_WORKSHEET_ITEM_BATCH_SIZE ids', async () => {
    const justRight = Array.from(
      { length: MAX_WORKSHEET_ITEM_BATCH_SIZE },
      (_, i) => `id-${i}`,
    );
    mockRpc.mockResolvedValueOnce({ data: { items: [] }, error: null });

    await expect(
      fetchWorksheetItemsSourceEvidenceBatch('study-1', justRight),
    ).resolves.toEqual({ items: [] });

    expect(mockRpc).toHaveBeenCalledOnce();
  });

  it('accepts an empty list and forwards it to the RPC', async () => {
    mockRpc.mockResolvedValueOnce({ data: { items: [] }, error: null });

    const result = await fetchWorksheetItemsSourceEvidenceBatch('study-1', []);
    expect(result).toEqual({ items: [] });
  });
});

describe('fetchWorksheetItemSourceEvidence — safe logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRpc.mockReset();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('does not log source_text or full sources payload', async () => {
    const sensitiveText = 'CONFIDENTIAL_PROTOCOL_PASSAGE_DO_NOT_LOG';
    mockRpc.mockResolvedValueOnce({
      data: {
        worksheet_item_id:     'item-1',
        confidence_state:      'high',
        confidence_score:      0.91,
        confidence_reason:     'Exact source found',
        ambiguity_reason:      null,
        missing_source_reason: null,
        sources: [
          {
            id: 'ev-1', support_type: 'primary',
            protocol_document_id: 'doc-1', protocol_version: 'v3',
            page_number: 48, section_number: '7.2', section_title: 'Vital Signs',
            source_text: sensitiveText,
            text_start_offset: 0, text_end_offset: 50,
            bounding_boxes: [], extraction_confidence: 0.94,
            relevance_score: 0.98, is_primary: true,
          },
        ],
      },
      error: null,
    });

    await fetchWorksheetItemSourceEvidence('study-1', 'item-1');

    // Walk every argument logged and assert the sensitive string is absent.
    const allLoggedJson = infoSpy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join(' ');

    expect(allLoggedJson).not.toContain(sensitiveText);
    expect(allLoggedJson).not.toContain('source_text');
    expect(allLoggedJson).not.toContain('"sources"');
    // Counts and IDs are fine to log.
    expect(allLoggedJson).toContain('sourceCount');
    expect(allLoggedJson).toContain('confidenceState');
  });

  it('batch wrapper logs only counts, not the items array', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        items: [
          {
            worksheet_item_id: 'item-1',
            confidence_state: 'high',
            sources: [{ source_text: 'SECRET_TEXT_BATCH' }],
          },
        ],
      },
      error: null,
    });

    await fetchWorksheetItemsSourceEvidenceBatch('study-1', ['item-1']);

    const allLoggedJson = infoSpy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join(' ');

    expect(allLoggedJson).not.toContain('SECRET_TEXT_BATCH');
    expect(allLoggedJson).not.toContain('"items"');
    expect(allLoggedJson).toContain('requestedCount');
    expect(allLoggedJson).toContain('returnedCount');
  });
});
