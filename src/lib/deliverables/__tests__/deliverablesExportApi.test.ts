import { beforeEach, describe, expect, it, vi } from 'vitest';
import type jsPDF from 'jspdf';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests
// (same pattern as deliverablesMutationsApi.test.ts).
const rpcMock = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  DELIVERABLE_EXPORT_DISCLAIMER,
  DELIVERABLE_EXPORT_HEADER_LABEL,
  buildDeliverableFilename,
  buildDeliverablePdf,
  downloadDeliverable,
  fetchDeliverableExportPacket,
  isoDateForFilename,
  slugifyForFilename,
  truncateForAppendixItem,
} from '../deliverablesExportApi';
import type {
  DeliverableArtifactType,
  DeliverableExportPacket,
  DeliverablePacketBlock,
} from '../../../types/deliverables';
import { ARTIFACT_TYPE_LABELS } from '../../../types/deliverables';
import { DELIVERABLE_EXPORT_CONFIGS } from '../deliverableExportConfig';

// =============================================================================
// deliverablesExportApi — three-layer split mirroring the VEW worksheet
// export (src/lib/visit-execution/__tests__/visitExecutionExportApi.test.ts):
//
//   Layer 1: fetchDeliverableExportPacket — DeliverablesResult + defensive shape
//   Layer 2: buildDeliverablePdf          — pure function; assert via doc internals
//   Layer 3: downloadDeliverable          — orchestrator; triggerDownload injection
//
// Text assertions read jsPDF's internal page content streams directly (no
// PDF parser, no jsdom): standard-font text is written as literal `(...) Tj`
// operators, so ASCII substrings are directly greppable. Two normalizations:
// escaped parens, and the em dash (U+2014), which jsPDF encodes as the
// CP1252 byte 0x97.
//
// Sponsor-leak guard: the fixture plants a ZZSENTINEL marker in every packet
// field the builder must NOT render (deliverable_id, source_evidence_id,
// source_quote) and asserts the produced document never contains it — the
// builder renders only the fields it is told to.
// =============================================================================

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/** Concatenate every page's content stream and normalize jsPDF encoding. */
function docText(doc: jsPDF): string {
  const pages = (doc as unknown as { internal: { pages: Array<string[] | undefined> } })
    .internal.pages;
  return pages
    .flatMap((page) => page ?? [])
    .join('\n')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\x97/g, '—'); // CP1252 em dash byte → the character we assert on
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// -----------------------------------------------------------------------------
// Fixture
// -----------------------------------------------------------------------------

function block(
  overrides: Partial<DeliverablePacketBlock> &
    Pick<DeliverablePacketBlock, 'id' | 'section_key' | 'display_text' | 'sort_order'>,
): DeliverablePacketBlock {
  return {
    block_type: 'checklist_item',
    content_origin: 'protocol_fact',
    derived_text: overrides.display_text,
    current_text: null,
    source_evidence_id: null,
    source_quote: null,
    source_page_number: null,
    source_section: null,
    confidence_state: 'high',
    review_state: 'draft',
    review_note: null,
    version: 1,
    generation_seq: 1,
    ...overrides,
  };
}

/**
 * Full packet: 4 non-empty sections (eligibility, exclusion, source-doc
 * focus, site questions), the other 5 asserted absent. Single-token markers
 * (ELIGFACTTOKEN etc.) survive autotable line wrapping, so occurrence counts
 * are exact. ZZSENTINEL is planted ONLY in unrendered-by-design fields.
 */
