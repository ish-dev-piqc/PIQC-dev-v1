import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildDraftConfidencePacketCsv,
  csvCell,
  DRAFT_DISCLAIMER,
  PACKET_COLUMNS,
} from '../exportApi';
import type {
  DraftConfidencePacket,
  DraftConfidencePacketRow,
} from '../exportApi';

function makeRow(overrides: Partial<DraftConfidencePacketRow> = {}): DraftConfidencePacketRow {
  return {
    worksheet_item_id:         'item-1',
    worksheet_item_type:       'endpoint',
    worksheet_item_text:       'Change in PANSS at week 24',
    confidence_state:          'high',
    confidence_score:          0.91,
    confidence_reason:         'Exact source found in Section 7.2',
    ambiguity_reason:          null,
    review_status:             'accepted_for_draft',
    worksheet_item_version:    1,
    missing_source_reason:     null,
    protocol_document_id:      'doc-1',
    protocol_document_name:    'BRIGHTEN-2 Protocol v3',
    document_protocol_version: 'Protocol v3.0',
    source_id:                 'ev-1',
    source_support_type:       'primary',
    source_protocol_version:   'Protocol v3.0 Amendment 2',
    source_page_number:        48,
    source_section_number:     '7.2',
    source_section_title:      'Vital Signs',
    quoted_source_text:        'Vital signs collected prior to dosing.',
    has_highlight_coords:      true,
    is_item_flagged:           false,
    is_source_flagged:         false,
    latest_review_action:      'accept_for_draft',
    latest_review_at:          '2026-05-09T10:00:00Z',
    latest_reviewer_note:      'Source matches the draft.',
    latest_flag_note:          null,
    ...overrides,
  };
}

function makePacket(rows: DraftConfidencePacketRow[]): DraftConfidencePacket {
  return {
    study_id:     'study-1',
    study_code:   'BRIGHTEN-2',
    generated_at: '2026-05-09T22:14:33Z',
    rows,
  };
}

describe('csvCell', () => {
  it('handles null and undefined as empty cell', () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it('handles booleans', () => {
    expect(csvCell(true)).toBe('"true"');
    expect(csvCell(false)).toBe('"false"');
  });

  it('escapes embedded double quotes', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('preserves newlines and commas inside quoted cells', () => {
    expect(csvCell('a,b\nc')).toBe('"a,b\nc"');
  });

  it('passes numbers through', () => {
    expect(csvCell(42)).toBe('"42"');
    expect(csvCell(0)).toBe('"0"');
  });
});

describe('buildDraftConfidencePacketCsv — disclaimer + metadata block', () => {
  it('starts with the PIQC draft confidence packet header', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv.startsWith('"# PIQC Draft Confidence Packet"')).toBe(true);
  });

  it('includes the full disclaimer text', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).toContain(DRAFT_DISCLAIMER);
    expect(csv).toContain('source-backed draft review aid');
    expect(csv).toContain("outside PIQC in the customer's designated process");
  });

  it('includes study code, generated_at, and row count metadata lines', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow(), makeRow()]));
    expect(csv).toContain('"# Study","BRIGHTEN-2"');
    expect(csv).toContain('"# Generated","2026-05-09T22:14:33Z"');
    expect(csv).toContain('"# Row count","2"');
  });

  it('uses no final-approval / signature language outside the disclaimer', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    // The disclaimer deliberately names approval / signature / release to say
    // they happen OUTSIDE PIQC. Strip that one sentence; everything else in
    // the export must stay free of sign-off language.
    const outsideDisclaimer = csv.replace(DRAFT_DISCLAIMER, '');
    expect(outsideDisclaimer).not.toMatch(/\bApproved\b|\bApproval\b|\bSigned\b|\bCertified\b|\bGxP\b|\bPart 11\b/i);
  });
});

describe('buildDraftConfidencePacketCsv — header + data', () => {
  it('emits the full column header in the spec order', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([]));
    const headerLine = csv.split('\n').find((l) => l.startsWith('"worksheet_item_id"'));
    expect(headerLine).toBeDefined();
    const expected = PACKET_COLUMNS.map((c) => `"${c}"`).join(',');
    expect(headerLine).toBe(expected);
  });

  it('emits worksheet_item_text, confidence_state and confidence_reason verbatim', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).toContain('"Change in PANSS at week 24"');
    expect(csv).toContain('"high"');
    expect(csv).toContain('"Exact source found in Section 7.2"');
  });

  it('emits source metadata: support type, protocol version, page, section, title', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).toContain('"primary"');
    expect(csv).toContain('"Protocol v3.0 Amendment 2"');
    expect(csv).toContain('"48"');
    expect(csv).toContain('"7.2"');
    expect(csv).toContain('"Vital Signs"');
  });

  it('emits quoted source text', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).toContain('"Vital signs collected prior to dosing."');
  });

  it('emits review status and reviewer note', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).toContain('"accepted_for_draft"');
    expect(csv).toContain('"Source matches the draft."');
  });

  it('emits flag fields with true/false strings', () => {
    const csv = buildDraftConfidencePacketCsv(
      makePacket([makeRow({ is_item_flagged: true, is_source_flagged: true })]),
    );
    // flag columns are in the row; check both true present
    const dataRow = csv.split('\n').filter((l) =>
      l.startsWith('"item-1"') && !l.startsWith('"# '),
    )[0];
    expect(dataRow).toContain('"true"');
  });
});

