import { ISA_DOMAIN_LABELS } from './labels';
import type {
  AuditNoteObject,
  IsaDomain,
  IsaFindingObject,
  IsaReportDraftObject,
  IsaSeverity,
  IsaSiteVerdict,
} from '../../types/audit';

// =============================================================================
// ISA report model — the S0 writing contract as pure code.
//
// ~70% of a standard ISA report is deterministic: metadata merge, boilerplate
// constants, and mechanical rollups over accepted findings. This module
// assembles all of it into one typed packet that every renderer (workspace
// preview, docx builder, clipboard builders) consumes — the report exists in
// exactly one shape, rendered three ways.
//
// The exec summary follows the templates' six-beat formula: compliance
// statement → severity headline → category list → detail pointer → SITE
// VERDICT → response clause. Every beat except the verdict derives from
// findings; the verdict is a structured auditor-only field and renders as an
// explicit placeholder until set (export is gated on it upstream).
//
// No sponsor/client names anywhere in this module's output — the report is
// generic by construction; sponsor branding is added externally on export.
// =============================================================================

export type IsaSectionSource = 'templated' | 'auditor_edited';

export interface IsaReportSection {
  text: string;
  source: IsaSectionSource;
}

export interface IsaReportMeta {
  auditeeName: string;
  siteNumber: string | null;
  principalInvestigator: string | null;
  siteCountry: string | null;
  protocolCode: string | null;
  protocolTitle: string | null;
  auditTypeLabel: string;
  auditDate: string | null;   // scheduled_date, yyyy-mm-dd
  generatedAt: Date;
}

export interface IsaMatrixRow {
  domain: IsaDomain;
  label: string;
  critical: number;
  major: number;
  minor: number;
  recommendation: number;
}

export interface IsaSeverityGroup {
  severity: IsaSeverity;
  heading: string;
  findings: IsaFindingObject[];
}

export interface IsaReportPacket {
  meta: IsaReportMeta;
  execSummary: IsaReportSection & { verdictSet: boolean };
  objectives: readonly string[];
  auditeeBackground: IsaReportSection;
  openingMeeting: IsaReportSection;
  closingMeeting: IsaReportSection;
  positiveObservations: string[];
  severityDefinitions: readonly { severity: IsaSeverity; label: string; text: string }[];
  matrix: IsaMatrixRow[];
  groups: IsaSeverityGroup[];
  responseClause: string;
  counts: Record<IsaSeverity, number>;
}

// -----------------------------------------------------------------------------
// Constants — the boilerplate the templates repeat verbatim.
// -----------------------------------------------------------------------------

export const ISA_OBJECTIVES = [
  'Ensure compliance with the principles of ICH Good Clinical Practice, applicable regulatory requirements, and applicable SOPs',
  'Determine adherence to the protocol and study procedures',
  'Review for adequacy all required study and regulatory documents',
  'Audit a representative sample of subject data against source documents',
] as const;

export const ISA_SEVERITY_DEFINITIONS = [
  {
    severity: 'CRITICAL' as IsaSeverity,
    label: 'Critical',
    text: 'Conditions, practices, or processes that adversely affect the rights, safety or well-being of participants and/or the quality and integrity of data. Critical observations require immediate escalation and a corrective action plan with an aggressive timeline.',
  },
  {
    severity: 'MAJOR' as IsaSeverity,
    label: 'Major',
    text: 'Conditions, practices, or processes that might adversely affect the rights, safety or well-being of participants and/or the quality and integrity of data. Major observations require a response and a corrective action plan with a defined timeline.',
  },
  {
    severity: 'MINOR' as IsaSeverity,
    label: 'Minor',
    text: 'Conditions, practices, or processes that would not be expected to adversely affect the rights, safety or well-being of participants or the quality and integrity of data. Minor observations indicate the need for improvement.',
  },
  {
    severity: 'RECOMMENDATION' as IsaSeverity,
    label: 'Recommendation',
    text: 'Areas in which the auditee can improve the execution of policies, procedures, or practices. No response or corrective action is required.',
  },
] as const;

