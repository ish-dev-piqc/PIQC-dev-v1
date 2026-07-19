import { ISA_DOMAIN_LABELS } from './labels';
import { formatReportDate, type IsaReportPacket } from './isaReportModel';
import type { IsaFindingObject } from '../../types/audit';

// =============================================================================
// ISA report clipboard builders — paste-ready HTML + plain text.
//
// Most auditors finish the report in Word or Google Docs; a formatted
// clipboard copy skips the download → open → reformat cycle entirely. The
// component writes BOTH flavors in one ClipboardItem: word processors take
// the text/html flavor (formatting survives), everything else falls back to
// text/plain.
//
// Rules this module lives by (Word's HTML parser is the constraint):
//   - Inline `style=""` on every element — pasted HTML carries no stylesheet.
//   - <table> for anything tabular; flex/grid do not exist to Word.
//   - pt font sizes, not rem/px.
//   - The DRAFT + "PIQC drafted · requires human review" banner is PART OF
//     THE PAYLOAD, not UI chrome — the one artifact that leaves PIQC keeps
//     its provenance.
//   - No participant initials, no sponsor/client names — by construction:
//     the packet never contains them.
//
// Pure module: no DOM, no clipboard API — unit-testable string builders. The
// clipboard write itself (with feature-detect fallbacks) lives in the
// component.
// =============================================================================

const FONT = "font-family:Calibri,Arial,sans-serif;";
const H1 = `${FONT}font-size:16pt;font-weight:bold;margin:0 0 4pt 0;`;
const H2 = `${FONT}font-size:12pt;font-weight:bold;margin:12pt 0 4pt 0;`;
const P = `${FONT}font-size:10.5pt;margin:0 0 6pt 0;`;
const SMALL = `${FONT}font-size:9pt;color:#555555;margin:0 0 4pt 0;`;
const TABLE = 'border-collapse:collapse;width:100%;margin:0 0 8pt 0;';
const TH = `${FONT}font-size:9.5pt;font-weight:bold;border:1pt solid #999999;padding:3pt 5pt;text-align:left;background-color:#EFEFEF;`;
const TD = `${FONT}font-size:9.5pt;border:1pt solid #999999;padding:3pt 5pt;vertical-align:top;`;
const BANNER =
  `${FONT}font-size:9pt;font-weight:bold;color:#8A6D00;background-color:#FFF7DB;` +
  'border:1pt solid #E0C200;padding:5pt 8pt;margin:0 0 10pt 0;';

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

function draftBanner(generatedAt: Date): string {
  return (
    `<div style="${BANNER}">DRAFT — PIQC drafted · requires human review · ` +
    `generated ${esc(formatReportDate(generatedAt))}</div>`
  );
}

const DRAFT_BANNER_PLAIN = (generatedAt: Date) =>
  `DRAFT — PIQC drafted · requires human review · generated ${formatReportDate(generatedAt)}`;

// -----------------------------------------------------------------------------
// Finding fragment (shared by whole-report and per-finding builders)
// -----------------------------------------------------------------------------

function findingHtml(f: IsaFindingObject, severityLabel: string): string {
  const parts: string[] = [];
  parts.push(
    `<p style="${P}"><strong>[${esc(severityLabel)}] ${esc(f.title)}</strong>` +
      ` — ${esc(ISA_DOMAIN_LABELS[f.isa_domain])}${f.subcategory ? ` – ${esc(f.subcategory)}` : ''}</p>`,
  );
  parts.push(`<p style="${P}">${escMultiline(f.observation)}</p>`);
  if (f.evidence.length > 0) {
    const items = f.evidence
      .map((ev) => `<li style="${P}margin:0 0 2pt 0;">${escMultiline(ev.text)}</li>`)
      .join('');
    parts.push(`<ul style="margin:0 0 6pt 18pt;padding:0;">${items}</ul>`);
  }
  if (f.reference) {
    parts.push(`<p style="${SMALL}">Reference: ${esc(f.reference)}</p>`);
  }
  return parts.join('');
}

function findingPlain(f: IsaFindingObject, severityLabel: string): string {
  const lines: string[] = [];
  lines.push(
    `[${severityLabel}] ${f.title} — ${ISA_DOMAIN_LABELS[f.isa_domain]}${f.subcategory ? ` – ${f.subcategory}` : ''}`,
  );
  lines.push(f.observation);
  for (const ev of f.evidence) lines.push(`  - ${ev.text}`);
  if (f.reference) lines.push(`Reference: ${f.reference}`);
  return lines.join('\n');
}