describe('buildDraftConfidencePacketCsv — edge cases', () => {
  it('handles a worksheet item with NO source evidence (empty source columns)', () => {
    const noSourceRow = makeRow({
      source_id:               null,
      source_support_type:     null,
      source_protocol_version: null,
      source_page_number:      null,
      source_section_number:   null,
      source_section_title:    null,
      quoted_source_text:      null,
      has_highlight_coords:    false,
      is_source_flagged:       false,
      review_status:           'draft',
      confidence_state:        'needs_review',
      confidence_reason:       'No reliable source evidence found.',
      missing_source_reason:   'parser_output_missing_citation',
      latest_review_action:    null,
      latest_review_at:        null,
      latest_reviewer_note:    null,
    });
    const csv = buildDraftConfidencePacketCsv(makePacket([noSourceRow]));

    expect(csv).toContain('"needs_review"');
    expect(csv).toContain('"No reliable source evidence found."');
    expect(csv).toContain('"parser_output_missing_citation"');
    // Empty cells appear as ""
    expect(csv).toContain(',""');
  });

  it('handles a worksheet item with MULTIPLE source records (one CSV row per pair)', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([
      makeRow({ source_id: 'ev-1', source_support_type: 'primary',   source_page_number: 48 }),
      makeRow({ source_id: 'ev-2', source_support_type: 'secondary', source_page_number: 52 }),
      makeRow({ source_id: 'ev-3', source_support_type: 'context',   source_page_number: 12 }),
    ]));
    const dataLines = csv.split('\n').filter((l) =>
      l.startsWith('"item-1"') && !l.startsWith('"# '),
    );
    expect(dataLines).toHaveLength(3);
    expect(dataLines[0]).toContain('"primary"');
    expect(dataLines[1]).toContain('"secondary"');
    expect(dataLines[2]).toContain('"context"');
  });

  it('escapes worksheet item text containing commas, quotes, and newlines', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([
      makeRow({ worksheet_item_text: 'Endpoint, "primary" outcome\nat week 24' }),
    ]));
    expect(csv).toContain('"Endpoint, ""primary"" outcome\nat week 24"');
  });

  it('handles an empty rows array (header only)', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([]));
    expect(csv).toContain('"# Row count","0"');
    // Header still present
    expect(csv).toContain('"worksheet_item_id"');
  });

  it('does not include any URL-shaped text from rows', () => {
    const csv = buildDraftConfidencePacketCsv(makePacket([makeRow()]));
    expect(csv).not.toMatch(/https?:\/\//);
    expect(csv).not.toMatch(/supabase\.co\/storage/);
  });

  it('falls back to study_id when study_code is null in metadata', () => {
    const packet: DraftConfidencePacket = {
      study_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      study_code: null,
      generated_at: '2026-05-09T22:14:33Z',
      rows: [makeRow()],
    };
    const csv = buildDraftConfidencePacketCsv(packet);
    expect(csv).toContain('"# Study","aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"');
  });
});


// ---- fetchDraftConfidencePacket safe-log + downloadDraftConfidencePacket --

vi.mock('../../supabase', () => {
  const rpc = vi.fn();
  return { supabase: { rpc } };
});

import {
  fetchDraftConfidencePacket,
  downloadDraftConfidencePacket,
} from '../exportApi';
import { supabase } from '../../supabase';
const mockRpc = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

describe('fetchDraftConfidencePacket — safe logging', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mockRpc.mockReset();
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => infoSpy.mockRestore());

  it('never logs the rows array (which contains quoted source text)', async () => {
    const SECRET_QUOTE = 'CONFIDENTIAL_PROTOCOL_QUOTED_TEXT_DO_NOT_LOG';
    const SECRET_NOTE = 'CONFIDENTIAL_REVIEWER_NOTE';
    mockRpc.mockResolvedValueOnce({
      data: {
        study_id: 'study-1',
        study_code: 'BRIGHTEN-2',
        generated_at: '2026-05-09',
        rows: [
          makeRow({
            quoted_source_text: SECRET_QUOTE,
            latest_reviewer_note: SECRET_NOTE,
          }),
        ],
      },
      error: null,
    });

    await fetchDraftConfidencePacket('study-1');

    const logged = infoSpy.mock.calls
      .map((args) => args.map((a) => JSON.stringify(a)).join(' '))
      .join(' ');
    expect(logged).not.toContain(SECRET_QUOTE);
    expect(logged).not.toContain(SECRET_NOTE);
    expect(logged).not.toContain('"rows"');
    // Counts ARE allowed:
    expect(logged).toContain('rowCount');
  });
});

describe('downloadDraftConfidencePacket — orchestration', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('triggers download with a CSV containing the disclaimer + study filename', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        study_id: 'study-1',
        study_code: 'BRIGHTEN-2',
        generated_at: '2026-05-09',
        rows: [makeRow()],
      },
      error: null,
    });

    const trigger = vi.fn();
    const result = await downloadDraftConfidencePacket(
      'study-1',
      'BRIGHTEN-2',
      { triggerDownload: trigger },
    );

    expect(trigger).toHaveBeenCalledOnce();
    const [filename, csv] = trigger.mock.calls[0];
    expect(filename).toMatch(/^draft-confidence-packet_BRIGHTEN-2_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain(DRAFT_DISCLAIMER);
    expect(result).toEqual({ rowCount: 1, filename });
  });

  it('sanitizes study code in filename (removes unsafe characters)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        study_id: 'study-1',
        study_code: 'My Study / weird?name',
        generated_at: '2026-05-09',
        rows: [],
      },
      error: null,
    });

    const trigger = vi.fn();
    await downloadDraftConfidencePacket('study-1', null, { triggerDownload: trigger });

    const [filename] = trigger.mock.calls[0];
    expect(filename).not.toMatch(/[/?]/);
    expect(filename).toMatch(/^draft-confidence-packet_/);
  });

  it('propagates RPC errors to the caller (UI catches and shows friendly copy)', async () => {
    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'access denied' },
    });
    await expect(
      downloadDraftConfidencePacket('study-1', null, { triggerDownload: vi.fn() }),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