function makePacket(overrides: Partial<DeliverableExportPacket> = {}): DeliverableExportPacket {
  return {
    deliverable_id: 'ZZSENTINEL-deliverable-0001',
    protocol_code: 'ONC-4021',
    protocol_title: 'Phase 3 Compound X Study',
    artifact_type: 'monitoring_prep_checklist',
    title: 'Monitoring Preparation Checklist',
    protocol_version: 'v2.0',
    generated_at: '2026-07-03T10:15:00.000Z',
    blocks: [
      block({
        id: 'b-1',
        section_key: 'eligibility_verification',
        block_type: 'section_intro',
        content_origin: 'derived_operational_framing',
        display_text: 'ELIGFRAMINGTOKEN verify each enrolled participant against inclusion criteria.',
        confidence_state: null,
        review_state: 'draft',
        sort_order: 0,
      }),
      block({
        id: 'b-2',
        section_key: 'eligibility_verification',
        display_text: 'Verify: ELIGFACTTOKEN age 18 to 65 at consent',
        source_evidence_id: 'ZZSENTINEL-evidence-0002',
        source_quote: 'ZZSENTINEL quoted inclusion text — never rendered in the PDF',
        source_page_number: 12,
        source_section: '5.1 Eligibility',
        confidence_state: 'high',
        review_state: 'reviewed',
        sort_order: 1,
      }),
      block({
        id: 'b-3',
        section_key: 'exclusion_prohibited_med_review',
        display_text: 'Confirm absence of: EXCLFACTTOKEN prior systemic therapy',
        confidence_state: 'medium',
        review_state: 'draft',
        sort_order: 2,
      }),
      block({
        id: 'b-4',
        section_key: 'source_doc_focus',
        content_origin: 'human_editorial',
        display_text: 'HUMANTOKEN confirm pharmacy temperature logs are complete',
        derived_text: null,
        current_text: 'HUMANTOKEN confirm pharmacy temperature logs are complete',
        confidence_state: null,
        review_state: 'human_added',
        sort_order: 3,
      }),
      block({
        id: 'b-5',
        section_key: 'site_questions',
        block_type: 'site_question',
        content_origin: 'derived_operational_framing',
        display_text: 'SITEQTOKEN any staffing changes since the last monitoring visit?',
        confidence_state: null,
        review_state: 'needs_review',
        sort_order: 4,
      }),
    ],
    ...overrides,
  };
}

/** Framing-only packet with NO em dash anywhere except the '—' confidence
 *  placeholder cell — makes the '—' assertion unambiguous. */
function framingOnlyPacket(): DeliverableExportPacket {
  return makePacket({
    title: 'Checklist',
    protocol_code: 'P1',
    protocol_title: 'Study',
    protocol_version: 'v1',
    blocks: [
      block({
        id: 'f-1',
        section_key: 'site_questions',
        block_type: 'site_question',
        content_origin: 'derived_operational_framing',
        display_text: 'SITEQTOKEN any staffing changes since the last monitoring visit?',
        confidence_state: null,
        review_state: 'draft',
        sort_order: 0,
      }),
    ],
  });
}

beforeEach(() => {
  rpcMock.mockReset();
});

// ===========================================================================
// Layer 1 — fetchDeliverableExportPacket
// ===========================================================================

describe('fetchDeliverableExportPacket', () => {
  it('calls deliverable_export_packet with p_deliverable_id', async () => {
    rpcMock.mockResolvedValueOnce({ data: makePacket(), error: null });
    await fetchDeliverableExportPacket('d-1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_export_packet', {
      p_deliverable_id: 'd-1',
    });
  });

  it('returns the packet on success', async () => {
    rpcMock.mockResolvedValueOnce({ data: makePacket(), error: null });
    const r = await fetchDeliverableExportPacket('d-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.protocol_code).toBe('ONC-4021');
      expect(r.data.blocks).toHaveLength(5);
    }
  });

  it('surfaces RPC errors as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Deliverable not found or access denied' },
    });
    const r = await fetchDeliverableExportPacket('d-nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('Deliverable not found or access denied');
  });

  it('returns ok:false on null payload', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await fetchDeliverableExportPacket('d-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed export packet');
  });

  it('returns ok:false on malformed packet (missing blocks)', async () => {
    const bad: Record<string, unknown> = { ...makePacket() };
    delete bad.blocks;
    rpcMock.mockResolvedValueOnce({ data: bad, error: null });
    const r = await fetchDeliverableExportPacket('d-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed export packet');
  });

  it('defaults protocol_title when server omits it', async () => {
    const partial: Record<string, unknown> = { ...makePacket() };
    delete partial.protocol_title;
    rpcMock.mockResolvedValueOnce({ data: partial, error: null });
    const r = await fetchDeliverableExportPacket('d-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.protocol_title).toBe('Untitled protocol');
  });
});

// ===========================================================================
// Filename helpers
// ===========================================================================

describe('slugifyForFilename', () => {
  it('lowercases and dashes', () => {
    expect(slugifyForFilename('ONC 4021 Study')).toBe('onc-4021-study');
  });

  it('strips non-alphanumerics and collapses separator runs', () => {
    expect(slugifyForFilename('P-1  (v2)')).toBe('p-1-v2');
  });

  it('returns "untitled" for an all-symbols input', () => {
    expect(slugifyForFilename('!!!')).toBe('untitled');
  });
});

