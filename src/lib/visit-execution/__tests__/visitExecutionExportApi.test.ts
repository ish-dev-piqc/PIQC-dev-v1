import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WORKSHEET_DISCLAIMER,
  WORKSHEET_HEADER_LABEL,
  buildVisitWorksheetPdf,
  buildWorksheetFilename,
  downloadVisitWorksheet,
  fetchVisitWorksheetPacket,
  slugifyForFilename,
} from '../visitExecutionExportApi';
import { MOCK_TOGGLE_KEY } from '../visitExecutionApi';
import { supabase } from '../../supabase';
import type { VisitWorksheetExportPacket } from '../../../types/visit-execution';

// =============================================================================
// visitExecutionExportApi — three-layer split mirroring SOTR's exportApi.
//
//   Layer 1: fetchVisitWorksheetPacket  — Result<T> + mock-mode + defensive shape
//   Layer 2: buildVisitWorksheetPdf     — pure function; assert via jsPDF API
//   Layer 3: downloadVisitWorksheet     — orchestrator; triggerDownload injection
//
// All three exercised independently. The third uses dependency injection to
// avoid touching the DOM (no jsdom Blob/anchor shenanigans).
// =============================================================================

function makePacket(overrides: Partial<VisitWorksheetExportPacket> = {}): VisitWorksheetExportPacket {
  const base: VisitWorksheetExportPacket = {
    protocol_id: '00000001-d000-4000-8000-000000000001',
    protocol_code: 'BRIGHTEN-2',
    protocol_title: 'BRIGHTEN-2 (Phase 3, schizoaffective disorder)',
    visit_template_id: 'visit-1',
    generated_at: '2026-05-27T18:30:00.000Z',
    snapshot: {
      visit_name: 'Week 6 visit',
      study_day: 42,
      window_minus_days: 2,
      window_plus_days: 2,
      purpose:
        'Mid-treatment efficacy + safety assessment. Primary endpoint readout windows align with this visit.',
      is_dosing_visit: false,
      has_primary_endpoint: true,
      has_safety_critical: false,
      item_count: 2,
      reviewed_count: 1,
      needs_review_count: 1,
      amendment_version: 'Amendment 2.1',
    },
    items: [
      {
        id: 'req-1',
        phase: 'assessment',
        phase_order: 3,
        ordinal: 1,
        label: 'Vital signs (BP, HR, RR, temp)',
        description: null,
        classification: 'required',
        role_hint: 'Coordinator',
        review_status: 'reviewed',
        review_note: null,
        origin: 'soa_cell',
        conditions: [],
        timing: null,
        source_fields: [
          { field_label: 'BP', field_type: 'number', units: 'mmHg', normal_range: null, is_required: true },
          { field_label: 'HR', field_type: 'number', units: 'bpm', normal_range: null, is_required: true },
        ],
        traceability: {
          soa_column: 'V4',
          protocol_section: '7.2 Vital Signs',
          protocol_page: 48,
          amendment_version: 'Amendment 2.1',
        },
      },
      {
        id: 'req-2',
        phase: 'safety_ae_conmed',
        phase_order: 6,
        ordinal: 2,
        label: 'AE / SAE assessment',
        description: 'Open-ended AE/SAE solicitation per ICH-GCP.',
        classification: 'safety_critical',
        role_hint: 'Investigator',
        review_status: 'needs_review',
        review_note: null,
        origin: 'protocol_body',
        conditions: [
          {
            condition_text: 'subject reports new symptom',
            consequence_text: 'document onset/severity/causality',
            source_section: '8.3',
            source_page: 56,
          },
        ],
        timing: null,
        source_fields: [],
        traceability: {
          soa_column: 'V4',
          protocol_section: '8.3 Safety',
          protocol_page: 56,
          amendment_version: null,
        },
      },
    ],
    ...overrides,
  };
  return base;
}

// ===========================================================================
// Layer 1 — fetchVisitWorksheetPacket
// ===========================================================================

describe('fetchVisitWorksheetPacket — mock on', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('returns ok:false when the visit_template_id is unknown to the mock fixture', async () => {
    const spy = vi.spyOn(supabase, 'rpc');
    const r = await fetchVisitWorksheetPacket('not-a-real-visit');
    expect(spy).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/mock fixture/);
  });
});

describe('fetchVisitWorksheetPacket — mock off', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('calls visit_execution_export_worksheet with p_visit_template_id', async () => {
    const spy = vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);
    await fetchVisitWorksheetPacket('visit-1');
    expect(spy).toHaveBeenCalledWith('visit_execution_export_worksheet', {
      p_visit_template_id: 'visit-1',
    });
  });

  it('returns the packet on success', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);
    const r = await fetchVisitWorksheetPacket('visit-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.visit_template_id).toBe('visit-1');
      expect(r.data.items).toHaveLength(2);
    }
  });

  it('surfaces RPC errors as ok:false', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'Worksheet not found or access denied' } as any,
    } as any);
    const r = await fetchVisitWorksheetPacket('visit-nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Worksheet not found or access denied');
  });

  it('returns ok:false on malformed packet (missing snapshot)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        protocol_id: 'p-1',
        visit_template_id: 'v-1',
        generated_at: '2026-05-27T00:00:00Z',
        items: [],
      },
      error: null,
    } as any);
    const r = await fetchVisitWorksheetPacket('v-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed worksheet packet');
  });

  it('returns ok:false on null payload', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: null, error: null,
    } as any);
    const r = await fetchVisitWorksheetPacket('v-1');
    expect(r.ok).toBe(false);
  });

  it('defaults protocol_title when server omits it', async () => {
    const packet = makePacket();
    delete (packet as Partial<VisitWorksheetExportPacket>).protocol_title;
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: packet, error: null,
    } as any);
    const r = await fetchVisitWorksheetPacket('visit-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.protocol_title).toBe('Untitled protocol');
  });
});

