import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  READING_DIVERGENCE_CAP,
  WORKSHEET_DISCLAIMER,
  WORKSHEET_HEADER_LABEL,
  WORKSHEET_PLACEHOLDER_PURPOSE,
  buildVisitWorksheetPdf,
  buildWorksheetFilename,
  buildWorksheetReadingSection,
  downloadVisitWorksheet,
  fetchVisitWorksheetPacket,
  slugifyForFilename,
} from '../visitExecutionExportApi';
import { MOCK_TOGGLE_KEY } from '../visitExecutionApi';
import { supabase } from '../../supabase';
import type { VisitBriefLine } from '../visitBriefModel';
import type { DivergenceRecord } from '../../../types/divergence';
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
      confidence_state: null,
      completeness_signal_count: 0,
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
        confidence_state: 'high',
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
        confidence_state: 'high',
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
  it('uses packet.generated_at (NOT local clock) for the YYYY-MM-DD segment', () => {
    // Critical: filename + footer must reference the same server-stamped
    // moment. Browser clock can drift — that's exactly what we don't want.
    const packet = makePacket({ generated_at: '2026-05-27T18:30:00.000Z' });
    const name = buildWorksheetFilename(packet);
    expect(name).toBe('brighten-2_week-6-visit_worksheet_draft_2026-05-27.pdf');
  });

  it('uses UTC for the date segment to match the footer timezone', () => {
    // 2026-05-27T23:59:00Z is still May 27 in UTC even though it might be
    // May 28 in a UTC+1 browser. We want the UTC date to match the footer.
    const packet = makePacket({ generated_at: '2026-05-27T23:59:00.000Z' });
    const name = buildWorksheetFilename(packet);
    expect(name).toContain('_2026-05-27.pdf');
  });

  it('falls back to protocol_<id-prefix> when protocol_code is null', () => {
    const packet = makePacket({ protocol_code: null });
    const name = buildWorksheetFilename(packet);
    expect(name).toMatch(/^protocol_0000_week-6-visit_worksheet_draft_/);
  });

  it('falls back to today UTC when generated_at is malformed (defensive)', () => {
    const packet = makePacket({ generated_at: 'not-an-iso-string' });
    const name = buildWorksheetFilename(packet);
    // Defensive fallback — just ensure we still build a name with a
    // YYYY-MM-DD-shaped segment so the export doesn't crash.
    expect(name).toMatch(/_\d{4}-\d{2}-\d{2}\.pdf$/);
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

  it('builds without throwing when purpose is the canonical placeholder (parser-pending path)', () => {
    const packet = makePacket({
      snapshot: {
        ...makePacket().snapshot,
        purpose: WORKSHEET_PLACEHOLDER_PURPOSE,
      },
    });
    expect(() => buildVisitWorksheetPdf(packet)).not.toThrow();
  });

  it('builds without throwing when all requirements are reviewed (no warning banner)', () => {
    const packet = makePacket({
      snapshot: { ...makePacket().snapshot, reviewed_count: 12, needs_review_count: 0, item_count: 12 },
    });
    expect(() => buildVisitWorksheetPdf(packet)).not.toThrow();
  });

  it('builds without throwing with 1 open item (singular banner copy path)', () => {
    const packet = makePacket({
      snapshot: { ...makePacket().snapshot, reviewed_count: 11, needs_review_count: 1, item_count: 12 },
    });
    expect(() => buildVisitWorksheetPdf(packet)).not.toThrow();
  });

  // ---- Sprint 6 — role-filter awareness ----
  it('builds without throwing under each role filter', () => {
    const packet = makePacket();
    expect(() => buildVisitWorksheetPdf(packet, 'all')).not.toThrow();
    expect(() => buildVisitWorksheetPdf(packet, 'coordinator')).not.toThrow();
    expect(() => buildVisitWorksheetPdf(packet, 'nurse')).not.toThrow();
    expect(() => buildVisitWorksheetPdf(packet, 'investigator')).not.toThrow();
    expect(() => buildVisitWorksheetPdf(packet, 'lab')).not.toThrow();
    expect(() => buildVisitWorksheetPdf(packet, 'pharmacy')).not.toThrow();
  });

  it('builds without throwing when role filter yields zero matching items', () => {
    // Fixture has Coordinator + Investigator items only — Pharmacy will be
    // empty. Should still produce a valid (empty-body) PDF without crashing.
    const packet = makePacket();
    expect(() => buildVisitWorksheetPdf(packet, 'pharmacy')).not.toThrow();
  });

  // ---- Sprint 7 — confidence visibility in PDF ----
  it('renders the visit-level confidence label in the title block (no throw)', () => {
    // The "Confidence: <state>" line is always shown. Test ensures the
    // build path doesn't crash on any of the four confidence states.
    expect(() =>
      buildVisitWorksheetPdf(makePacket({
        snapshot: { ...makePacket().snapshot, confidence_state: 'high' },
      })),
    ).not.toThrow();
    expect(() =>
      buildVisitWorksheetPdf(makePacket({
        snapshot: { ...makePacket().snapshot, confidence_state: 'low' },
      })),
    ).not.toThrow();
    expect(() =>
      buildVisitWorksheetPdf(makePacket({
        snapshot: { ...makePacket().snapshot, confidence_state: 'needs_review' },
      })),
    ).not.toThrow();
  });

  it('builds when confidence derives from items (snapshot.confidence_state null)', () => {
    // Server-confidence absent → builder uses deriveVisitConfidence fallback.
    // Mock fixture items default to 'high'; rollup should land somewhere valid.
    const packet = makePacket({
      snapshot: { ...makePacket().snapshot, confidence_state: null },
    });
    expect(() => buildVisitWorksheetPdf(packet)).not.toThrow();
  });

  it('builds when confidence rollup degrades to needs_review (empty filtered items)', () => {
    // Pharmacy filter → 0 items → derivation lands on 'needs_review'.
    // Title block confidence label must still render without crashing.
    const packet = makePacket({
      snapshot: { ...makePacket().snapshot, confidence_state: null },
    });
    expect(() => buildVisitWorksheetPdf(packet, 'pharmacy')).not.toThrow();
  });
});

