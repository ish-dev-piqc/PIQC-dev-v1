// =============================================================================
// buildSivDeck — pure landscape-A4 jsPDF builder for the SIV Knowledge
// Transfer Package (deliverable artifact_type 'siv_package').
//
// PURE + LEAF: packet in, jsPDF document out. No DOM, no Blob, no download,
// no supabase — and deliberately NO import from ../deliverablesExportApi:
// that module imports buildSivDeck for its export dispatch, so importing its
// helpers back would create a module cycle. The handful of module-private
// chrome helpers it has are copied below with attribution comments; the
// checklist's EXPORTED prose constants are NOT reused because the SIV lens
// must never byte-duplicate another lens's wording (prose-register rule).
//
// Deck shape (one PDF page = one slide):
//   1. Title slide — packet.title, protocol title + code, protocol version,
//      'PIQC drafted · DRAFT · requires human review' band, generated date.
//   2. One slide per NON-EMPTY section in SIV_SECTION_ORDER — heading from
//      SIV_SECTION_LABELS; section_intro blocks as the lead paragraph; fact
//      bullets (low / needs_review confidence gets a '(verify against
//      source)' suffix); speaker_note blocks in a visually separate notes
//      band pinned to the slide bottom ('Speaker notes — sponsor
//      confirmation required').
//   3. Source traceability appendix — protocol_fact blocks only:
//      item snippet | protocol section | page.
//   Every page: DRAFT watermark + header band + disclaimer footer + X/Y.
//
// Sponsor-name-free: renders ONLY title, protocol_code, protocol_title,
// protocol_version, generated_at, and per-block display_text /
// block_type / content_origin / confidence_state / source_section /
// source_page_number. deliverable_id, source_evidence_id, and source_quote
// are never drawn. Rejected blocks never reach this builder — the export
// packet excludes them server-side.
//
// SENSITIVE: block prose (display_text, speaker notes) is rendered into the
// document but never logged from here — this module logs nothing.
// =============================================================================

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DeliverableExportPacket,
  DeliverablePacketBlock,
} from '../../../types/deliverables';
import {
  SIV_SECTION_LABELS,
  SIV_SECTION_ORDER,
  groupBlocksBySection,
} from '../../../types/deliverables';
import { winAnsiSafe } from '../../winAnsiSafe';

// ---------------------------------------------------------------------------
// SIV deck prose constants (exported for tests + UI reuse). Deliberately NOT
// the checklist's constants — distinct lens, distinct wording.
// ---------------------------------------------------------------------------

/** Title-slide attribution band (exact wording per plan). */
export const SIV_DECK_TITLE_BAND = 'PIQC drafted · DRAFT · requires human review';

/** Header band for slide pages (2+): names the artifact, keeps DRAFT. */
export const SIV_DECK_HEADER_LABEL =
  'PIQC drafted · SIV knowledge transfer package · DRAFT';

/** Footer disclaimer — draft-only vocabulary, no approval language. */
export const SIV_DECK_EXPORT_DISCLAIMER =
  'This SIV knowledge transfer deck was drafted by PIQC from source-linked ' +
  'protocol facts as a preparation aid. Slide content and speaker notes ' +
  'require human review and sponsor confirmation before any presentation; ' +
  'final materials and controlled release remain with your organization ' +
  'outside PIQC.';

/** Notes-band label — the structural sponsor-confirmation warning. */
export const SIV_SPEAKER_NOTES_BAND_LABEL =
  'Speaker notes — sponsor confirmation required';

/** Suffix appended to low-trust fact bullets on the slides. */
export const SIV_VERIFY_SUFFIX = '(verify against source)';

// ---------------------------------------------------------------------------
// Layout constants (A4 landscape, pt)
// ---------------------------------------------------------------------------

const MARGIN = 48; // same page gutter as the checklist export
/** Max characters for an appendix "Item" cell before truncation.
 *  COPIED from deliverablesExportApi.ts (APPENDIX_ITEM_MAX + its truncate
 *  helper are module-scoped there; import would cycle). */
const APPENDIX_ITEM_MAX = 100;

function truncateForAppendix(text: string): string {
  if (text.length <= APPENDIX_ITEM_MAX) return text;
  return `${text.slice(0, APPENDIX_ITEM_MAX - 1).trimEnd()}…`;
}

/**
 * COPIED from deliverablesExportApi.ts (module-private there): format the
 * server-stamped timestamp as "Generated YYYY-MM-DD HH:MM UTC".
 */
function formatGeneratedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return `Generated ${y}-${mo}-${day} ${hh}:${mm} UTC`;
  } catch {
    return iso;
  }
}