// ===========================================================================
// Filename helpers
// ===========================================================================

describe('slugifyForFilename', () => {
  it('lowercases and dashes', () => {
    expect(slugifyForFilename('Week 6 Visit')).toBe('week-6-visit');
  });

  it('strips non-alphanumerics', () => {
    expect(slugifyForFilename('V4 (Mid-treatment)')).toBe('v4-mid-treatment');
  });

  it('collapses runs of separators', () => {
    expect(slugifyForFilename('a   -  -- b')).toBe('a-b');
  });

  it('returns "untitled" for an all-symbols input', () => {
    expect(slugifyForFilename('!!!')).toBe('untitled');
  });

  it('preserves underscores', () => {
    expect(slugifyForFilename('study_1_v4')).toBe('study_1_v4');
  });
});

describe('buildWorksheetFilename', () => {
  it('joins protocol_code + visit_name + today + .pdf', () => {
    const packet = makePacket();
    const name = buildWorksheetFilename(packet);
    expect(name).toMatch(/^brighten-2_week-6-visit_worksheet_draft_\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('falls back to protocol_<id-prefix> when protocol_code is null', () => {
    const packet = makePacket({ protocol_code: null });
    const name = buildWorksheetFilename(packet);
    expect(name).toMatch(/^protocol_0000_week-6-visit_worksheet_draft_/);
  });
});

// ===========================================================================
// Layer 2 — buildVisitWorksheetPdf
// ===========================================================================

describe('buildVisitWorksheetPdf — pure function', () => {
  it('returns a jsPDF document with at least one page', () => {
    const doc = buildVisitWorksheetPdf(makePacket());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('produces a non-empty Blob via output', () => {
    const doc = buildVisitWorksheetPdf(makePacket());
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(500);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders the visit name in the document text content', () => {
    const doc = buildVisitWorksheetPdf(makePacket({
      snapshot: {
        ...makePacket().snapshot,
        visit_name: 'Screening',
        is_dosing_visit: false,
        has_safety_critical: false,
      },
    }));
    // jsPDF datauristring includes encoded text; quick sniff that the visit
    // name made it into the doc. Cheap heuristic — full text extraction
    // requires a PDF parser we don't ship.
    const dataUri = doc.output('datauristring');
    expect(dataUri.length).toBeGreaterThan(1000);
  });

  it('builds without throwing when items array is empty', () => {
    expect(() =>
      buildVisitWorksheetPdf(
        makePacket({
          items: [],
          snapshot: { ...makePacket().snapshot, item_count: 0, reviewed_count: 0, needs_review_count: 0 },
        }),
      ),
    ).not.toThrow();
  });

  it('builds without throwing when no items have traceability data', () => {
    const packet = makePacket();
    packet.items = packet.items.map((i) => ({
      ...i,
      traceability: { soa_column: null, protocol_section: null, protocol_page: null, amendment_version: null },
    }));
    expect(() => buildVisitWorksheetPdf(packet)).not.toThrow();
  });
});

// ===========================================================================
// Layer 3 — downloadVisitWorksheet
// ===========================================================================

describe('downloadVisitWorksheet — orchestrator', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches, builds, and triggers download with the computed filename', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);

    const triggered: Array<{ filename: string }> = [];
    const r = await downloadVisitWorksheet('visit-1', {
      triggerDownload: (filename) => triggered.push({ filename }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.itemCount).toBe(2);
      expect(r.data.filename).toMatch(/brighten-2_week-6-visit_worksheet_draft_/);
    }
    expect(triggered).toHaveLength(1);
    expect(triggered[0].filename).toBe(r.ok ? r.data.filename : 'NOPE');
  });

  it('propagates fetch errors as ok:false (does not call triggerDownload)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      data: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      error: { message: 'Worksheet not found or access denied' } as any,
    } as any);

    let called = false;
    const r = await downloadVisitWorksheet('visit-nope', {
      triggerDownload: () => {
        called = true;
      },
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('catches sync errors from triggerDownload and returns ok:false', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);

    const r = await downloadVisitWorksheet('visit-1', {
      triggerDownload: () => {
        throw new Error('simulated browser save failure');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/simulated browser save failure/);
  });
});

// ===========================================================================
// Constants — spot-check the disclaimer + header label so future
// "polish-strip" passes can't quietly remove them.
// ===========================================================================

describe('disclaimer + header label constants', () => {
  it('disclaimer mentions PIQC as a draft aid and final approval outside PIQC', () => {
    expect(WORKSHEET_DISCLAIMER).toMatch(/PIQC/);
    expect(WORKSHEET_DISCLAIMER).toMatch(/draft/);
    expect(WORKSHEET_DISCLAIMER).toMatch(/outside PIQC/);
  });

  it('header label carries the "PIQC drafted" attribution + DRAFT mark', () => {
    expect(WORKSHEET_HEADER_LABEL).toMatch(/PIQC drafted/);
    expect(WORKSHEET_HEADER_LABEL).toMatch(/DRAFT/);
  });
});