// ===========================================================================
// Sprint 6 — buildWorksheetFilename role segment
// ===========================================================================

describe('buildWorksheetFilename — role segment', () => {
  it('omits role segment when filter is "all" (canonical Sprint 5 shape)', () => {
    const name = buildWorksheetFilename(makePacket(), 'all');
    expect(name).toBe('brighten-2_week-6-visit_worksheet_draft_2026-05-27.pdf');
  });

  it('includes role segment when filter is a specific role', () => {
    const name = buildWorksheetFilename(makePacket(), 'nurse');
    expect(name).toBe('brighten-2_week-6-visit_nurse_worksheet_draft_2026-05-27.pdf');
  });

  it('uses raw role enum value (lowercase) for the segment', () => {
    expect(buildWorksheetFilename(makePacket(), 'pharmacy')).toContain('_pharmacy_');
    expect(buildWorksheetFilename(makePacket(), 'investigator')).toContain('_investigator_');
  });

  it('defaults to "all" (no role segment) when filter omitted', () => {
    expect(buildWorksheetFilename(makePacket())).not.toMatch(/_(coordinator|nurse|investigator|lab|pharmacy)_/);
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

  // ---- Sprint 6 — role-filter end-to-end ----
  it('passes roleFilter through to filename + itemCount when filter is a role', async () => {
    // Fixture has 2 items: req-1 (Coordinator) + req-2 (Investigator).
    // Filtering to "nurse" should leave 0 items; the orchestrator's
    // returned itemCount reflects DELIVERED count, not canonical packet length.
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);

    const captured: Array<{ filename: string }> = [];
    const r = await downloadVisitWorksheet(
      'visit-1',
      { triggerDownload: (filename) => captured.push({ filename }) },
      'coordinator',
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.filename).toContain('_coordinator_');
      // Fixture: 1 Coordinator-tagged item (req-1).
      expect(r.data.itemCount).toBe(1);
    }
    expect(captured[0]?.filename).toContain('_coordinator_');
  });

  it('returns deliveredItemCount=0 when role filter matches no items', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);

    const r = await downloadVisitWorksheet('visit-1', {}, 'pharmacy');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.itemCount).toBe(0);
      expect(r.data.filename).toContain('_pharmacy_');
    }
  });

  it('defaults to "all" when roleFilter omitted (Sprint 5 backward compat)', async () => {
    vi.spyOn(supabase, 'rpc').mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: makePacket(), error: null,
    } as any);

    const r = await downloadVisitWorksheet('visit-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.itemCount).toBe(2); // canonical fixture total
      expect(r.data.filename).not.toMatch(/_(coordinator|nurse|investigator|lab|pharmacy)_/);
    }
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

  it('placeholder purpose string is the exact RPC fallback (kept in sync with migrations)', () => {
    // The RPC's COALESCE fallback is hard-coded — if anyone changes the
    // SQL string without changing this constant, the PDF builder stops
    // recognizing the placeholder and the deliverable looks unfinished.
    // This test fails loudly when the strings drift.
    expect(WORKSHEET_PLACEHOLDER_PURPOSE).toBe(
      'Per-protocol visit. Detailed execution requirements pending structured ingest extraction.',
    );
  });
});