/**
 * Slide bullet text: display_text, plus the verify suffix when the fact's
 * confidence is low / needs_review (a presenter must not teach an unverified
 * restriction as settled), plus a reviewer attribution for human_editorial
 * blocks (printed teaching content must not pass reviewer additions off as
 * PIQC's draft).
 */
function formatBulletText(block: DeliverablePacketBlock): string {
  let text = block.display_text;
  if (block.confidence_state === 'low' || block.confidence_state === 'needs_review') {
    text = `${text} ${SIV_VERIFY_SUFFIX}`;
  }
  if (block.content_origin === 'human_editorial') {
    text = `${text} (Added by reviewer)`;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** Per-section split into the three render roles. Bullets are "everything
 *  that is neither intro nor speaker note" — a defensive catch-all so no
 *  reviewable block silently vanishes from the printed deck. */
function splitSectionBlocks(blocks: DeliverablePacketBlock[]): {
  intros: DeliverablePacketBlock[];
  bullets: DeliverablePacketBlock[];
  notes: DeliverablePacketBlock[];
} {
  const intros: DeliverablePacketBlock[] = [];
  const bullets: DeliverablePacketBlock[] = [];
  const notes: DeliverablePacketBlock[] = [];
  for (const block of blocks) {
    if (block.block_type === 'section_intro') intros.push(block);
    else if (block.block_type === 'speaker_note') notes.push(block);
    else bullets.push(block);
  }
  return { intros, bullets, notes };
}

/**
 * Pure function: SIV export packet → landscape-A4 jsPDF deck.
 *
 * Returns the jsPDF instance so callers can .save() / .output() / inspect
 * in tests (same contract as buildDeliverablePdf).
 */
export function buildSivDeck(packet: DeliverableExportPacket): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'landscape' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;

  // ---- Title slide ----------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(SIV_DECK_TITLE_BAND, MARGIN, MARGIN);

  let cursorY = pageHeight * 0.34;
  doc.setTextColor(20);
  doc.setFontSize(26);
  const titleLines = doc.splitTextToSize(winAnsiSafe(packet.title), contentWidth);
  doc.text(titleLines, MARGIN, cursorY);
  cursorY += titleLines.length * 28 + 8;

  // Protocol title + code on one line. NO sponsor — sponsor-name-free.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  doc.setTextColor(80);
  const protocolLine = packet.protocol_code
    ? `${packet.protocol_title} · ${packet.protocol_code}`
    : packet.protocol_title;
  const protocolLines = doc.splitTextToSize(winAnsiSafe(protocolLine), contentWidth);
  doc.text(protocolLines, MARGIN, cursorY);
  cursorY += protocolLines.length * 15 + 6;

  // Explicit "not extracted" beats a silent blank (checklist precedent).
  doc.setFontSize(10);
  doc.setTextColor(110);
  doc.text(
    packet.protocol_version
      ? `Protocol version: ${winAnsiSafe(packet.protocol_version)}`
      : 'Protocol version: not extracted',
    MARGIN,
    cursorY,
  );
  cursorY += 15;
  doc.text(formatGeneratedAt(packet.generated_at), MARGIN, cursorY);

  // ---- Section slides ---------------------------------------------------------
  // groupBlocksBySection hides empty sections and preserves SIV_SECTION_ORDER
  // + per-section sort_order — one slide (or more, on overflow) per section.
  for (const { sectionKey, blocks } of groupBlocksBySection(
    packet.blocks,
    SIV_SECTION_ORDER,
  )) {
    const { intros, bullets, notes } = splitSectionBlocks(blocks);
    const heading = SIV_SECTION_LABELS[sectionKey];

    // Pre-measure the notes band so slide content never collides with it.
    // Band = label line + wrapped note text + padding; pinned to the bottom
    // of the section's LAST slide, above the footer.
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    const noteTextWidth = contentWidth - 16;
    const noteLineChunks: string[][] = notes.map((n) =>
      doc.splitTextToSize(winAnsiSafe(n.display_text), noteTextWidth),
    );
    const noteLineCount = noteLineChunks.reduce((sum, lines) => sum + lines.length, 0);
    const bandHeight =
      notes.length > 0 ? 12 /* label */ + noteLineCount * 11 + notes.length * 4 + 16 : 0;
    const bandTop = pageHeight - MARGIN - bandHeight;
    // Body must stop above the band (when present) or above the footer.
    const bodyBottom = notes.length > 0 ? bandTop - 14 : pageHeight - MARGIN - 14;

    const startSlide = (continued: boolean) => {
      doc.addPage();
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.setTextColor(20);
      doc.text(continued ? `${heading} (continued)` : heading, MARGIN, MARGIN + 24);
      return MARGIN + 48;
    };

    let y = startSlide(false);

    // Lead paragraph(s): section_intro framing prose.
    for (const intro of intros) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);
      doc.setTextColor(70);
      const lines = doc.splitTextToSize(winAnsiSafe(intro.display_text), contentWidth);
      if (y + lines.length * 14 > bodyBottom) y = startSlide(true);
      doc.text(lines, MARGIN, y);
      y += lines.length * 14 + 8;
    }

    // Evidence-backed bullets.
    for (const bullet of bullets) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10.5);
      doc.setTextColor(30);
      const lines = doc.splitTextToSize(winAnsiSafe(formatBulletText(bullet)), contentWidth - 14);
      if (y + lines.length * 13 > bodyBottom) y = startSlide(true);
      doc.text('•', MARGIN, y);
      doc.text(lines, MARGIN + 14, y);
      y += lines.length * 13 + 6;
    }

    // Speaker-notes band — visually separate: full-width tinted panel with a
    // top rule, pinned to the slide bottom, carrying the structural
    // sponsor-confirmation label. Drawn on the section's last slide.
    if (notes.length > 0) {
      doc.setFillColor(244, 244, 246);
      doc.rect(MARGIN, bandTop, contentWidth, bandHeight, 'F');
      doc.setDrawColor(180, 180, 190);
      doc.setLineWidth(0.75);
      doc.line(MARGIN, bandTop, MARGIN + contentWidth, bandTop);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(90);
      doc.text(SIV_SPEAKER_NOTES_BAND_LABEL, MARGIN + 8, bandTop + 14);

      let noteY = bandTop + 28;
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(60);
      for (const lines of noteLineChunks) {
        doc.text(lines, MARGIN + 8, noteY);
        noteY += lines.length * 11 + 4;
      }
    }
  }

  // ---- Source traceability appendix -----------------------------------------
  // protocol_fact blocks only — framing / speaker notes / human blocks have
  // no provenance to cite; listing them would manufacture false provenance.
  // Quotes stay OUT of the PDF (in-app drawer only).
  const factBlocks = packet.blocks.filter((b) => b.content_origin === 'protocol_fact');
  if (factBlocks.length > 0) {
    doc.addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.text('Source traceability', MARGIN, MARGIN + 24);

    autoTable(doc, {
      startY: MARGIN + 36,
      margin: { left: MARGIN, right: MARGIN },
      head: [['#', 'Item', 'Protocol section', 'Page']],
      body: factBlocks.map((block, i) => [
        String(i + 1),
        winAnsiSafe(truncateForAppendix(block.display_text)),
        winAnsiSafe(block.source_section ?? '—'),
        block.source_page_number !== null ? String(block.source_page_number) : '—',
      ]),
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8,
        cellPadding: 4,
        textColor: [60, 60, 60],
        lineColor: [220, 220, 220],
        lineWidth: 0.5,
      },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [60, 60, 60],
        fontStyle: 'bold',
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 22 },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 150 },
        3: { cellWidth: 40 },
      },
    });
    // Note: the appendix is the deck's last table, so jspdf-autotable's
    // lastAutoTable.finalY is never read here (unlike the checklist builder,
    // which needs it to stack tables).
  }

  // ---- DRAFT watermark + header + footer on every page -----------------------
  // COPIED chrome pattern from deliverablesExportApi.ts (drawn inline there,
  // module-private; import would cycle). Watermark tuning per the VEW
  // worksheet precedent: quiet by design — opacity 0.06, light gray, 90pt.
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);

    const watermarkGState = doc.GState({ opacity: 0.06 });
    doc.setGState(watermarkGState);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(90);
    doc.setTextColor(180, 180, 180);
    doc.text('DRAFT', pageWidth / 2, pageHeight / 2, {
      align: 'center',
      angle: 45,
      baseline: 'middle',
    });
    doc.setGState(doc.GState({ opacity: 1 }));

    // Header band — pages 2+ only (the title slide draws SIV_DECK_TITLE_BAND
    // at the same spot, so every page carries exactly one DRAFT band).
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(SIV_DECK_HEADER_LABEL, MARGIN, MARGIN - 12);
      if (packet.protocol_code) {
        doc.setFont('helvetica', 'normal');
        doc.text(winAnsiSafe(packet.protocol_code), pageWidth - MARGIN, MARGIN - 12, { align: 'right' });
      }
    }

    // Footer band — disclaimer left, generated_at + pagination right.
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120);
    const disclaimerLines = doc.splitTextToSize(
      SIV_DECK_EXPORT_DISCLAIMER,
      pageWidth - MARGIN * 2 - 160,
    );
    doc.text(disclaimerLines, MARGIN, pageHeight - MARGIN + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(formatGeneratedAt(packet.generated_at), pageWidth - MARGIN, pageHeight - MARGIN + 8, {
      align: 'right',
    });
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - MARGIN, pageHeight - MARGIN + 20, {
      align: 'right',
    });
  }

  return doc;
}
