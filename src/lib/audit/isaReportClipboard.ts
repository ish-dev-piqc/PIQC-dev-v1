import { ISA_DOMAIN_LABELS } from './labels';
import { formatProtocolRefWhere, formatReportDate, type IsaReportPacket } from './isaReportModel';
import type { IsaFindingObject, IsaProtocolRef } from '../../types/audit';

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
  for (const ref of f.protocol_refs ?? []) {
    parts.push(`<p style="${SMALL}">${esc(protocolRefLine(ref))}</p>`);
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
  for (const ref of f.protocol_refs ?? []) lines.push(protocolRefLine(ref));
  if (f.reference) lines.push(`Reference: ${f.reference}`);
  return lines.join('\n');
}

/** "Protocol requirement: § 6.3 (p. 47) — “…”" — the S4 bridge line. Sits
 *  ABOVE the regulatory reference: the site's own commitment first, the
 *  external norm second. */
function protocolRefLine(ref: IsaProtocolRef): string {
  return `Protocol requirement: ${formatProtocolRefWhere(ref)} — “${ref.quote}”`;
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

// -----------------------------------------------------------------------------
// Audit observation form — the auditee-facing response vehicle.
//
// Distinct artifact from the report: per-finding response cells the auditee
// fills in, severity-keyed response requirements, and the signature loop.
// Same packet, same payload rules (inline styles, tables, banner inside).
// -----------------------------------------------------------------------------

/** Severity-keyed response requirements (the templates' response ladder). */
export const RESPONSE_REQUIREMENTS: Record<string, string> = {
  CRITICAL:
    'Response required: root cause, correction, and a corrective action plan with responsible person(s) and target completion date. Immediate response with an aggressive timeline.',
  MAJOR:
    'Response required: root cause, correction, and a corrective action plan with responsible person(s) and target completion date, within a defined timeline.',
  MINOR:
    'Correction expected. A documented root cause analysis is not required.',
  RECOMMENDATION: 'Response optional — provided as an opportunity for improvement.',
};

const OWNER_LABELS: Record<string, string> = {
  SITE: 'Site',
  CLIENT: 'Client',
  CRO: 'CRO',
};

const RESPONSE_PROCESS_INTRO =
  'The audit observations and/or recommendations listed below were found during the audit. ' +
  'For each observation, provide: the root cause (required for Critical and Major observations), ' +
  'what was done to correct the issue, and a corrective action plan describing how recurrence ' +
  'will be prevented, the responsible person(s), and the estimated date of completion. ' +
  'Root cause analysis and corrective actions should address the observation itself, rather ' +
  'than only the specific examples cited as objective evidence.';

export function buildObservationFormHtml(packet: IsaReportPacket): string {
  const { meta } = packet;
  const parts: string[] = [];

  parts.push(draftBanner(meta.generatedAt));
  parts.push(`<h1 style="${H1}">Audit Observation Form</h1>`);

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

  parts.push(`<h2 style="${H2}">Auditee response process</h2>`);
  parts.push(`<p style="${P}">${esc(RESPONSE_PROCESS_INTRO)}</p>`);

  parts.push(`<h2 style="${H2}">Observation classifications</h2>`);
  for (const def of packet.severityDefinitions) {
    parts.push(`<p style="${P}"><strong>${esc(def.label)}:</strong> ${esc(def.text)}</p>`);
  }

  parts.push(`<h2 style="${H2}">Observations</h2>`);
  const rows: string[] = [];
  rows.push(
    `<tr><th style="${TH}width:4%;">#</th><th style="${TH}width:12%;">Classification</th><th style="${TH}width:18%;">Category</th><th style="${TH}width:38%;">Observation &amp; evidence</th><th style="${TH}width:28%;">Response</th></tr>`,
  );
  let index = 0;
  for (const group of packet.groups) {
    for (const f of group.findings) {
      index++;
      const category = `${ISA_DOMAIN_LABELS[f.isa_domain]}${f.subcategory ? ` – ${esc(f.subcategory)}` : ''}`;
      const evidence =
        f.evidence.length > 0
          ? `<ul style="margin:4pt 0 0 14pt;padding:0;">${f.evidence
              .map((ev) => `<li style="${P}margin:0 0 2pt 0;">${escMultiline(ev.text)}</li>`)
              .join('')}</ul>`
          : '';
      const protocolRefs = (f.protocol_refs ?? [])
        .map((ref) => `<p style="${SMALL}margin:4pt 0 0 0;">${esc(protocolRefLine(ref))}</p>`)
        .join('');
      const reference = f.reference
        ? `<p style="${SMALL}margin:4pt 0 0 0;">Reference: ${esc(f.reference)}</p>`
        : '';
      rows.push(
        `<tr>` +
          `<td style="${TD}">${index}</td>` +
          `<td style="${TD}"><strong>${esc(SEVERITY_LABELS[f.severity])}</strong><br>Owner: ${esc(OWNER_LABELS[f.response_owner])}</td>` +
          `<td style="${TD}">${category}</td>` +
          `<td style="${TD}"><strong>${esc(f.title)}</strong><br>${escMultiline(f.observation)}${evidence}${protocolRefs}${reference}</td>` +
          `<td style="${TD}"><p style="${SMALL}margin:0;">${esc(RESPONSE_REQUIREMENTS[f.severity])}</p><br><br><br></td>` +
          `</tr>`,
      );
    }
  }
  parts.push(`<table style="${TABLE}">${rows.join('')}</table>`);

  parts.push(`<h2 style="${H2}">Signatures</h2>`);
  const sigRow = (label: string) =>
    `<tr><td style="${TD}width:40%;">${esc(label)}</td><td style="${TD}width:35%;"></td><td style="${TD}width:25%;"></td></tr>`;
  parts.push(
    `<table style="${TABLE}">` +
      `<tr><th style="${TH}">Role</th><th style="${TH}">Name / signature</th><th style="${TH}">Date</th></tr>` +
      sigRow('Auditor') +
      sigRow('Auditee representative completing response') +
      sigRow('Response accepted by') +
      '</table>',
  );

  return `<div style="${FONT}">${parts.join('')}</div>`;
}

export function buildObservationFormPlain(packet: IsaReportPacket): string {
  const { meta } = packet;
  const lines: string[] = [];

  lines.push(DRAFT_BANNER_PLAIN(meta.generatedAt));
  lines.push('');
  lines.push('AUDIT OBSERVATION FORM');
  lines.push('');
  lines.push(`Auditee: ${meta.auditeeName}`);
  if (meta.siteNumber) lines.push(`Site number: ${meta.siteNumber}`);
  if (meta.principalInvestigator) lines.push(`Principal investigator: ${meta.principalInvestigator}`);
  if (meta.protocolCode) lines.push(`Protocol: ${meta.protocolCode}`);
  if (meta.auditDate) lines.push(`Audit date(s): ${meta.auditDate}`);
  lines.push(`Form generated: ${formatReportDate(meta.generatedAt)}`);
  lines.push(`Response due: ${packet.responseClause}`);
  lines.push('');
  lines.push('AUDITEE RESPONSE PROCESS');
  lines.push(RESPONSE_PROCESS_INTRO);
  lines.push('');
  lines.push('OBSERVATION CLASSIFICATIONS');
  for (const def of packet.severityDefinitions) lines.push(`${def.label}: ${def.text}`);
  lines.push('');
  lines.push('OBSERVATIONS');
  let index = 0;
  for (const group of packet.groups) {
    for (const f of group.findings) {
      index++;
      lines.push('');
      lines.push(
        `${index}. [${SEVERITY_LABELS[f.severity]}] ${f.title} — ${ISA_DOMAIN_LABELS[f.isa_domain]}${f.subcategory ? ` – ${f.subcategory}` : ''} (Owner: ${OWNER_LABELS[f.response_owner]})`,
      );
      lines.push(f.observation);
      for (const ev of f.evidence) lines.push(`  - ${ev.text}`);
      for (const ref of f.protocol_refs ?? []) lines.push(protocolRefLine(ref));
      if (f.reference) lines.push(`Reference: ${f.reference}`);
      lines.push(`Response (${RESPONSE_REQUIREMENTS[f.severity]})`);
      lines.push('  Root cause:');
      lines.push('  Correction:');
      lines.push('  Corrective action plan / responsible / target date:');
    }
  }
  lines.push('');
  lines.push('SIGNATURES');
  lines.push('Auditor: ____________________  Date: ________');
  lines.push('Auditee representative completing response: ____________________  Date: ________');
  lines.push('Response accepted by: ____________________  Date: ________');

  return lines.join('\n');
}