describe('buildDeliverableFilename', () => {
  it('builds <code>_monitoring_prep_checklist_draft_<YYYY-MM-DD>.pdf from packet fields', () => {
    const name = buildDeliverableFilename(makePacket());
    expect(name).toBe('onc-4021_monitoring_prep_checklist_draft_2026-07-03.pdf');
  });

  it('uses packet.generated_at UTC date (NOT the local clock)', () => {
    // 23:59 UTC is still Jul 3 in UTC even in a UTC+1 browser — the filename
    // must match the server-stamped footer, not the browser clock.
    const name = buildDeliverableFilename(
      makePacket({ generated_at: '2026-07-03T23:59:00.000Z' }),
    );
    expect(name).toContain('_2026-07-03.pdf');
    expect(isoDateForFilename('2026-07-03T23:59:00.000Z')).toBe('2026-07-03');
  });

  it('falls back to the literal "protocol" when protocol_code is null', () => {
    const name = buildDeliverableFilename(makePacket({ protocol_code: null }));
    expect(name).toBe('protocol_monitoring_prep_checklist_draft_2026-07-03.pdf');
  });

  it('falls back to today UTC when generated_at is malformed (defensive)', () => {
    const name = buildDeliverableFilename(makePacket({ generated_at: 'not-an-iso' }));
    expect(name).toMatch(/_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

// ===========================================================================
// Layer 2 — buildDeliverablePdf (pure)
// ===========================================================================

describe('buildDeliverablePdf — document shell', () => {
  it('returns a jsPDF document with at least one page', () => {
    const doc = buildDeliverablePdf(makePacket());
    expect(doc.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('produces a non-empty application/pdf Blob', () => {
    const doc = buildDeliverablePdf(makePacket());
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(500);
    expect(blob.type).toBe('application/pdf');
  });

  it('builds without throwing on an empty-blocks packet (no tables, no appendix)', () => {
    const doc = buildDeliverablePdf(makePacket({ blocks: [] }));
    expect(doc.getNumberOfPages()).toBe(1);
    const text = docText(doc);
    expect(text).toContain('0 items');
    expect(text).not.toContain('Source traceability');
  });
});

describe('buildDeliverablePdf — title block', () => {
  it('renders the deliverable title', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Monitoring Preparation Checklist');
  });

  it('renders protocol title + protocol code on one line', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Phase 3 Compound X Study · ONC-4021');
  });

  it('renders "Protocol version: <v>" when extracted', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Protocol version: v2.0');
  });

  it('renders "Protocol version: not extracted" when null', () => {
    const text = docText(buildDeliverablePdf(makePacket({ protocol_version: null })));
    expect(text).toContain('Protocol version: not extracted');
  });

  it('renders the server-stamped generated timestamp', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Generated 2026-07-03 10:15 UTC');
  });

  it('renders block counts: total / reviewed / needs review (open = draft + flagged)', () => {
    // Fixture: 5 blocks — 1 reviewed, 2 draft + 1 needs_review = 3 open,
    // 1 human_added (neither reviewed nor open).
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('5 items');
    expect(text).toContain('1 reviewed');
    expect(text).toContain('3 needs review');
  });
});

describe('buildDeliverablePdf — header band, watermark, footer', () => {
  it('renders the DRAFT header band label', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain(DELIVERABLE_EXPORT_HEADER_LABEL);
  });

  it('renders the disclaimer and pagination in the footer', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    // The disclaimer is width-wrapped across lines; assert an unsplittable
    // token from it rather than the full sentence.
    expect(text).toContain('source-backed');
    expect(text).toContain('Page 1 of');
  });

  it('stamps header + footer on every page of a multi-page document', () => {
    const manyBlocks: DeliverablePacketBlock[] = Array.from({ length: 40 }, (_, i) =>
      block({
        id: `m-${i}`,
        section_key: 'eligibility_verification',
        display_text: `Verify: inclusion criterion number ${i + 1} against source documentation`,
        source_section: '5.1 Eligibility',
        source_page_number: 10 + i,
        sort_order: i,
      }),
    );
    const doc = buildDeliverablePdf(makePacket({ blocks: manyBlocks }));
    const pageCount = doc.getNumberOfPages();
    expect(pageCount).toBeGreaterThanOrEqual(2);
    const text = docText(doc);
    expect(text).toContain(`Page 1 of ${pageCount}`);
    expect(text).toContain(`Page 2 of ${pageCount}`);
    // Header label: once on page 1 (title block) + once per later page.
    expect(countOccurrences(text, DELIVERABLE_EXPORT_HEADER_LABEL)).toBe(pageCount);
    // DRAFT watermark text is drawn on every page.
    expect(countOccurrences(text, 'DRAFT')).toBeGreaterThanOrEqual(pageCount);
  });
});

describe('buildDeliverablePdf — section tables', () => {
  it('renders one table per NON-EMPTY section with its label', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Eligibility Verification Focus');
    expect(text).toContain('Exclusion & Prohibited Medication Review');
    expect(text).toContain('Source Documentation Focus Areas');
    expect(text).toContain('Site Questions to Consider');
  });

  it('does NOT render headings for empty sections', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).not.toContain('Visit Window Verification');
    expect(text).not.toContain('Amendment-Sensitive Requirements');
    expect(text).not.toContain('Endpoint-Critical Procedure Checks');
  });

  it('renders origin and review labels from the shared label maps', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Protocol fact');
    expect(text).toContain('PIQC framing');
    expect(text).toContain('Human note');
    expect(text).toContain('Reviewed');
    expect(text).toContain('Added by reviewer');
  });

  it('renders confidence labels for fact rows', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('High confidence');
    expect(text).toContain('Medium confidence');
  });

  it("renders '—' (no confidence label) for framing rows — framing never claims confidence", () => {
    // Packet engineered so the ONLY em dash in the document is the
    // confidence placeholder cell.
    const text = docText(buildDeliverablePdf(framingOnlyPacket()));
    expect(text).toContain('—');
    expect(text).not.toContain('High confidence');
    expect(text).not.toContain('Medium confidence');
    expect(text).not.toContain('Low confidence');
    expect(text).not.toContain('Needs review'); // capital-N confidence/review label
  });

  it('appends "(Added by reviewer)" to human_editorial rows only', () => {
    const withHuman = docText(buildDeliverablePdf(makePacket()));
    expect(withHuman).toContain('(Added by reviewer)');
    const noHuman = docText(buildDeliverablePdf(framingOnlyPacket()));
    expect(noHuman).not.toContain('(Added by reviewer)');
  });
});

