import * as XLSX from 'xlsx';
import type { SiteParticipant, SiteVisit } from './types';

// =============================================================================
// reportsExport — pure builder that takes the snapshots already prepared by
// ReportsTab and assembles a multi-sheet XLSX workbook as a Blob.
//
// Sheets, in order:
//   - Summary
//   - Visits
//   - Participants
//   - Deviations         (only when at least one row exists)
//   - By protocol        (only when scope is "all protocols")
//
// No DOM / download wiring here — the calling component handles the
// `a.click()` boilerplate as it does for the existing CSV/PDF exports.
// =============================================================================

export interface ReportStats {
  completed: number;
  missed: number;
  deviations: number;
  activeParticipants: number;
  openDeviations: number;
  /** null when there are no concluded visits. */
  complianceRate: number | null;
  upcoming: number;
  concluded: number;
}

export interface ProtocolBreakdownRow {
  /** Subset of Protocol — caller passes whatever ProtocolContext returns. */
  protocol: { id: string; code: string };
  enrolled: number;
  completed: number;
  missed: number;
  deviation: number;
  rate: number | null;
  total: number;
}

export interface BuildReportWorkbookInput {
  scopeLabel: string;
  generatedAt: string;
  stats: ReportStats;
  visits: SiteVisit[];
  participants: SiteParticipant[];
  protocolRows: ProtocolBreakdownRow[];
  /** id → code lookup for visits whose protocol code we want to print. */
  protocolCodeById: Map<string, string>;
}

// Each sheet is built as an array of plain rows (header row + data rows).
// XLSX.utils.aoa_to_sheet keeps the wire format trivial and pre-empts any
// "what type is this cell" foot-guns.
type SheetRow = Array<string | number | null>;

function buildSummarySheet(input: BuildReportWorkbookInput): SheetRow[] {
  const { scopeLabel, generatedAt, stats } = input;
  return [
    ['PIQ Clinical — Site Report'],
    [`Scope: ${scopeLabel}`],
    [`Generated: ${generatedAt}`],
    [],
    ['Metric', 'Value'],
    ['Active participants', stats.activeParticipants],
    ['Visit compliance', stats.complianceRate !== null ? `${stats.complianceRate}%` : '—'],
    ['Completed visits', stats.completed],
    ['Missed visits', stats.missed],
    ['Deviations', stats.deviations],
    ['Open deviations', stats.openDeviations],
    ['Upcoming visits', stats.upcoming],
    ['Total concluded visits', stats.concluded],
  ];
}

function buildVisitsSheet(input: BuildReportWorkbookInput): SheetRow[] {
  const header: SheetRow = [
    'Date',
    'Time',
    'Participant',
    'Protocol',
    'Visit',
    'Status',
    'Study day',
    'Deviation reason',
    'Note',
  ];
  const rows = input.visits
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map<SheetRow>((v) => [
      v.date,
      v.time ?? '',
      v.participantId,
      input.protocolCodeById.get(v.protocolId) ?? '',
      v.visitName,
      v.status,
      v.studyDay,
      v.deviationReason ?? '',
      v.priorNote ?? '',
    ]);
  return [header, ...rows];
}

function buildParticipantsSheet(input: BuildReportWorkbookInput): SheetRow[] {
  const header: SheetRow = [
    'ID',
    'Protocol',
    'Status',
    'Enrolled',
    'Current study day',
    'Next visit',
    'Next visit date',
    'Coordinator',
    'Open deviations',
  ];
  const rows = input.participants
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<SheetRow>((p) => [
      p.id,
      input.protocolCodeById.get(p.protocol_id) ?? '',
      p.status,
      p.enrolled_at ?? '',
      p.current_study_day ?? '',
      p.next_visit_name ?? '',
      p.next_visit_date ?? '',
      p.assigned_coordinator,
      p.open_deviations,
    ]);
  return [header, ...rows];
}

function buildDeviationsSheet(input: BuildReportWorkbookInput): SheetRow[] {
  const deviations = input.visits.filter((v) => v.status === 'deviation');
  if (deviations.length === 0) return [];
  const header: SheetRow = ['Date', 'Participant', 'Protocol', 'Visit', 'Reason'];
  const rows = deviations
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .map<SheetRow>((v) => [
      v.date,
      v.participantId,
      input.protocolCodeById.get(v.protocolId) ?? '',
      v.visitName,
      v.deviationReason ?? '',
    ]);
  return [header, ...rows];
}

function buildByProtocolSheet(input: BuildReportWorkbookInput): SheetRow[] {
  if (input.protocolRows.length === 0) return [];
  const header: SheetRow = [
    'Protocol',
    'Enrolled',
    'Concluded',
    'Completed',
    'Missed',
    'Deviations',
    'Compliance rate',
  ];
  const rows = input.protocolRows.map<SheetRow>((r) => [
    r.protocol.code,
    r.enrolled,
    r.total,
    r.completed,
    r.missed,
    r.deviation,
    r.rate !== null ? `${r.rate}%` : '—',
  ]);
  return [header, ...rows];
}

/** Internal — used by the test to inspect what would be written without
 *  actually serializing the workbook. */
export function planSheets(
  input: BuildReportWorkbookInput,
): { name: string; rows: SheetRow[] }[] {
  const sheets: { name: string; rows: SheetRow[] }[] = [
    { name: 'Summary', rows: buildSummarySheet(input) },
    { name: 'Visits', rows: buildVisitsSheet(input) },
    { name: 'Participants', rows: buildParticipantsSheet(input) },
  ];

  const deviations = buildDeviationsSheet(input);
  if (deviations.length > 0) sheets.push({ name: 'Deviations', rows: deviations });

  const byProtocol = buildByProtocolSheet(input);
  if (byProtocol.length > 0) sheets.push({ name: 'By protocol', rows: byProtocol });

  return sheets;
}

/** Build and serialize the workbook to a Blob ready for download. */
export function buildReportWorkbook(
  input: BuildReportWorkbookInput,
): Blob {
  const wb = XLSX.utils.book_new();
  for (const sheet of planSheets(input)) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name);
  }
  const arrayBuffer = XLSX.write(wb, {
    bookType: 'xlsx',
    type: 'array',
  }) as ArrayBuffer;
  return new Blob([arrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
