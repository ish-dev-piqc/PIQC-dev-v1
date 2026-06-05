import { describe, expect, it } from 'vitest';
import { planSheets, buildReportWorkbook } from '../reportsExport';
import type { ReportStats, ProtocolBreakdownRow } from '../reportsExport';
import type { SiteParticipant, SiteVisit } from '../types';

// =============================================================================
// reportsExport tests — verify sheet planning (which sheets appear, in what
// order, with the right cell values) and that the Blob serializer produces
// a non-empty xlsx-typed payload. Workbook XML correctness is XLSX's
// responsibility; we just lock in our schema.
// =============================================================================

const stats: ReportStats = {
  completed: 5,
  missed: 1,
  deviations: 2,
  activeParticipants: 8,
  openDeviations: 3,
  complianceRate: 62,
  upcoming: 4,
  concluded: 8,
};

const visit = (over: Partial<SiteVisit> = {}): SiteVisit => ({
  id: over.id ?? 'v-1',
  date: over.date ?? '2026-06-01',
  protocolId: over.protocolId ?? 'p-1',
  participantId: over.participantId ?? 'P-0001',
  studyDay: over.studyDay ?? 5,
  visitName: over.visitName ?? 'Week 1',
  status: over.status ?? 'completed',
  ...over,
});

const participant = (over: Partial<SiteParticipant> = {}): SiteParticipant => ({
  id: over.id ?? 'P-0001',
  uuid: over.uuid ?? 'u-1',
  protocol_id: over.protocol_id ?? 'p-1',
  status: over.status ?? 'ACTIVE',
  enrolled_at: over.enrolled_at ?? '2026-05-01',
  current_study_day: over.current_study_day ?? 5,
  next_visit_date: over.next_visit_date ?? '2026-06-10',
  next_visit_name: over.next_visit_name ?? 'Week 2',
  assigned_coordinator: over.assigned_coordinator ?? 'Alice',
  open_deviations: over.open_deviations ?? 0,
  notes: over.notes ?? null,
});

const protoCodeById = new Map<string, string>([
  ['p-1', 'PP06489'],
  ['p-2', 'PP07000'],
]);

const baseInput = (over: Partial<Parameters<typeof planSheets>[0]> = {}) => ({
  scopeLabel: 'PP06489',
  generatedAt: '2026-06-04',
  stats,
  visits: [visit()],
  participants: [participant()],
  protocolRows: [] as ProtocolBreakdownRow[],
  protocolCodeById: protoCodeById,
  ...over,
});

describe('planSheets', () => {
  it('always includes Summary / Visits / Participants in that order', () => {
    const out = planSheets(baseInput());
    expect(out.map((s) => s.name).slice(0, 3)).toEqual([
      'Summary',
      'Visits',
      'Participants',
    ]);
  });

  it('skips Deviations sheet when no deviation visits exist', () => {
    const out = planSheets(baseInput());
    expect(out.map((s) => s.name)).not.toContain('Deviations');
  });

  it('includes Deviations sheet when at least one deviation visit exists', () => {
    const out = planSheets(
      baseInput({ visits: [visit({ status: 'deviation', deviationReason: 'late draw' })] }),
    );
    expect(out.map((s) => s.name)).toContain('Deviations');
  });

  it('skips By protocol sheet when protocolRows is empty (single-protocol scope)', () => {
    const out = planSheets(baseInput());
    expect(out.map((s) => s.name)).not.toContain('By protocol');
  });

  it('includes By protocol sheet when protocolRows is populated', () => {
    const out = planSheets(
      baseInput({
        protocolRows: [
          {
            protocol: { id: 'p-1', code: 'PP06489' },
            enrolled: 5,
            completed: 4,
            missed: 1,
            deviation: 0,
            rate: 80,
            total: 5,
          },
        ],
      }),
    );
    expect(out.map((s) => s.name)).toContain('By protocol');
  });

  it('writes the participant code as the visit row participant', () => {
    const out = planSheets(baseInput());
    const visitsSheet = out.find((s) => s.name === 'Visits')!;
    // header at index 0, first data row at index 1
    const firstRow = visitsSheet.rows[1];
    expect(firstRow[2]).toBe('P-0001');
  });

  it('resolves protocol code from the lookup', () => {
    const out = planSheets(baseInput({ visits: [visit({ protocolId: 'p-2' })] }));
    const visitsSheet = out.find((s) => s.name === 'Visits')!;
    expect(visitsSheet.rows[1][3]).toBe('PP07000');
  });

  it('falls back to empty string on unknown protocol id', () => {
    const out = planSheets(baseInput({ visits: [visit({ protocolId: 'p-MISSING' })] }));
    const visitsSheet = out.find((s) => s.name === 'Visits')!;
    expect(visitsSheet.rows[1][3]).toBe('');
  });

  it('renders compliance rate as "—" when complianceRate is null', () => {
    const out = planSheets(
      baseInput({ stats: { ...stats, complianceRate: null } }),
    );
    const summary = out.find((s) => s.name === 'Summary')!;
    const complianceRow = summary.rows.find((r) => r[0] === 'Visit compliance')!;
    expect(complianceRow[1]).toBe('—');
  });
});

describe('buildReportWorkbook', () => {
  it('returns a non-empty Blob with the xlsx MIME type', async () => {
    const blob = buildReportWorkbook(baseInput());
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});