describe('buildDeliverablePdf — source traceability appendix', () => {
  it('renders the appendix with section + page for fact blocks', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(text).toContain('Source traceability');
    expect(text).toContain('5.1 Eligibility');
  });

  it('includes ONLY protocol_fact blocks (facts appear twice: body + appendix)', () => {
    const text = docText(buildDeliverablePdf(makePacket()));
    expect(countOccurrences(text, 'ELIGFACTTOKEN')).toBe(2);
    expect(countOccurrences(text, 'EXCLFACTTOKEN')).toBe(2);
    // Framing + human blocks appear in the body table only.
    expect(countOccurrences(text, 'ELIGFRAMINGTOKEN')).toBe(1);
    expect(countOccurrences(text, 'HUMANTOKEN')).toBe(1);
    expect(countOccurrences(text, 'SITEQTOKEN')).toBe(1);
  });

  it('omits the appendix entirely when the packet has no fact blocks', () => {
    const text = docText(buildDeliverablePdf(framingOnlyPacket()));
    expect(text).not.toContain('Source traceability');
  });

  it('builds without throwing when a fact has null section and page (rendered as em-dash placeholders)', () => {
    // Fixture block b-3 has source_section = null, source_page_number = null.
    expect(() => buildDeliverablePdf(makePacket())).not.toThrow();
  });
});

