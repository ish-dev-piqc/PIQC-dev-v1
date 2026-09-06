import { formatReportDate, type IsaReportMeta } from './isaReportModel';
import { groupDocumentRequestItems } from './documentRequest';
import { SUBJECT_SELECTION_NOTICE } from './documentRequestVocabulary';
import type { DocumentRequestContent } from '../../types/audit';

// =============================================================================
// Document request letter — paste-ready HTML + plain text (isa-document-
// request). The letter that leaves PIQC for the site.
//
// Same rules as isaReportClipboard.ts (Word's HTML parser is the constraint):
// inline `style=""` on every element, <table> for anything tabular, pt font
// sizes, the provenance banner PART OF THE PAYLOAD. The style constants and
// the escapers are a second copy of that module's privates — the third
// caller extracts them (ledgered).
//
// What this letter says, and does not say — the owner's rules as the QA
// auditor:
//   - Group headings are domain labels only. The site never sees the
//     criticality PIQC derived; that ranking stays inside the workspace.
//   - Subjects are selected during the audit. The fixed subject-level
//     paragraph (SUBJECT_SELECTION_NOTICE) and the auditor's sampling
//     approach statement replace any list of subjects — no subject
//     identifier can appear here because none exists in the content.
//   - Everything is available at the site on the audit dates; delivery
//     instructions carry the exceptions. No due date.
//   - The banner reads APPROVED, not DRAFT: nothing generates this document
//     and it only exports after the house approval latch.
//   - No sponsor names: the packet reuses IsaReportMeta, which has none.
//
// Pure module: no DOM, no clipboard API. The .docx renderer
// (documentRequestDocx.ts) imports the shared pieces below so the three
// renderers cannot disagree.
// =============================================================================

export interface DocumentRequestPacket {
  meta: IsaReportMeta;
  content: DocumentRequestContent;
  approvedByName: string | null;
  approvedAt: string;           // ISO; the workspace only builds a packet from an APPROVED row
  signatoryName: string | null; // the signed-in auditor's profile name
}

export const LETTER_TITLE = 'Document Request — Investigator Site Audit';
export const LETTER_CLOSING =
  'Please contact the undersigned with any questions about this request. Thank you for your cooperation.';
export const SIGNATORY_ROLE = 'Lead auditor';
export const NO_DOCUMENTS_LINE = 'No documents are requested.';

export function letterBannerText(packet: DocumentRequestPacket): string {
  const by = packet.approvedByName ? ` by ${packet.approvedByName}` : '';
  return (
    `APPROVED — reviewed and approved${by} on ${formatReportDate(new Date(packet.approvedAt))}` +
    ` · generated ${formatReportDate(packet.meta.generatedAt)}`
  );
}

/** The addressee block, in order. Rows with nothing to say are left out. */
export function letterMetaRows(packet: DocumentRequestPacket): [string, string][] {
  const { meta } = packet;
  const rows: [string, string][] = [['Site', meta.auditeeName]];
  if (meta.siteNumber) rows.push(['Site number', meta.siteNumber]);
  if (meta.principalInvestigator) rows.push(['Principal investigator', meta.principalInvestigator]);
  if (meta.siteCountry) rows.push(['Country', meta.siteCountry]);
  if (meta.protocolCode) rows.push(['Protocol', meta.protocolCode]);
  if (meta.protocolTitle) rows.push(['Protocol title', meta.protocolTitle]);
  rows.push(['Audit type', meta.auditTypeLabel]);
  if (meta.auditDate) rows.push(['Audit dates', meta.auditDate]);
  rows.push(['Request date', formatReportDate(meta.generatedAt)]);
  return rows;
}

export function letterPurpose(packet: DocumentRequestPacket): string {
  const { meta } = packet;
  const protocol = meta.protocolCode ? ` for protocol ${meta.protocolCode}` : '';
  const when = meta.auditDate ? `, scheduled for ${meta.auditDate}` : '';
  return (
    `In preparation for the ${meta.auditTypeLabel.toLowerCase()} investigator site audit of ` +
    `${meta.auditeeName}${protocol}${when}, please have the documents listed below available ` +
    'for review at the site on the audit dates. Originals or certified copies in the format ' +
    'maintained at the site are acceptable.'
  );
}

// -----------------------------------------------------------------------------
// HTML flavor
// -----------------------------------------------------------------------------

const FONT = 'font-family:Calibri,Arial,sans-serif;';
const H1 = `${FONT}font-size:16pt;font-weight:bold;margin:0 0 4pt 0;`;
const H2 = `${FONT}font-size:12pt;font-weight:bold;margin:12pt 0 4pt 0;`;
const H3 = `${FONT}font-size:11pt;font-weight:bold;margin:10pt 0 3pt 0;`;
const P = `${FONT}font-size:10.5pt;margin:0 0 6pt 0;`;
const SMALL = `${FONT}font-size:9pt;color:#555555;`;
const TABLE = 'border-collapse:collapse;width:100%;margin:0 0 8pt 0;';
const TH = `${FONT}font-size:9.5pt;font-weight:bold;border:1pt solid #999999;padding:3pt 5pt;text-align:left;background-color:#EFEFEF;`;
const TD = `${FONT}font-size:9.5pt;border:1pt solid #999999;padding:3pt 5pt;vertical-align:top;`;
const BANNER =
  `${FONT}font-size:9pt;font-weight:bold;color:#1B5E20;background-color:#EAF7EC;` +
  'border:1pt solid #7CC47F;padding:5pt 8pt;margin:0 0 10pt 0;';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Multi-line text → escaped HTML with <br> line breaks. */
