import { describe, expect, it } from 'vitest';
import type jsPDF from 'jspdf';
import {
  buildSivDeck,
  SIV_DECK_TITLE_BAND,
  SIV_DECK_HEADER_LABEL,
  SIV_DECK_EXPORT_DISCLAIMER,
  SIV_SPEAKER_NOTES_BAND_LABEL,
  SIV_VERIFY_SUFFIX,
} from '../exporters/buildSivDeck';
import type {
  DeliverableExportPacket,
  DeliverablePacketBlock,
} from '../../../types/deliverables';

// =============================================================================
// buildSivDeck — pure landscape deck builder. Assertions read jsPDF's
// internal page content streams (docText helper COPIED from
// deliverablesExportApi.test.ts — module-private there): standard-font text
// is written as literal `(...) Tj` operators, so ASCII substrings are
// greppable after normalizing escaped parens and the CP1252 em dash.
//
// Sponsor-leak guard: ZZSENTINEL is planted in every field the builder must
// NOT render (deliverable_id, source_evidence_id, source_quote) and asserted
// absent from the produced document.
// =============================================================================

/** COPIED from deliverablesExportApi.test.ts (module-private helper). */
function docText(doc: jsPDF): string {
  const pages = (doc as unknown as { internal: { pages: Array<string[] | undefined> } })
    .internal.pages;
  return pages
    .flatMap((page) => page ?? [])
    .join('\n')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\x97/g, '—');
}

/** Reassemble wrapped text: join every `(...) Tj` show-operand in stream
 *  order so substrings that wrap across lines are still assertable. */
function docFlowText(doc: jsPDF): string {
  const raw = docText(doc);
  return Array.from(raw.matchAll(/\(((?:\\.|[^()\\])*)\) Tj/g), (m) => m[1]).join(' ');
}

let blockId = 0;
function block(overrides: Partial<DeliverablePacketBlock>): DeliverablePacketBlock {
  blockId += 1;
  return {
    id: `blk-${blockId}`,
    section_key: 'study_overview',
    block_type: 'checklist_item',
    content_origin: 'protocol_fact',
    display_text: `Fact ${blockId}`,
    derived_text: `Fact ${blockId}`,
    current_text: null,
    source_evidence_id: 'ZZSENTINEL-evidence',
    source_quote: 'ZZSENTINEL-quote',
    source_page_number: 12,
    source_section: '4.1 Study Design',
    confidence_state: 'high',
    review_state: 'draft',
    review_note: null,
    version: 1,
    sort_order: blockId,
    ...overrides,
  };
}

function makeSivPacket(): DeliverableExportPacket {
  blockId = 0;
  return {
    deliverable_id: 'ZZSENTINEL-deliverable',
    protocol_code: 'ONC-4021',
    protocol_title: 'A Study of Something Important',
    artifact_type: 'siv_package',
    title: 'SIV Knowledge Transfer Package — Draft',
    protocol_version: 'v2.0',
    generated_at: '2026-07-05T09:00:00Z',
    blocks: [
      block({
        section_key: 'study_overview',
        block_type: 'section_intro',
        content_origin: 'derived_operational_framing',
        display_text: 'Ground the site team in what the study is.',
        source_evidence_id: null,
        source_quote: null,
        source_page_number: null,
        source_section: null,
        confidence_state: null,
      }),
      block({
        section_key: 'study_overview',
        display_text: 'The protocol states — Study design: randomized, double-blind.',
      }),
      block({
        section_key: 'study_overview',
        block_type: 'speaker_note',
        content_origin: 'derived_operational_framing',
        display_text:
          'Teaching point: anchor later slides here. Likely site question: how does this differ? ' +
          'Confirm specifics with the sponsor before presenting.',
        source_evidence_id: null,
        source_quote: null,
        source_page_number: null,
        source_section: null,
        confidence_state: null,
      }),
      block({
        section_key: 'vendor_lab_workflows',
        display_text: "Walk through at SIV: 'Blood draw' (Baseline) — specimen workflow.",
        confidence_state: 'low',
      }),
      block({
        section_key: 'vendor_lab_workflows',
        block_type: 'speaker_note',
        content_origin: 'derived_operational_framing',
        display_text:
          'Teaching point: trace one specimen end to end. Likely site question: kit expiry? ' +
          'Confirm specifics with the sponsor before presenting.',
        source_evidence_id: null,
        source_quote: null,
        source_page_number: null,
        source_section: null,
        confidence_state: null,
      }),
    ],
  };
}

describe('buildSivDeck', () => {
  const doc = buildSivDeck(makeSivPacket());
  const text = docText(doc);

  it('is landscape A4', () => {
    expect(doc.internal.pageSize.getWidth()).toBeGreaterThan(doc.internal.pageSize.getHeight());
  });

  it('lays out title slide + one slide per non-empty section + appendix', () => {
    // 2 non-empty sections in the fixture → 1 title + 2 slides + 1 appendix.
    expect(doc.getNumberOfPages()).toBe(4);
  });

  it('renders the DRAFT bands, section headings, and notes band label', () => {
    expect(text).toContain(SIV_DECK_TITLE_BAND);
    expect(text).toContain(SIV_DECK_HEADER_LABEL);
    expect(text).toContain('Study Purpose & Design');
    expect(text).toContain('Laboratory, Specimen & Vendor Workflows');
    expect(text).toContain(SIV_SPEAKER_NOTES_BAND_LABEL);
    expect(text).toContain('Teaching point: anchor later slides here.');
  });

  it('marks low-confidence bullets with the verify suffix', () => {
    expect(text).toContain(SIV_VERIFY_SUFFIX);
  });

  it('renders the disclaimer, version line, and pagination on every page', () => {
    expect(docFlowText(doc)).toContain('require human review and sponsor confirmation');
    expect(text).toContain('Protocol version: v2.0');
    expect(text).toContain('Page 1 of 4');
    expect(text).toContain('Page 4 of 4');
  });

  it('appendix lists fact blocks only, with section + page', () => {
    expect(text).toContain('Source traceability');
    expect(text).toContain('4.1 Study Design');
  });

  it('never renders sentinel fields (ids, quotes) or a sponsor name', () => {
    expect(text).not.toContain('ZZSENTINEL');
  });

  it('is deterministic', () => {
    expect(docText(buildSivDeck(makeSivPacket()))).toBe(text);
  });

  it('sponsor-confirmation phrasing survives into the disclaimer constant', () => {
    expect(SIV_DECK_EXPORT_DISCLAIMER).toMatch(/sponsor confirmation/);
    expect(SIV_DECK_EXPORT_DISCLAIMER).not.toMatch(/approved/i);
  });
});