const SEVERITY_ORDER: IsaSeverity[] = ['CRITICAL', 'MAJOR', 'MINOR', 'RECOMMENDATION'];

const GROUP_HEADINGS: Record<IsaSeverity, string> = {
  CRITICAL: 'Critical observations',
  MAJOR: 'Major observations',
  MINOR: 'Minor observations',
  RECOMMENDATION: 'Recommendations',
};

const COMPLIANCE_STATEMENT =
  'In general, the clinical trial has been conducted by the above noted investigator in compliance with the principles of ICH Good Clinical Practice, applicable regulatory requirements, and the applicable procedures, protocols and plans.';

const DETAIL_POINTER = 'The specifics of all observations are detailed later in this report.';

export const VERDICT_SENTENCES: Record<IsaSiteVerdict, string> = {
  CONTINUE:
    'None of the noted observations should prevent continued use of the site or warrant increased monitoring.',
  CONTINUE_INCREASED_MONITORING:
    'The noted observations do not prevent continued use of the site; increased monitoring is warranted.',
  DO_NOT_CONTINUE:
    'The noted observations warrant suspension of further enrolment at the site pending resolution.',
};

export const VERDICT_PLACEHOLDER =
  '[Site continuation verdict — to be set by the auditor before export.]';

export const AUDITEE_BACKGROUND_PLACEHOLDER =
  'Describe the investigator’s clinical-research experience, the site team per the current Delegation of Authority log, how participants are recruited, and the site’s regulatory inspection history.';

export const OPENING_MEETING_PLACEHOLDER =
  'Record the opening meeting: host, date, attendees, and the review of audit objectives, scope, and agenda.';

export const CLOSING_MEETING_PLACEHOLDER =
  'Record the closing meeting: attendees, the preliminary observations presented, CAPA expectations, and the auditee’s acknowledgment.';

// -----------------------------------------------------------------------------
// Formatting helpers
// -----------------------------------------------------------------------------

/** DD MMM YYYY — the register's date convention. */
export function formatReportDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')} ${d.toLocaleString('en', { month: 'short' })} ${d.getFullYear()}`;
}

export function buildResponseClause(days: number, basis: 'CALENDAR' | 'BUSINESS'): string {
  const unit = basis === 'CALENDAR' ? 'calendar' : 'business';
  return `A written response to the audit observations must be submitted within ${days} ${unit} days of receipt of this report.`;
}

// -----------------------------------------------------------------------------
// Derivations
// -----------------------------------------------------------------------------