function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, '<br>');
}

export function buildDocumentRequestHtml(packet: DocumentRequestPacket): string {
  const { content } = packet;
  const parts: string[] = [];

  parts.push(`<div style="${BANNER}">${esc(letterBannerText(packet))}</div>`);
  parts.push(`<h1 style="${H1}">${esc(LETTER_TITLE)}</h1>`);

  parts.push(
    `<table style="${TABLE}">` +
      letterMetaRows(packet)
        .map(
          ([k, v]) =>
            `<tr><td style="${TD}width:30%;"><strong>${esc(k)}</strong></td><td style="${TD}">${esc(v)}</td></tr>`,
        )
        .join('') +
      '</table>',
  );

  parts.push(`<p style="${P}">${esc(letterPurpose(packet))}</p>`);

  const instructions = content.instructions.trim();
  if (instructions) {
    parts.push(`<h2 style="${H2}">Delivery instructions</h2>`);
    parts.push(`<p style="${P}">${escMultiline(instructions)}</p>`);
  }

  parts.push(`<h2 style="${H2}">Documents requested</h2>`);
  const groups = groupDocumentRequestItems(content, true);
  if (groups.length === 0) {
    parts.push(`<p style="${P}">${esc(NO_DOCUMENTS_LINE)}</p>`);
  }
  let n = 0;
  for (const group of groups) {
    // Heading only — never the criticality.
    parts.push(`<h3 style="${H3}">${esc(group.heading)}</h3>`);
    const rows = group.items
      .map((item) => {
        n += 1;
        const detail = item.detail ? `<br><span style="${SMALL}">${esc(item.detail)}</span>` : '';
        return (
          `<tr><td style="${TD}width:6%;">${n}</td>` +
          `<td style="${TD}"><strong>${esc(item.title)}</strong>${detail}</td>` +
          `<td style="${TD}width:36%;">${escMultiline(item.note)}</td></tr>`
        );
      })
      .join('');
    parts.push(
      `<table style="${TABLE}"><tr><th style="${TH}">#</th><th style="${TH}">Document</th>` +
        `<th style="${TH}">Notes</th></tr>${rows}</table>`,
    );
  }

  parts.push(`<h2 style="${H2}">Subject-level records</h2>`);
  parts.push(`<p style="${P}">${esc(SUBJECT_SELECTION_NOTICE)}</p>`);
  const sampling = content.sampling_approach.trim();
  if (sampling) {
    parts.push(`<p style="${P}"><strong>Sampling approach.</strong> ${escMultiline(sampling)}</p>`);
  }

  parts.push(`<p style="${P}">${esc(LETTER_CLOSING)}</p>`);
  parts.push(
    `<p style="${P}">${packet.signatoryName ? `${esc(packet.signatoryName)}<br>` : ''}${esc(SIGNATORY_ROLE)}</p>`,
  );

  return `<div style="${FONT}">${parts.join('')}</div>`;
}

// -----------------------------------------------------------------------------
// Plain-text flavor
// -----------------------------------------------------------------------------

export function buildDocumentRequestPlain(packet: DocumentRequestPacket): string {
  const { content } = packet;
  const lines: string[] = [];

  lines.push(letterBannerText(packet));
  lines.push('');
  lines.push(LETTER_TITLE.toUpperCase());
  lines.push('');
  for (const [k, v] of letterMetaRows(packet)) lines.push(`${k}: ${v}`);
  lines.push('');
  lines.push(letterPurpose(packet));
  lines.push('');

  const instructions = content.instructions.trim();
  if (instructions) {
    lines.push('DELIVERY INSTRUCTIONS');
    lines.push(instructions);
    lines.push('');
  }

  lines.push('DOCUMENTS REQUESTED');
  const groups = groupDocumentRequestItems(content, true);
  if (groups.length === 0) lines.push(NO_DOCUMENTS_LINE);
  let n = 0;
  for (const group of groups) {
    lines.push('');
    lines.push(group.heading.toUpperCase());
    for (const item of group.items) {
      n += 1;
      lines.push(`${n}. ${item.title}`);
      if (item.detail) lines.push(`   ${item.detail}`);
      if (item.note.trim()) lines.push(`   Note: ${item.note.trim()}`);
    }
  }
  lines.push('');

  lines.push('SUBJECT-LEVEL RECORDS');
  lines.push(SUBJECT_SELECTION_NOTICE);
  const sampling = content.sampling_approach.trim();
  if (sampling) lines.push(`Sampling approach: ${sampling}`);
  lines.push('');

  lines.push(LETTER_CLOSING);
  lines.push('');
  if (packet.signatoryName) lines.push(packet.signatoryName);
  lines.push(SIGNATORY_ROLE);

  return lines.join('\n');
}
