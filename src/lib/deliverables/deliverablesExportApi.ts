// =============================================================================
// Protocol Deliverable Engine — Export pipeline (Phase 1).
//
// Three layers, each separately testable. The shape is COPIED from
// src/lib/visit-execution/visitExecutionExportApi.ts — copied, not imported:
// mode isolation forbids cross-lane imports, and per plan decision 1 the
// ~40 lines of PDF chrome are duplicated until a second builder exists.
//
//   1. fetchDeliverableExportPacket — supabase.rpc('deliverable_export_packet').
//        Returns DeliverablesResult<T> (no throw outside programmer-error
//        guards). No mock mode — the plan's mock data plan is "none".
//
//   2. buildDeliverablePdf — pure function: packet → jsPDF document.
//        No DOM, no Blob, no download — testable without jsdom shenanigans.
//
//   3. downloadDeliverable — orchestrates fetch + build + save, dispatching
//        on packet.artifact_type: 'siv_package' → exporters/buildSivDeck
//        (landscape deck), everything else → buildDeliverablePdf below.
//        Returns DeliverablesResult<{filename, blockCount}>.
//
// Draft-only vocabulary: every page carries a DRAFT watermark, the
// "PIQC drafted" header band, and the requires-human-review disclaimer.
//
// Sponsor-name-free: the RPC never selects protocols.sponsor, and this
// builder renders ONLY these packet fields: title, protocol_code,
// protocol_title, protocol_version, generated_at, and per-block
// display_text / content_origin / confidence_state / review_state /
// source_section / source_page_number. deliverable_id, artifact_type,
// source_evidence_id, and source_quote are never drawn.
//
// SENSITIVE: source_quote and review notes are never rendered in this PDF
// (traceability quotes live in the in-app drawer) and never logged — the
// export log at the bottom is counts-only.
// =============================================================================

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from '../supabase';
import type {
  DeliverableArtifactType,
  DeliverableExportPacket,
  DeliverablePacketBlock,
  DeliverablesResult,
} from '../../types/deliverables';
import {
  CONFIDENCE_LABELS,
  CONTENT_ORIGIN_LABELS,
  REVIEW_STATE_LABELS,
  groupBlocksBySection,
} from '../../types/deliverables';
import {
  DELIVERABLE_EXPORT_CONFIGS,
  isExportableArtifactType,
} from './deliverableExportConfig';
import { buildSivDeck } from './exporters/buildSivDeck';
import { winAnsiSafe } from '../winAnsiSafe';

/**
 * jspdf-autotable patches the jsPDF instance with `lastAutoTable` after each
 * autoTable() call so callers can read where the table ended. The library
 * ships no type augmentation for this, so we declare a narrow shape here
 * (used only to read .finalY between autoTables). Avoids `as any`.
 */
interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY?: number };
}

// ---------------------------------------------------------------------------
// Disclaimer + naming constants
// ---------------------------------------------------------------------------

// Back-compat re-exports of the monitoring entry (stable imports for existing
// consumers + tests). Every artifact type now carries its own label/disclaimer
// in deliverableExportConfig; buildDeliverablePdf reads them per packet.
export const DELIVERABLE_EXPORT_DISCLAIMER =
  DELIVERABLE_EXPORT_CONFIGS.monitoring_prep_checklist.disclaimer;

export const DELIVERABLE_EXPORT_HEADER_LABEL =
  DELIVERABLE_EXPORT_CONFIGS.monitoring_prep_checklist.headerLabel;

// ---------------------------------------------------------------------------
// Filename helpers
// ---------------------------------------------------------------------------

/**
 * Slugify a name for filesystem-safe filenames: lowercase, alphanumerics +
 * dashes + underscores only, collapse runs of separators.
 */