describe('truncateForAppendixItem', () => {
  it('passes short text through unchanged', () => {
    expect(truncateForAppendixItem('Verify: age 18 to 65')).toBe('Verify: age 18 to 65');
  });

  it('truncates long text to at most 100 chars ending with an ellipsis', () => {
    const long = 'x'.repeat(250);
    const out = truncateForAppendixItem(long);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildDeliverablePdf — sponsor-name-free guarantee', () => {
  it('never renders unlisted packet fields (ZZSENTINEL planted in deliverable_id, source_evidence_id, source_quote)', () => {
    // The builder must render ONLY the documented field list. The fixture
    // plants ZZSENTINEL in every packet field the builder is not allowed to
    // draw — if any of them leaks into the document, this fails. Sponsor
    // names can only reach the PDF through such an unlisted field, since
    // the RPC never selects protocols.sponsor.
    const doc = buildDeliverablePdf(makePacket());
    expect(docText(doc)).not.toContain('ZZSENTINEL');
    // And the fields it IS told to render do appear.
    expect(docText(doc)).toContain('Phase 3 Compound X Study');
  });
});

// ===========================================================================
// Layer 3 — downloadDeliverable
// ===========================================================================

describe('downloadDeliverable — orchestrator', () => {
  it('fetches, builds, and triggers download with the computed filename + blockCount', async () => {
    rpcMock.mockResolvedValueOnce({ data: makePacket(), error: null });

    const triggered: string[] = [];
    const r = await downloadDeliverable('d-1', {
      triggerDownload: (filename) => triggered.push(filename),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.filename).toBe('onc-4021_monitoring_prep_checklist_draft_2026-07-03.pdf');
      expect(r.data.blockCount).toBe(5);
    }
    expect(triggered).toHaveLength(1);
    expect(triggered[0]).toBe(r.ok ? r.data.filename : 'NOPE');
  });

  it('propagates fetch errors as ok:false (does not call triggerDownload)', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'Deliverable not found or access denied' },
    });

    let called = false;
    const r = await downloadDeliverable('d-nope', {
      triggerDownload: () => {
        called = true;
      },
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });

  it('catches sync errors from triggerDownload and returns ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: makePacket(), error: null });

    const r = await downloadDeliverable('d-1', {
      triggerDownload: () => {
        throw new Error('simulated browser save failure');
      },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/simulated browser save failure/);
  });
});

describe('downloadDeliverable — SIV dispatch', () => {
  it('routes a siv_package packet to the deck builder + deck filename', async () => {
    const sivPacket = {
      ...makePacket(),
      artifact_type: 'siv_package',
      title: 'SIV Knowledge Transfer Package — Draft',
    };
    rpcMock.mockResolvedValueOnce({ data: sivPacket, error: null });

    const triggered: string[] = [];
    const r = await downloadDeliverable('d-siv', {
      triggerDownload: (filename) => triggered.push(filename),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.filename).toBe('onc-4021_siv_package_draft_2026-07-03.pdf');
    }
    expect(triggered).toHaveLength(1);
  });

  it('checklist dispatch regression: non-SIV packets keep the original filename', async () => {
    rpcMock.mockResolvedValueOnce({ data: makePacket(), error: null });
    const r = await downloadDeliverable('d-1', { triggerDownload: () => {} });
    if (r.ok) {
      expect(r.data.filename).toBe('onc-4021_monitoring_prep_checklist_draft_2026-07-03.pdf');
    }
    expect(r.ok).toBe(true);
  });
});

// ===========================================================================
// Constants — spot-check the disclaimer + header label so future
// "polish-strip" passes can't quietly remove them.
// ===========================================================================

describe('disclaimer + header label constants', () => {
  it('disclaimer says PIQC produced a source-backed draft aid and control stays outside PIQC', () => {
    expect(DELIVERABLE_EXPORT_DISCLAIMER).toMatch(/PIQC/);
    expect(DELIVERABLE_EXPORT_DISCLAIMER).toMatch(/draft/);
    expect(DELIVERABLE_EXPORT_DISCLAIMER).toMatch(/source-backed/);
    expect(DELIVERABLE_EXPORT_DISCLAIMER).toMatch(/outside PIQC/);
  });

  it('header label carries the "PIQC drafted" attribution + DRAFT mark', () => {
    expect(DELIVERABLE_EXPORT_HEADER_LABEL).toMatch(/PIQC drafted/);
    expect(DELIVERABLE_EXPORT_HEADER_LABEL).toMatch(/Monitoring preparation checklist/);
    expect(DELIVERABLE_EXPORT_HEADER_LABEL).toMatch(/DRAFT/);
  });

  it('disclaimer and header label never use approval vocabulary (draft-only)', () => {
    expect(DELIVERABLE_EXPORT_DISCLAIMER.toLowerCase()).not.toContain('approv');
    expect(DELIVERABLE_EXPORT_HEADER_LABEL.toLowerCase()).not.toContain('approv');
  });

  it('the exported constants mirror the monitoring export config entry', () => {
    expect(DELIVERABLE_EXPORT_DISCLAIMER).toBe(
      DELIVERABLE_EXPORT_CONFIGS.monitoring_prep_checklist.disclaimer,
    );
    expect(DELIVERABLE_EXPORT_HEADER_LABEL).toBe(
      DELIVERABLE_EXPORT_CONFIGS.monitoring_prep_checklist.headerLabel,
    );
  });
});