const SEVERITY_LABELS: Record<string, string> = {
  CRITICAL: 'Critical',
  MAJOR: 'Major',
  MINOR: 'Minor',
  RECOMMENDATION: 'Recommendation',
};

// -----------------------------------------------------------------------------
// Whole report
// -----------------------------------------------------------------------------

export function buildReportHtml(packet: IsaReportPacket): string {
  const { meta } = packet;
  const parts: string[] = [];

  parts.push(draftBanner(meta.generatedAt));
  parts.push(`<h1 style="${H1}">Investigator Site Audit Report</h1>`);

  // Metadata table
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
  parts.push(
    `<table style="${TABLE}">` +
      metaRows
        .map(
          ([k, v]) =>
            `<tr><td style="${TD}width:30%;"><strong>${esc(k)}</strong></td><td style="${TD}">${esc(v)}</td></tr>`,
        )
        .join('') +
      '</table>',
  );

  // Executive summary
  parts.push(`<h2 style="${H2}">Executive summary</h2>`);
  parts.push(`<p style="${P}">${escMultiline(packet.execSummary.text)}</p>`);

  // Scope & objectives
  parts.push(`<h2 style="${H2}">Scope and objectives</h2>`);
  parts.push(
    `<ul style="margin:0 0 8pt 18pt;padding:0;">` +
      packet.objectives.map((o) => `<li style="${P}margin:0 0 2pt 0;">${esc(o)}</li>`).join('') +
      '</ul>',
  );

  // Auditee background + audit activities
  parts.push(`<h2 style="${H2}">Auditee background</h2>`);
  parts.push(`<p style="${P}">${escMultiline(packet.auditeeBackground.text)}</p>`);
  parts.push(`<h2 style="${H2}">Audit activities</h2>`);
  parts.push(`<p style="${P}"><strong>Opening meeting.</strong> ${escMultiline(packet.openingMeeting.text)}</p>`);
  parts.push(`<p style="${P}"><strong>Closing meeting.</strong> ${escMultiline(packet.closingMeeting.text)}</p>`);

  // Positive observations
  if (packet.positiveObservations.length > 0) {
    parts.push(`<h2 style="${H2}">Positive observations</h2>`);
    parts.push(`<p style="${P}">Positive observations included but were not limited to:</p>`);
    parts.push(
      `<ul style="margin:0 0 8pt 18pt;padding:0;">` +
        packet.positiveObservations
          .map((o) => `<li style="${P}margin:0 0 2pt 0;">${escMultiline(o)}</li>`)
          .join('') +
        '</ul>',
    );
  }

  // Severity definitions
  parts.push(`<h2 style="${H2}">Observation classifications</h2>`);
  for (const def of packet.severityDefinitions) {
    parts.push(`<p style="${P}"><strong>${esc(def.label)}:</strong> ${esc(def.text)}</p>`);
  }

  // Category × severity matrix — only rows with any coverage, to keep the
  // pasted table readable.
  const activeRows = packet.matrix.filter(
    (r) => r.critical + r.major + r.minor + r.recommendation > 0,
  );
  if (activeRows.length > 0) {
    parts.push(`<h2 style="${H2}">Observations by category</h2>`);
    parts.push(
      `<table style="${TABLE}">` +
        `<tr><th style="${TH}">Category</th><th style="${TH}">Critical</th><th style="${TH}">Major</th><th style="${TH}">Minor</th><th style="${TH}">Recommendation</th></tr>` +
        activeRows
          .map(
            (r) =>
              `<tr><td style="${TD}">${esc(r.label)}</td><td style="${TD}">${r.critical || ''}</td><td style="${TD}">${r.major || ''}</td><td style="${TD}">${r.minor || ''}</td><td style="${TD}">${r.recommendation || ''}</td></tr>`,
          )
          .join('') +
        '</table>',
    );
  }

  // Severity-grouped observations
  parts.push(`<h2 style="${H2}">Audit observations</h2>`);
  let any = false;
  for (const group of packet.groups) {
    if (group.findings.length === 0) continue;
    any = true;
    parts.push(`<h2 style="${H2}font-size:11pt;">${esc(group.heading)} (${group.findings.length})</h2>`);
    for (const f of group.findings) {
      parts.push(findingHtml(f, SEVERITY_LABELS[f.severity]));
    }
  }
  if (!any) {
    parts.push(`<p style="${P}">No observations were recorded.</p>`);
  }

  // Response expectations
  parts.push(`<h2 style="${H2}">Response</h2>`);
  parts.push(`<p style="${P}">${esc(packet.responseClause)}</p>`);
  parts.push(
    `<p style="${P}">Responses to Critical and Major observations must include root cause, correction, and a corrective action plan with responsible person(s) and target completion dates.</p>`,
  );

  return `<div style="${FONT}">${parts.join('')}</div>`;
}