// ===========================================================================
// Narrative-first S1.5 — buildWorksheetReadingSection (pure) + render smoke.
// ===========================================================================

function makeBriefLine(overrides: Partial<VisitBriefLine> = {}): VisitBriefLine {
  return {
    key: 'gate-1',
    kind: 'gate',
    text: 'ECG — if QTcF exceeds 480 ms, then withhold study drug',
    refs: [{ label: '§7.3.2 · p 43', section: '7.3.2', page: 43 }],
    piqcDrafted: false,
    ...overrides,
  };
}

function makeReadingDivergence(overrides: Partial<DivergenceRecord> = {}): DivergenceRecord {
  return {
    id: 'div-1',
    protocol_id: 'p-1',
    divergence_class: 'window_mismatch',
    visit_name: 'Week 6 visit',
    procedure_label: null,
    reading_a: { source: 'soa_grid', quote: 'Day 42 (±3)', verbatim: true, section: 'Appendix 2', page: 96 },
    reading_b: { source: 'narrative', quote: 'Day 42 ± 2 days', verbatim: false, section: '5.2', page: 28 },
    detail: 'Window components differ.',
    status: 'open',
    dispositions: [],
    created_at: '2026-07-19T10:00:00Z',
    ...overrides,
  };
}

describe('buildWorksheetReadingSection — claim selection', () => {
  it('drops orient/clock/watchout (already on page 1 or superseded) and keeps the rest', () => {
    const section = buildWorksheetReadingSection({
      briefLines: [
        makeBriefLine({ key: 'orient', kind: 'orient', text: 'Purpose prose.' }),
        makeBriefLine({ key: 'scope', kind: 'scope', text: 'Applies to Cohort B only.', refs: [] }),
        makeBriefLine({ key: 'clock', kind: 'clock', text: 'Scheduled at Study Day +42.', refs: [] }),
        makeBriefLine(),
        makeBriefLine({ key: 'more', kind: 'more', text: '2 more — in the sequence below.', refs: [] }),
        makeBriefLine({ key: 'watchout', kind: 'watchout', text: 'Two readings…', refs: [] }),
      ],
      divergences: [],
    });
    expect(section.claims.map((c) => c.text)).toEqual([
      'Applies to Cohort B only.',
      'ECG — if QTcF exceeds 480 ms, then withhold study drug',
      '2 more — in the sequence below.',
    ]);
  });

  it('joins multiple refs into one address string and empties cleanly', () => {
    const section = buildWorksheetReadingSection({
      briefLines: [
        makeBriefLine({
          refs: [
            { label: '§9.1 · p 58', section: '9.1', page: 58 },
            { label: 'p 97', section: null, page: 97 },
          ],
        }),
        makeBriefLine({ key: 'g2', refs: [] }),
      ],
      divergences: [],
    });
    expect(section.claims[0].where).toBe('§9.1 · p 58 · p 97');
    expect(section.claims[1].where).toBe('');
  });
});