// ===========================================================================
// Config-driven export — all five artifact types render through the shared
// portrait builder (SIV also gets the shared filename; its deck body is built
// elsewhere). Monitoring is covered byte-for-byte above; these pin the OTHER
// types so a config regression can't silently mislabel an export.
// ===========================================================================

const ALL_TYPES = Object.keys(ARTIFACT_TYPE_LABELS) as DeliverableArtifactType[];

describe('buildDeliverableFilename — per-artifact slug', () => {
  it('uses each type\'s configured filename slug', () => {
    for (const t of ALL_TYPES) {
      const slug = DELIVERABLE_EXPORT_CONFIGS[t].filenameSlug;
      const name = buildDeliverableFilename(makePacket({ artifact_type: t }));
      expect(name, t).toBe(`onc-4021_${slug}_draft_2026-07-03.pdf`);
    }
  });
});

describe('buildDeliverablePdf — per-artifact header + disclaimer', () => {
  it('stamps the artifact-specific header label, not the monitoring one', () => {
    const text = docText(
      buildDeliverablePdf(makePacket({ artifact_type: 'cra_monitoring_focus', title: 'CRA Focus' })),
    );
    expect(text).toContain('PIQC drafted · CRA monitoring focus · DRAFT');
    expect(text).not.toContain('Monitoring preparation checklist');
  });

  it('renders the artifact-specific disclaimer token', () => {
    const risk = docText(
      buildDeliverablePdf(makePacket({ artifact_type: 'risk_overview', title: 'Risk Overview' })),
    );
    // "Risk interpretation" is unique to the risk disclaimer.
    expect(risk).toContain('Risk interpretation');
  });

  it('renders section labels from the artifact\'s own vocabulary', () => {
    // A risk-overview packet whose block sits in a RISK section key renders the
    // RISK label — proof the builder uses config.sectionOrder/Labels, not the
    // monitoring ones (which would hide this block as an unknown section).
    const doc = buildDeliverablePdf(
      makePacket({
        artifact_type: 'risk_overview',
        title: 'Risk Overview',
        blocks: [
          block({
            id: 'r-1',
            section_key: 'eligibility_complexity',
            display_text: 'RISKFACTTOKEN complex eligibility criterion',
            source_section: '5.1',
            source_page_number: 3,
            sort_order: 0,
          }),
        ],
      }),
    );
    const text = docText(doc);
    expect(text).toContain('Eligibility Complexity'); // RISK_SECTION_LABELS
    expect(text).toContain('RISKFACTTOKEN');
  });
});

describe('fetchDeliverableExportPacket — passthrough for all known types', () => {
  it('preserves any known artifact_type (no longer degrades risk/CRA/training)', async () => {
    for (const t of ALL_TYPES) {
      rpcMock.mockResolvedValueOnce({
        data: makePacket({ artifact_type: t }),
        error: null,
      });
      const r = await fetchDeliverableExportPacket('d-1');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.data.artifact_type, t).toBe(t);
    }
  });

  it('degrades an unknown artifact_type to the checklist rendering', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { ...makePacket(), artifact_type: 'fragility_map' },
      error: null,
    });
    const r = await fetchDeliverableExportPacket('d-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.artifact_type).toBe('monitoring_prep_checklist');
  });
});

describe('downloadDeliverable — per-artifact filename dispatch', () => {
  it('routes a site_training_priorities packet to its own filename slug', async () => {
    rpcMock.mockResolvedValueOnce({
      data: makePacket({
        artifact_type: 'site_training_priorities',
        title: 'Site Training Priorities — Draft',
      }),
      error: null,
    });
    const triggered: string[] = [];
    const r = await downloadDeliverable('d-stp', {
      triggerDownload: (filename) => triggered.push(filename),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.filename).toBe('onc-4021_site_training_priorities_draft_2026-07-03.pdf');
    }
    expect(triggered).toHaveLength(1);
  });
});
