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
import { formatProtocolRefWhere, formatReportDate, type IsaReportPacket } from './isaReportModel';
import { RESPONSE_REQUIREMENTS } from './isaReportClipboard';
import type { IsaFindingObject, IsaProtocolRef } from '../../types/audit';

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
  for (const ref of f.protocol_refs ?? []) {
    out.push(p(protocolRefText(ref), { italics: true }));
  }
  if (f.reference) out.push(p(`Reference: ${f.reference}`, { italics: true }));
  return out;
}

/** "Protocol requirement: § 6.3 (p. 47) — “…”" — the S4 bridge line, above
 *  the regulatory reference (the site's own commitment first). Same wording
 *  as the clipboard flavors via the shared formatter. */
function protocolRefText(ref: IsaProtocolRef): string {
  return `Protocol requirement: ${formatProtocolRefWhere(ref)} — “${ref.quote}”`;
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

// -----------------------------------------------------------------------------
// Audit observation form — the auditee-facing response vehicle as .docx.
// Same packet; response cells are left empty for the auditee, with the
// severity-keyed requirement stated inside each cell.
// -----------------------------------------------------------------------------

const OWNER_LABELS: Record<string, string> = {
  SITE: 'Site',
  CLIENT: 'Client',
  CRO: 'CRO',
};

const FORM_RESPONSE_INTRO =
  'The audit observations and/or recommendations listed below were found during the audit. ' +
  'For each observation, provide: the root cause (required for Critical and Major observations), ' +
  'what was done to correct the issue, and a corrective action plan describing how recurrence ' +
  'will be prevented, the responsible person(s), and the estimated date of completion. ' +
  'Root cause analysis and corrective actions should address the observation itself, rather ' +
  'than only the specific examples cited as objective evidence.';

function richCell(paragraphs: Paragraph[], widthDxa: number): TableCell {
  return new TableCell({
    width: { size: widthDxa, type: WidthType.DXA },
    children: paragraphs.length > 0 ? paragraphs : [new Paragraph('')],
  });
}

function smallP(text: string, opts: { bold?: boolean; italics?: boolean } = {}): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: opts.bold, italics: opts.italics, size: 18 })],
    spacing: { after: 60 },
  });
}

export function buildIsaObservationFormDocx(packet: IsaReportPacket): Promise<Blob> {
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
  children.push(h('Audit Observation Form', HeadingLevel.HEADING_1));

  const metaRows: [string, string][] = [
    ['Auditee', meta.auditeeName],
    ...(meta.siteNumber ? ([['Site number', meta.siteNumber]] as [string, string][]) : []),
    ...(meta.principalInvestigator
      ? ([['Principal investigator', meta.principalInvestigator]] as [string, string][])
      : []),
    ...(meta.protocolCode ? ([['Protocol', meta.protocolCode]] as [string, string][]) : []),
    ...(meta.auditDate ? ([['Audit date(s)', meta.auditDate]] as [string, string][]) : []),
    ['Form generated', formatReportDate(meta.generatedAt)],
    ['Response due', packet.responseClause],
  ];
  children.push(metaTable(metaRows));

  children.push(h('Auditee response process', HeadingLevel.HEADING_2));
  children.push(p(FORM_RESPONSE_INTRO));

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

  children.push(h('Observations', HeadingLevel.HEADING_2));
  const wNum = Math.round(CONTENT_DXA * 0.05);
  const wClass = Math.round(CONTENT_DXA * 0.14);
  const wCat = Math.round(CONTENT_DXA * 0.18);
  const wObs = Math.round(CONTENT_DXA * 0.38);
  const wResp = CONTENT_DXA - wNum - wClass - wCat - wObs;

  const headerRow = new TableRow({
    children: [
      cell('#', wNum, true),
      cell('Classification', wClass, true),
      cell('Category', wCat, true),
      cell('Observation & evidence', wObs, true),
      cell('Response', wResp, true),
    ],
  });

  const bodyRows: TableRow[] = [];
  let index = 0;
  for (const group of packet.groups) {
    for (const f of group.findings) {
      index++;
      const obsParas: Paragraph[] = [smallP(f.title, { bold: true }), smallP(f.observation)];
      for (const ev of f.evidence) obsParas.push(smallP(`– ${ev.text}`));
      for (const ref of f.protocol_refs ?? []) {
        obsParas.push(smallP(protocolRefText(ref), { italics: true }));
      }
      if (f.reference) obsParas.push(smallP(`Reference: ${f.reference}`, { italics: true }));

      bodyRows.push(
        new TableRow({
          children: [
            richCell([smallP(String(index))], wNum),
            richCell(
              [
                smallP(SEVERITY_LABELS[f.severity], { bold: true }),
                smallP(`Owner: ${OWNER_LABELS[f.response_owner]}`),
              ],
              wClass,
            ),
            richCell(
              [
                smallP(
                  `${ISA_DOMAIN_LABELS[f.isa_domain]}${f.subcategory ? ` – ${f.subcategory}` : ''}`,
                ),
              ],
              wCat,
            ),
            richCell(obsParas, wObs),
            richCell(
              [
                smallP(RESPONSE_REQUIREMENTS[f.severity], { italics: true }),
                new Paragraph(''),
                new Paragraph(''),
                new Paragraph(''),
              ],
              wResp,
            ),
          ],
        }),
      );
    }
  }
  children.push(
    new Table({
      columnWidths: [wNum, wClass, wCat, wObs, wResp],
      width: { size: CONTENT_DXA, type: WidthType.DXA },
      rows: [headerRow, ...bodyRows],
    }),
  );

  children.push(h('Signatures', HeadingLevel.HEADING_2));
  const wRole = Math.round(CONTENT_DXA * 0.4);
  const wSig = Math.round(CONTENT_DXA * 0.35);
  const wDate = CONTENT_DXA - wRole - wSig;
  children.push(
    new Table({
      columnWidths: [wRole, wSig, wDate],
      width: { size: CONTENT_DXA, type: WidthType.DXA },
      rows: [
        new TableRow({
          children: [cell('Role', wRole, true), cell('Name / signature', wSig, true), cell('Date', wDate, true)],
        }),
        ...['Auditor', 'Auditee representative completing response', 'Response accepted by'].map(
          (role) =>
            new TableRow({
              children: [richCell([smallP(role)], wRole), richCell([], wSig), richCell([], wDate)],
            }),
        ),
      ],
    }),
  );

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