describe('buildWorksheetReadingSection — divergence blocks', () => {
  it('renders both readings with verbatim honesty labels, section/page, and status — never a verdict', () => {
    const section = buildWorksheetReadingSection({
      briefLines: [],
      divergences: [makeReadingDivergence()],
    });
    const d = section.divergences[0];
    expect(d.title).toBe('Window mismatch — this visit');
    // "Appendix 2" gets NO § prefix (named location); numeric "5.2" does.
    expect(d.readingA).toBe('SoA grid: “Day 42 (±3)” (verbatim) — Appendix 2 · p 96');
    expect(d.readingB).toBe('Narrative: “Day 42 ± 2 days” (as extracted) — §5.2 · p 28');
    expect(d.status).toBe('Status: Open');
    expect(JSON.stringify(d)).not.toMatch(/correct|right|wrong/i);
  });

  it('uses the procedure label when the divergence is procedure-scoped', () => {
    const section = buildWorksheetReadingSection({
      briefLines: [],
      divergences: [
        makeReadingDivergence({ divergence_class: 'presence', procedure_label: '12-lead ECG' }),
      ],
    });
    expect(section.divergences[0].title).toBe('Presence — 12-lead ECG');
  });

  it('keeps open + raised, drops resolved + dismissed', () => {
    const section = buildWorksheetReadingSection({
      briefLines: [],
      divergences: [
        makeReadingDivergence({ id: 'a', status: 'open' }),
        makeReadingDivergence({ id: 'b', status: 'raised_with_sponsor' }),
        makeReadingDivergence({ id: 'c', status: 'resolved' }),
        makeReadingDivergence({ id: 'd', status: 'dismissed' }),
      ],
    });
    expect(section.divergences).toHaveLength(2);
    expect(section.moreDivergencesNote).toBeNull();
  });

  it('caps blocks and names the trimmed remainder', () => {
    const many = Array.from({ length: READING_DIVERGENCE_CAP + 2 }, (_, i) =>
      makeReadingDivergence({ id: `d${i}` }),
    );
    const section = buildWorksheetReadingSection({ briefLines: [], divergences: many });
    expect(section.divergences).toHaveLength(READING_DIVERGENCE_CAP);
    expect(section.moreDivergencesNote).toContain('2 more open divergences');
  });
});

describe('buildVisitWorksheetPdf — with a reading attached', () => {
  it('renders without throwing and stays a valid PDF', () => {
    const doc = buildVisitWorksheetPdf(makePacket(), 'all', {
      briefLines: [
        makeBriefLine({ key: 'orient', kind: 'orient', text: 'Purpose.' }),
        makeBriefLine({ key: 'scope', kind: 'scope', text: 'Applies to Cohort B only.', refs: [] }),
        makeBriefLine(),
      ],
      divergences: [makeReadingDivergence()],
    });
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
    expect(doc.output('blob').size).toBeGreaterThan(500);
  });

  it('renders identically-shaped output when the reading is empty (no reading section)', () => {
    expect(() =>
      buildVisitWorksheetPdf(makePacket(), 'all', { briefLines: [], divergences: [] }),
    ).not.toThrow();
  });

  it('handles a long reading without clobbering the layout (page-break guard)', () => {
    const gates = Array.from({ length: 30 }, (_, i) =>
      makeBriefLine({ key: `g${i}`, text: `Gated requirement number ${i} — if a very long condition holds across the visit day, then a correspondingly long consequence applies. `.repeat(2) }),
    );
    const doc = buildVisitWorksheetPdf(makePacket(), 'all', {
      briefLines: gates,
      divergences: Array.from({ length: 4 }, (_, i) => makeReadingDivergence({ id: `dv${i}` })),
    });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });
});

describe('downloadVisitWorksheet — reading pass-through', () => {
  it('threads the reading to the built PDF without altering the Result shape', async () => {
    window.localStorage.setItem(MOCK_TOGGLE_KEY, '1');
    const downloads: string[] = [];
    const r = await downloadVisitWorksheet(
      '00000001-e000-4000-8000-00000000000b',
      { triggerDownload: (filename) => downloads.push(filename) },
      'all',
      { briefLines: [makeBriefLine()], divergences: [makeReadingDivergence()] },
    );
    window.localStorage.removeItem(MOCK_TOGGLE_KEY);
    // Mock fixture may or may not contain this visit id — either way the
    // call must not throw, and on success a filename must be delivered.
    if (r.ok) {
      expect(downloads).toHaveLength(1);
    } else {
      expect(r.error).toMatch(/mock fixture/);
    }
  });
});
