import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { ISA_DOMAIN_LABELS } from './labels';
import { formatReportDate, type IsaReportPacket } from './isaReportModel';
import type { IsaFindingObject } from '../../types/audit';

// =============================================================================
// ISA report .docx builder — renders the IsaReportPacket (isaReportModel.ts)
// as a Word document. Same content as the clipboard builders, one packet,
// three renderers.
//
// docx-lib footguns handled here: tables carry BOTH table-level columnWidths
// and per-cell widths in DXA; bullets use a numbering config (never literal
// glyphs); page size is US Letter (docx defaults to A4).
//
// The DRAFT / "PIQC drafted · requires human review" banner is the first
// paragraph of the document — provenance travels inside the artifact.
// Sponsor branding is added externally on export per the GxP rule.
// =============================================================================

const BULLET_REF = 'isa-bullets';

// US Letter in DXA (1440 per inch).
const PAGE = { width: 12240, height: 15840 };
// Content width at 1" margins.
const CONTENT_DXA = PAGE.width - 2 * 1440;

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  RECOMMENDATION: 'Recommendation',
};

function h(text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel]): Paragraph {
  return new Paragraph({ heading: level, children: [new TextRun(text)] });
}

function p(text: string, opts: { bold?: boolean; italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics })],
    spacing: { after: 120 },
  });
}

function bullet(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun(text)],
    numbering: { reference: BULLET_REF, level: 0 },
    spacing: { after: 60 },
  });
}

function cell(text: string, widthDxa: number, bold = false): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: [
      new Paragraph({ children: [new TextRun({ text, bold, size: 19 })] }),
    ],
  });
}

function metaTable(rows: [string, string][]): Table {
  const label = Math.round(CONTENT_DXA * 0.3);
  const value = CONTENT_DXA - label;
  return new Table({
    columnWidths: [label, value],
    width: { size: CONTENT_DXA, type: WidthType.DXA },
    rows: rows.map(
      ([k, v]) => new TableRow({ children: [cell(k, label, true), cell(v, value)] }),
    ),
  });
}

function findingParagraphs(f: IsaFindingObject): Paragraph[] {
  const out: Paragraph[] = [];
  out.push(
    new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [
        new TextRun({ text: `[${SEVERITY_LABELS[f.severity]}] ${f.title}`, bold: true }),
        new TextRun(
          ` — ${ISA_DOMAIN_LABELS[f.isa_domain]}${f.subcategory ? ` – ${f.subcategory}` : ''}`,
        ),
      ],
    }),
  );
  out.push(p(f.observation));
  for (const ev of f.evidence) out.push(bullet(ev.text));
  if (f.reference) out.push(p(`Reference: ${f.reference}`, { italics: true }));
  return out;
}

export function buildIsaReportDocx(packet: IsaReportPacket): Promise<Blob> {
  const { meta } = packet;
  const children: (Paragraph | Table)[] = [];

  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `DRAFT — PIQC drafted · requires human review · generated ${formatReportDate(meta.generatedAt)}`,
          bold: true,
          color: '8A6D00',
        }),
      ],
    }),
  );
  children.push(h('Investigator Site Audit Report', HeadingLevel.HEADING_1));

  const metaRows: [string, string][] = [
    ['Auditee', meta.auditeeName],
    ...(meta.siteNumber ? ([['Site number', meta.siteNumber]] as [string, string][]) : []),
    ...(meta.principalInvestigator
      ? ([['Principal investigator', meta.principalInvestigator]] as [string, string][])
      : []),
    ...(meta.siteCountry ? ([['Country', meta.siteCountry]] as [string, string][]) : []),
    ...(meta.protocolCode ? ([['Protocol', meta.protocolCode]] as [string, string][]) : []),
    ...(meta.protocolTitle ? ([['Protocol title', meta.protocolTitle]] as [string, string][]) : []),
    ['Audit type', meta.auditTypeLabel],
    ...(meta.auditDate ? ([['Audit date', meta.auditDate]] as [string, string][]) : []),
    ['Report generated', formatReportDate(meta.generatedAt)],
  ];
  children.push(metaTable(metaRows));

  children.push(h('Executive summary', HeadingLevel.HEADING_2));
  for (const line of packet.execSummary.text.split('\n')) {
    children.push(line.startsWith('• ') ? bullet(line.slice(2)) : p(line));
  }

  children.push(h('Scope and objectives', HeadingLevel.HEADING_2));
  for (const o of packet.objectives) children.push(bullet(o));

  children.push(h('Auditee background', HeadingLevel.HEADING_2));
  children.push(p(packet.auditeeBackground.text));

  children.push(h('Audit activities', HeadingLevel.HEADING_2));
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: 'Opening meeting. ', bold: true }),
        new TextRun(packet.openingMeeting.text),
      ],
    }),
  );
  children.push(
    new Paragraph({
      spacing: { after: 120 },
      children: [
        new TextRun({ text: 'Closing meeting. ', bold: true }),
        new TextRun(packet.closingMeeting.text),
      ],
    }),
  );

  if (packet.positiveObservations.length > 0) {
    children.push(h('Positive observations', HeadingLevel.HEADING_2));
    children.push(p('Positive observations included but were not limited to:'));
    for (const o of packet.positiveObservations) children.push(bullet(o));
  }

  children.push(h('Observation classifications', HeadingLevel.HEADING_2));
  for (const def of packet.severityDefinitions) {
    children.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${def.label}: `, bold: true }),
          new TextRun(def.text),
        ],
      }),
    );
  }

  const activeRows = packet.matrix.filter(
    (r) => r.critical + r.major + r.minor + r.recommendation > 0,
  );
  if (activeRows.length > 0) {
    children.push(h('Observations by category', HeadingLevel.HEADING_2));
    const catW = Math.round(CONTENT_DXA * 0.44);
    const numW = Math.round((CONTENT_DXA - catW) / 4);
    children.push(
      new Table({
        columnWidths: [catW, numW, numW, numW, CONTENT_DXA - catW - 3 * numW],
        width: { size: CONTENT_DXA, type: WidthType.DXA },
        rows: [
          new TableRow({
            children: [
              cell('Category', catW, true),
              cell('Critical', numW, true),
              cell('Major', numW, true),
              cell('Minor', numW, true),
              cell('Recommendation', CONTENT_DXA - catW - 3 * numW, true),
            ],
          }),
          ...activeRows.map(
            (r) =>
              new TableRow({
                children: [
                  cell(r.label, catW),
                  cell(r.critical ? String(r.critical) : '', numW),
                  cell(r.major ? String(r.major) : '', numW),
                  cell(r.minor ? String(r.minor) : '', numW),
                  cell(
                    r.recommendation ? String(r.recommendation) : '',
                    CONTENT_DXA - catW - 3 * numW,
                  ),
                ],
              }),
          ),
        ],
      }),
    );
  }

  children.push(h('Audit observations', HeadingLevel.HEADING_2));
  let any = false;
  for (const group of packet.groups) {
    if (group.findings.length === 0) continue;
    any = true;
    children.push(h(`${group.heading} (${group.findings.length})`, HeadingLevel.HEADING_3));
    for (const f of group.findings) children.push(...findingParagraphs(f));
  }
  if (!any) children.push(p('No observations were recorded.'));

  children.push(h('Response', HeadingLevel.HEADING_2));
  children.push(p(packet.responseClause));
  children.push(
    p(
      'Responses to Critical and Major observations must include root cause, correction, and a corrective action plan with responsible person(s) and target completion dates.',
    ),
  );

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 360, hanging: 180 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: PAGE.width, height: PAGE.height } } },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