export function countBySeverity(findings: IsaFindingObject[]): Record<IsaSeverity, number> {
  const counts: Record<IsaSeverity, number> = {
    CRITICAL: 0,
    MAJOR: 0,
    MINOR: 0,
    RECOMMENDATION: 0,
  };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

/** Distinct `Domain – subcategory` lines for the exec summary's category beat. */
export function categoryLines(findings: IsaFindingObject[]): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const f of findings) {
    if (f.severity === 'RECOMMENDATION') continue;
    const line = f.subcategory
      ? `${ISA_DOMAIN_LABELS[f.isa_domain]} – ${f.subcategory}`
      : ISA_DOMAIN_LABELS[f.isa_domain];
    if (!seen.has(line)) {
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

function severityHeadline(counts: Record<IsaSeverity, number>): string {
  const parts: string[] = [];
  parts.push(
    counts.CRITICAL === 0
      ? 'No critical observations were made during the audit.'
      : `${counts.CRITICAL} critical ${counts.CRITICAL === 1 ? 'observation was' : 'observations were'} made during the audit.`,
  );
  const majorMinor = counts.MAJOR + counts.MINOR;
  if (majorMinor > 0) {
    const kinds: string[] = [];
    if (counts.MAJOR > 0) kinds.push(`${counts.MAJOR} major`);
    if (counts.MINOR > 0) kinds.push(`${counts.MINOR} minor`);
    parts.push(
      `${kinds.join(' and ')} ${majorMinor === 1 ? 'observation was' : 'observations were'} made in the following categories:`,
    );
  } else if (counts.CRITICAL === 0) {
    parts.push('No major or minor observations were made.');
  }
  return parts.join(' ');
}

/**
 * The six-beat exec summary. Returns the stored auditor text verbatim when
 * the auditor has taken the pen; otherwise derives live from findings so the
 * summary can never disagree with the observations section below it.
 */
export function buildExecSummary(
  draft: IsaReportDraftObject | null,
  findings: IsaFindingObject[],
): IsaReportSection & { verdictSet: boolean } {
  const verdictSet = !!draft?.site_verdict;

  if (draft?.exec_summary) {
    return { text: draft.exec_summary, source: 'auditor_edited', verdictSet };
  }

  const counts = countBySeverity(findings);
  const lines: string[] = [COMPLIANCE_STATEMENT, severityHeadline(counts)];

  const cats = categoryLines(findings);
  for (const c of cats) lines.push(`• ${c}`);
  if (cats.length > 0) lines.push(DETAIL_POINTER);

  if (draft?.site_verdict) {
    let verdict = VERDICT_SENTENCES[draft.site_verdict];
    if (draft.site_verdict_text) verdict += ` ${draft.site_verdict_text}`;
    lines.push(verdict);
  } else {
    lines.push(VERDICT_PLACEHOLDER);
  }

  lines.push(
    buildResponseClause(draft?.response_due_days ?? 30, draft?.response_due_basis ?? 'CALENDAR'),
  );

  return { text: lines.join('\n'), source: 'templated', verdictSet };
}

export function buildMatrix(
  findings: IsaFindingObject[],
  domains: IsaDomain[],
): IsaMatrixRow[] {
  return domains.map((domain) => {
    const row: IsaMatrixRow = {
      domain,
      label: ISA_DOMAIN_LABELS[domain],
      critical: 0,
      major: 0,
      minor: 0,
      recommendation: 0,
    };
    for (const f of findings) {
      if (f.isa_domain !== domain) continue;
      if (f.severity === 'CRITICAL') row.critical++;
      else if (f.severity === 'MAJOR') row.major++;
      else if (f.severity === 'MINOR') row.minor++;
      else row.recommendation++;
    }
    return row;
  });
}

function resolveSection(stored: string | null | undefined, placeholder: string): IsaReportSection {
  return stored
    ? { text: stored, source: 'auditor_edited' }
    : { text: placeholder, source: 'templated' };
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

export function buildIsaReportPacket(
  meta: IsaReportMeta,
  draft: IsaReportDraftObject | null,
  findings: IsaFindingObject[],
  positiveNotes: AuditNoteObject[],
): IsaReportPacket {
  const domains = Object.keys(ISA_DOMAIN_LABELS) as IsaDomain[];

  return {
    meta,
    execSummary: buildExecSummary(draft, findings),
    objectives: ISA_OBJECTIVES,
    auditeeBackground: resolveSection(draft?.auditee_background, AUDITEE_BACKGROUND_PLACEHOLDER),
    openingMeeting: resolveSection(draft?.opening_meeting, OPENING_MEETING_PLACEHOLDER),
    closingMeeting: resolveSection(draft?.closing_meeting, CLOSING_MEETING_PLACEHOLDER),
    positiveObservations: positiveNotes.map((n) => n.body),
    severityDefinitions: ISA_SEVERITY_DEFINITIONS,
    matrix: buildMatrix(findings, domains),
    groups: SEVERITY_ORDER.map((severity) => ({
      severity,
      heading: GROUP_HEADINGS[severity],
      findings: findings.filter((f) => f.severity === severity),
    })),
    responseClause: buildResponseClause(
      draft?.response_due_days ?? 30,
      draft?.response_due_basis ?? 'CALENDAR',
    ),
    counts: countBySeverity(findings),
  };
}