export function slugifyForFilename(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

/**
 * Extract the YYYY-MM-DD date portion from an ISO 8601 timestamp.
 *
 * Uses UTC (matches the PDF footer's `Generated YYYY-MM-DD HH:MM UTC`
 * format). The packet's `generated_at` is server-stamped at export-fetch
 * time — pulling the date from THAT source means the filename always
 * matches the footer regardless of browser timezone.
 *
 * Falls back to today's UTC date if the input is unparseable (defensive —
 * the RPC should never return a malformed timestamp, but the API boundary
 * shouldn't crash the export over it).
 */
export function isoDateForFilename(iso: string): string {
  try {
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  } catch {
    // Fall through to today's date.
  }
  const fallback = new Date();
  const m = String(fallback.getUTCMonth() + 1).padStart(2, '0');
  const day = String(fallback.getUTCDate()).padStart(2, '0');
  return `${fallback.getUTCFullYear()}-${m}-${day}`;
}

/**
 * Build the filename for an exported deliverable:
 *   `<protocol_code-slug>_<artifact-slug>_draft_<YYYY-MM-DD>.pdf`
 *
 * The artifact slug comes from the per-type export config (so
 * monitoring_prep_checklist, siv_package, site_training_priorities, … each get
 * their own). Protocol code falls back to the literal `protocol` when null (the
 * export packet carries no protocol_id to prefix with). Date comes from
 * `packet.generated_at` (server-stamped) NOT the browser clock — filename and
 * footer timestamp must agree.
 */
export function buildDeliverableFilename(
  packet: Pick<DeliverableExportPacket, 'protocol_code' | 'generated_at' | 'artifact_type'>,
): string {
  const code = packet.protocol_code ? slugifyForFilename(packet.protocol_code) : 'protocol';
  const slug = DELIVERABLE_EXPORT_CONFIGS[packet.artifact_type].filenameSlug;
  return `${code}_${slug}_draft_${isoDateForFilename(packet.generated_at)}.pdf`;
}

// ---------------------------------------------------------------------------
// Layer 1 — fetch
// ---------------------------------------------------------------------------

/**
 * Fetch the server-stamped export packet for one deliverable. Wraps the
 * SECURITY INVOKER RPC (RLS is the access gate) + defensive narrowing at
 * the boundary — drop rather than crash.
 */
export async function fetchDeliverableExportPacket(
  deliverableId: string,
): Promise<DeliverablesResult<DeliverableExportPacket>> {
  const { data, error } = await supabase.rpc('deliverable_export_packet', {
    p_deliverable_id: deliverableId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = data as Partial<DeliverableExportPacket> | null;
  if (
    !payload ||
    typeof payload.deliverable_id !== 'string' ||
    typeof payload.title !== 'string' ||
    typeof payload.generated_at !== 'string' ||
    !Array.isArray(payload.blocks)
  ) {
    return { ok: false, error: 'malformed export packet' };
  }

  // Any known artifact type passes through; an unrecognized value degrades to
  // the checklist rendering. The whitelist is the export config's own keys.
  const artifactType: DeliverableArtifactType = isExportableArtifactType(payload.artifact_type)
    ? payload.artifact_type
    : 'monitoring_prep_checklist';

  return {
    ok: true,
    data: {
      deliverable_id: payload.deliverable_id,
      protocol_code: typeof payload.protocol_code === 'string' ? payload.protocol_code : null,
      protocol_title:
        typeof payload.protocol_title === 'string' ? payload.protocol_title : 'Untitled protocol',
      artifact_type: artifactType,
      title: payload.title,
      protocol_version:
        typeof payload.protocol_version === 'string' ? payload.protocol_version : null,
      generated_at: payload.generated_at,
      blocks: payload.blocks,
    },
  };
}

// ---------------------------------------------------------------------------
// Layer 2 — pure PDF build
// ---------------------------------------------------------------------------

/** Max characters for an appendix "Item" cell before truncation. */
const APPENDIX_ITEM_MAX = 100;

/**
 * Truncate a block's display text for the traceability appendix. The
 * appendix is a lookup aid — the full text lives in the body table above.
 */
export function truncateForAppendixItem(text: string): string {
  if (text.length <= APPENDIX_ITEM_MAX) return text;
  return `${text.slice(0, APPENDIX_ITEM_MAX - 1).trimEnd()}…`;
}

/**
 * "Item" cell for a body-table row. human_editorial rows get an appended
 * attribution line so a reader of the printed page can tell reviewer-added
 * content from PIQC's draft at a glance.
 */
function formatItemCell(block: DeliverablePacketBlock): string {
  if (block.content_origin === 'human_editorial') {
    return `${block.display_text}\n(Added by reviewer)`;
  }
  return block.display_text;
}

/**
 * "Confidence" cell: facts carry a confidence label; framing and human
 * blocks carry '—' — framing never claims confidence (no false provenance).
 */
function formatConfidenceCell(block: DeliverablePacketBlock): string {
  return block.confidence_state ? CONFIDENCE_LABELS[block.confidence_state] : '—';
}

/**
 * Format the server-stamped timestamp into a "Generated YYYY-MM-DD HH:MM UTC"
 * line for the title block + PDF footer.
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
 * Pure function: packet → jsPDF document.
 *
 * Layout (A4 portrait):
 *   - First page only: title block (deliverable title, protocol title +
 *     code, protocol version, generated timestamp, block counts)
 *   - All pages: header band ("PIQC drafted · Monitoring preparation
 *     checklist · DRAFT") + DRAFT watermark + footer band (disclaimer +
 *     Generated <ts> + Page X of Y)
 *   - Body: one autotable per NON-EMPTY section, in
 *     MONITORING_SECTION_ORDER (via groupBlocksBySection). Columns:
 *     Item | Origin | Confidence | Review.
 *   - Last: "Source traceability" appendix — protocol_fact blocks only,
 *     Item (truncated) | Protocol section | Page.
 *
 * Returns the jsPDF instance so callers can .save() / .output() / inspect
 * in tests.
 */
export function buildDeliverablePdf(packet: DeliverableExportPacket): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 48;

  // Per-artifact export vocabulary (section order/labels, header band label,
  // footer disclaimer). Monitoring output is byte-identical because its config
  // entry reproduces the former hardcoded constants.
  const config = DELIVERABLE_EXPORT_CONFIGS[packet.artifact_type];

  // Block counts for the title-block stats line. "Needs review" counts OPEN
  // work: untouched drafts AND human-flagged blocks — a fresh never-reviewed
  // draft must not read as "0 needs review" on a compliance-adjacent
  // artifact (same discipline as the VEW worksheet's to-review count).
  const totalCount = packet.blocks.length;
  const reviewedCount = packet.blocks.filter((b) => b.review_state === 'reviewed').length;
  const needsReviewCount = packet.blocks.filter(
    (b) => b.review_state === 'draft' || b.review_state === 'needs_review',
  ).length;

  // ---- Title block (first page) -------------------------------------------
  let cursorY = margin + 28;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(config.headerLabel, margin, margin);

  doc.setTextColor(20);
  doc.setFontSize(18);
  const titleLines = doc.splitTextToSize(winAnsiSafe(packet.title), pageWidth - margin * 2);
  doc.text(titleLines, margin, cursorY);
  cursorY += titleLines.length * 20 + 2;

  // Protocol title + code on one line. NO sponsor — sponsor-name-free.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(110);
  const codeLabel = packet.protocol_code
    ? `${packet.protocol_title} · ${packet.protocol_code}`
    : packet.protocol_title;
  const codeLines = doc.splitTextToSize(winAnsiSafe(codeLabel), pageWidth - margin * 2);
  doc.text(codeLines, margin, cursorY);
  cursorY += codeLines.length * 12 + 2;

  // Protocol version — explicit "not extracted" beats a silent blank: the
  // reader must know whether version-stamping happened, not guess.
  doc.text(
    packet.protocol_version
      ? `Protocol version: ${winAnsiSafe(packet.protocol_version)}`
      : 'Protocol version: not extracted',
    margin,
    cursorY,
  );
  cursorY += 14;

  doc.text(formatGeneratedAt(packet.generated_at), margin, cursorY);
  cursorY += 14;

  // Stats line. The open count is colored amber when non-zero so a reader
  // scanning the title block sees outstanding review work at a glance.
  doc.setTextColor(60);
  const baseStatsLine = `${totalCount} items · ${reviewedCount} reviewed · `;
  doc.text(baseStatsLine, margin, cursorY);
  const baseWidth = doc.getTextWidth(baseStatsLine);
  if (needsReviewCount > 0) {
    doc.setTextColor(180, 83, 9); // amber-700, print-tuned (VEW precedent)
    doc.setFont('helvetica', 'bold');
  }
  doc.text(`${needsReviewCount} needs review`, margin + baseWidth, cursorY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(60);
  cursorY += 22;

  // ---- Per-section autotables ----------------------------------------------
  // groupBlocksBySection hides empty sections and preserves the artifact's
  // section order + per-section sort_order.
  for (const { sectionKey, blocks } of groupBlocksBySection(
    packet.blocks,
    config.sectionOrder,
  )) {
    if (cursorY > pageHeight - margin - 80) {
      doc.addPage();
      cursorY = margin + 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(winAnsiSafe(config.sectionLabels[sectionKey] ?? sectionKey), margin, cursorY);
    cursorY += 4;

    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: margin, right: margin },
      head: [['Item', 'Origin', 'Confidence', 'Review']],
      body: blocks.map((block) => [
        winAnsiSafe(formatItemCell(block)),
        CONTENT_ORIGIN_LABELS[block.content_origin],
        formatConfidenceCell(block),
        REVIEW_STATE_LABELS[block.review_state],
      ]),
      theme: 'grid',
      styles: {
        font: 'helvetica',
        fontSize: 8.5,
        cellPadding: 4,
        textColor: [30, 30, 30],
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
        0: { cellWidth: 'auto' }, // Item (multi-line)
        1: { cellWidth: 72 },     // Origin
        // Wide enough that "Medium confidence" (the longest label) never
        // wraps mid-phrase — a wrapped label reads as two rows on paper.
        2: { cellWidth: 92 },     // Confidence
        3: { cellWidth: 72 },     // Review
      },
    });

    const augmented = doc as JsPDFWithAutoTable;
    const finalY = augmented.lastAutoTable?.finalY ?? cursorY + 100;
    cursorY = finalY + 20;
  }

  // ---- Source traceability appendix ----------------------------------------
  // protocol_fact blocks only — framing and human blocks have no provenance
  // to cite, and listing them here would manufacture false provenance.
  // Quotes stay OUT of the PDF (in-app drawer only); section + page keep the
  // audit chain on the printed artifact.
  const factBlocks = packet.blocks.filter((b) => b.content_origin === 'protocol_fact');
  if (factBlocks.length > 0) {
    if (cursorY > pageHeight - margin - 80) {
      doc.addPage();
      cursorY = margin + 20;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text('Source traceability', margin, cursorY);
    cursorY += 4;

    autoTable(doc, {
      startY: cursorY + 6,
      margin: { left: margin, right: margin },
      head: [['#', 'Item', 'Protocol section', 'Page']],
      body: factBlocks.map((block, i) => [
        String(i + 1),
        winAnsiSafe(truncateForAppendixItem(block.display_text)),
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
        2: { cellWidth: 130 },
        3: { cellWidth: 40 },
      },
    });
  }

  // ---- DRAFT watermark + header + footer on every page ---------------------
  // jsPDF has no "draw on every page" hook for autotable's added pages;
  // iterate after the body's done. Watermark tuning copied from the VEW
  // worksheet (founder direction post-#141): quiet by design — opacity 0.06,
  // light gray, 90pt. The compliance signal is carried in depth by the
  // corner label, footer disclaimer, and server-stamped timestamp.
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

    // Header band — pages 2+ only (page 1 draws the label atop the title
    // block, so every page carries it exactly once).
    if (i > 1) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(140);
      doc.text(config.headerLabel, margin, margin - 12);
      if (packet.protocol_code) {
        doc.setFont('helvetica', 'normal');
        doc.text(winAnsiSafe(packet.protocol_code), pageWidth - margin, margin - 12, { align: 'right' });
      }
    }

    // Footer band — disclaimer left, generated_at + pagination right.
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(120);
    const disclaimerLines = doc.splitTextToSize(
      config.disclaimer,
      pageWidth - margin * 2 - 140,
    );
    doc.text(disclaimerLines, margin, pageHeight - margin + 8);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(formatGeneratedAt(packet.generated_at), pageWidth - margin, pageHeight - margin + 8, {
      align: 'right',
    });
    doc.text(`Page ${i} of ${pageCount}`, pageWidth - margin, pageHeight - margin + 20, {
      align: 'right',
    });
  }

  return doc;
}

// ---------------------------------------------------------------------------
// Layer 3 — download orchestrator
// ---------------------------------------------------------------------------

interface DownloadOptions {
  /** Override for Blob + click (used by tests). */
  triggerDownload?: (filename: string, doc: jsPDF) => void;
}

function defaultDownload(filename: string, doc: jsPDF) {
  // jsPDF.save() handles Blob construction + anchor click + revokeObjectURL.
  doc.save(filename);
}

/**
 * Orchestrates fetch + build + save for one deliverable export.
 *
 * Returns DeliverablesResult<{filename, blockCount}> — on success, the
 * filename delivered to the browser; on failure, a human-friendly error
 * message the caller can show in a banner.
 */
export async function downloadDeliverable(
  deliverableId: string,
  opts: DownloadOptions = {},
): Promise<DeliverablesResult<{ filename: string; blockCount: number }>> {
  const fetchResult = await fetchDeliverableExportPacket(deliverableId);
  if (!fetchResult.ok) return fetchResult;

  // Builder dispatch: the SIV package renders through its own landscape deck
  // builder; every other type goes through the config-driven portrait builder.
  // The filename is config-driven for ALL types (one helper).
  const packet = fetchResult.data;
  const isSivDeck = packet.artifact_type === 'siv_package';
  const doc = isSivDeck ? buildSivDeck(packet) : buildDeliverablePdf(packet);
  const filename = buildDeliverableFilename(packet);

  try {
    (opts.triggerDownload ?? defaultDownload)(filename, doc);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to trigger download',
    };
  }

  // Counts-only log — no block content, quotes, or notes go to the console.
  console.info('[deliverables] exported', {
    artifactType: packet.artifact_type,
    deliverableId,
    blockCount: packet.blocks.length,
    filename,
  });

  return { ok: true, data: { filename, blockCount: packet.blocks.length } };
}
