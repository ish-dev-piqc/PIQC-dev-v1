import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { groupDocumentRequestItems } from './documentRequest';
import { SUBJECT_SELECTION_NOTICE } from './documentRequestVocabulary';
import {
  LETTER_CLOSING,
  LETTER_TITLE,
  NO_DOCUMENTS_LINE,
  SIGNATORY_ROLE,
  letterBannerText,
  letterMetaRows,
  letterPurpose,
  type DocumentRequestPacket,
} from './documentRequestLetter';
import type { DocumentRequestItem } from '../../types/audit';

// =============================================================================
// Document request .docx builder — renders the DocumentRequestPacket as a
// Word document. Same content as the HTML / plain flavors: the banner, the
// addressee rows, the purpose sentence and the closing come from
// documentRequestLetter.ts, the grouping from documentRequest.ts, the
// subject-level paragraph from the vocabulary — one packet, three renderers
// that cannot disagree.
//
// docx-lib footguns handled here (isaReportDocx.ts precedent): tables carry
// BOTH table-level columnWidths and per-cell widths in DXA; page size is US
// Letter (docx defaults to A4). No bullets, so no numbering config.
//
// The APPROVED banner is the first paragraph — provenance travels inside the
// artifact. Group headings are domain labels only; the criticality PIQC
// derived never reaches the site. Sponsor branding is added externally.
// =============================================================================

// US Letter in DXA (1440 per inch).
const PAGE = { width: 12240, height: 15840 };
// Content width at 1" margins.
const CONTENT_DXA = PAGE.width - 2 * 1440;

function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function p(text: string, opts: { bold?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold })],
    spacing: { after: 120 },
  });
}

/** Multi-line auditor text → one paragraph per line (docx has no <br>). */
function multiline(text: string): Paragraph[] {
  return text.split('\n').map((line) => p(line));
}

function textCell(text: string, widthDxa: number, bold = false): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: [new Paragraph({ children: [new TextRun({ text, bold, size: 19 })] })],
  });
}

function documentCell(item: DocumentRequestItem, widthDxa: number): TableCell {
  const children = [new Paragraph({ children: [new TextRun({ text: item.title, bold: true, size: 19 })] })];
  if (item.detail) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: item.detail, size: 17, color: '555555' })] }),
    );
  }
  return new TableCell({ width: { size: widthDxa, type: WidthType.DXA }, children });
}

function notesCell(note: string, widthDxa: number): TableCell {
  const lines = note.trim() ? note.trim().split('\n') : [''];
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: lines.map((line) => new Paragraph({ children: [new TextRun({ text: line, size: 19 })] })),
  });
}

function metaTable(rows: [string, string][]): Table {
  const label = Math.round(CONTENT_DXA * 0.3);
  const value = CONTENT_DXA - label;
  return new Table({
    columnWidths: [label, value],
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    rows: rows.map(
      ([k, v]) => new TableRow({ children: [textCell(k, label, true), textCell(v, value)] }),
    ),
  });
}

const NUMBER_DXA = Math.round(CONTENT_DXA * 0.06);
const NOTES_DXA = Math.round(CONTENT_DXA * 0.36);
const DOCUMENT_DXA = CONTENT_DXA - NUMBER_DXA - NOTES_DXA;

function groupTable(items: DocumentRequestItem[], firstNumber: number): Table {
  const header = new TableRow({
    tableHeader: true,
    children: [
      textCell('#', NUMBER_DXA, true),
      textCell('Document', DOCUMENT_DXA, true),
      textCell('Notes', NOTES_DXA, true),
    ],
  });
  const rows = items.map(
    (item, i) =>
      new TableRow({
        children: [
          textCell(String(firstNumber + i), NUMBER_DXA),
          documentCell(item, DOCUMENT_DXA),
          notesCell(item.note, NOTES_DXA),
        ],
      }),
  );
  return new Table({
    columnWidths: [NUMBER_DXA, DOCUMENT_DXA, NOTES_DXA],
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    rows: [header, ...rows],
  });
}

export function buildDocumentRequestDocx(packet: DocumentRequestPacket): Promise<Blob> {
  const { content } = packet;
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({ text: letterBannerText(packet), bold: true, color: '1B5E20' })],
    }),
  );
  children.push(h(LETTER_TITLE, HeadingLevel.HEADING_1));
  children.push(metaTable(letterMetaRows(packet)));
  children.push(new Paragraph({ spacing: { before: 120 }, children: [new TextRun(letterPurpose(packet))] }));

  const instructions = content.instructions.trim();
  if (instructions) {
    children.push(h('Delivery instructions', HeadingLevel.HEADING_2));
    children.push(...multiline(instructions));
  }

  children.push(h('Documents requested', HeadingLevel.HEADING_2));
  const groups = groupDocumentRequestItems(content, true);
  if (groups.length === 0) children.push(p(NO_DOCUMENTS_LINE));
  let n = 0;
  for (const group of groups) {
    // Heading only — never the criticality.
    children.push(h(group.heading, HeadingLevel.HEADING_3));
    children.push(groupTable(group.items, n + 1));
    n += group.items.length;
  }

  children.push(h('Subject-level records', HeadingLevel.HEADING_2));
  children.push(p(SUBJECT_SELECTION_NOTICE));
  const sampling = content.sampling_approach.trim();
  if (sampling) {
    const [first, ...rest] = sampling.split('\n');
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: 'Sampling approach. ', bold: true }), new TextRun(first)],
      }),
    );
    children.push(...rest.map((line) => p(line)));
  }

  children.push(p(LETTER_CLOSING));
  if (packet.signatoryName) children.push(p(packet.signatoryName));
  children.push(p(SIGNATORY_ROLE));

  const doc = new Document({
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height } } },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