export function buildReportPlain(packet: IsaReportPacket): string {
  const { meta } = packet;
  const lines: string[] = [];

  lines.push(DRAFT_BANNER_PLAIN(meta.generatedAt));
  lines.push('');
  lines.push('INVESTIGATOR SITE AUDIT REPORT');
  lines.push('');
  lines.push(`Auditee: ${meta.auditeeName}`);
  if (meta.siteNumber) lines.push(`Site number: ${meta.siteNumber}`);
  if (meta.principalInvestigator) lines.push(`Principal investigator: ${meta.principalInvestigator}`);
  if (meta.siteCountry) lines.push(`Country: ${meta.siteCountry}`);
  if (meta.protocolCode) lines.push(`Protocol: ${meta.protocolCode}`);
  if (meta.protocolTitle) lines.push(`Protocol title: ${meta.protocolTitle}`);
  lines.push(`Audit type: ${meta.auditTypeLabel}`);
  if (meta.auditDate) lines.push(`Audit date: ${meta.auditDate}`);
  lines.push(`Report generated: ${formatReportDate(meta.generatedAt)}`);
  lines.push('');
  lines.push('EXECUTIVE SUMMARY');
  lines.push(packet.execSummary.text);
  lines.push('');
  lines.push('SCOPE AND OBJECTIVES');
  for (const o of packet.objectives) lines.push(`- ${o}`);
  lines.push('');
  lines.push('AUDITEE BACKGROUND');
  lines.push(packet.auditeeBackground.text);
  lines.push('');
  lines.push('AUDIT ACTIVITIES');
  lines.push(`Opening meeting. ${packet.openingMeeting.text}`);
  lines.push(`Closing meeting. ${packet.closingMeeting.text}`);
  lines.push('');
  if (packet.positiveObservations.length > 0) {
    lines.push('POSITIVE OBSERVATIONS');
    lines.push('Positive observations included but were not limited to:');
    for (const o of packet.positiveObservations) lines.push(`- ${o}`);
    lines.push('');
  }
  lines.push('OBSERVATION CLASSIFICATIONS');
  for (const def of packet.severityDefinitions) lines.push(`${def.label}: ${def.text}`);
  lines.push('');
  lines.push('AUDIT OBSERVATIONS');
  let any = false;
  for (const group of packet.groups) {
    if (group.findings.length === 0) continue;
    any = true;
    lines.push('');
    lines.push(`${group.heading.toUpperCase()} (${group.findings.length})`);
    for (const f of group.findings) {
      lines.push('');
      lines.push(findingPlain(f, SEVERITY_LABELS[f.severity]));
    }
  }
  if (!any) lines.push('No observations were recorded.');
  lines.push('');
  lines.push('RESPONSE');
  lines.push(packet.responseClause);
  lines.push(
    'Responses to Critical and Major observations must include root cause, correction, and a corrective action plan with responsible person(s) and target completion dates.',
  );

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// Single finding (for pasting into an email or a CAPA form)
// -----------------------------------------------------------------------------

export function buildFindingHtml(f: IsaFindingObject, generatedAt: Date): string {
  return (
    `<div style="${FONT}">` +
    draftBanner(generatedAt) +
    findingHtml(f, SEVERITY_LABELS[f.severity]) +
    '</div>'
  );
}

export function buildFindingPlain(f: IsaFindingObject, generatedAt: Date): string {
  return `${DRAFT_BANNER_PLAIN(generatedAt)}\n\n${findingPlain(f, SEVERITY_LABELS[f.severity])}`;
}
