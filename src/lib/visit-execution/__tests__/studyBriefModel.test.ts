import { describe, it, expect } from 'vitest';
import { buildStudyBrief, buildStudyOrient } from '../studyBriefModel';
import type { DivergenceRecord } from '../../../types/divergence';
import type {
  ProtocolCohort,
  VisitExecutionWorkspace,
  VisitSnapshot,
} from '../../../types/visit-execution';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkspace(
  snapshot: Partial<VisitSnapshot>,
  id = crypto.randomUUID(),
): VisitExecutionWorkspace {
  return {
    visit_template_id: id,
    protocol_id: 'p-1',
    snapshot: {
      visit_name: 'V1',
      study_day: 1,
      window_minus_days: 0,
      window_plus_days: 0,
      purpose: 'Purpose.',
      is_dosing_visit: false,
      has_primary_endpoint: false,
      has_safety_critical: false,
      item_count: 0,
      conditional_item_count: 0,
      endpoint_critical_count: 0,
      needs_review_count: 0,
      reviewed_count: 0,
      flagged_count: 0,
      amendment_version: null,
      confidence_state: null,
      applies_to: null,
      completeness_signal_count: 0,
      completeness_signals: [],
      ...snapshot,
    },
    items: [],
  };
}

function makeCohort(overrides: Partial<ProtocolCohort> = {}): ProtocolCohort {
  return {
    label: 'SAD',
    dose_regimen: '10 mg once daily',
    description: 'Single ascending dose',
    ordinal: 0,
    source_page: 12,
    ...overrides,
  };
}

function makeDivergence(status: DivergenceRecord['status']): DivergenceRecord {
  return {
    id: crypto.randomUUID(),
    protocol_id: 'p-1',
    divergence_class: 'window_mismatch',
    visit_name: 'V1',
    procedure_label: null,
    reading_a: { source: 'soa_grid', quote: '±3', verbatim: true, section: null, page: null },
    reading_b: { source: 'narrative', quote: '±2', verbatim: true, section: null, page: null },
    detail: 'Windows differ.',
    status,
    dispositions: [],
    created_at: '2026-07-19T10:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// buildStudyOrient
// ---------------------------------------------------------------------------

describe('buildStudyOrient', () => {
  it('states count, span, cohorts, and dosing visits', () => {
    const orient = buildStudyOrient(
      [
        makeWorkspace({ visit_name: 'SCR', study_day: -14 }),
        makeWorkspace({ visit_name: 'C1D1', study_day: 1, is_dosing_visit: true }),
        makeWorkspace({ visit_name: 'EOT', study_day: 85 }),
      ],
      3,
    );
    expect(orient).toBe('3 visits from Day -14 to Day +85 · 3 cohorts · 1 dosing visit');
  });

  it('drops the cohort segment for single-cohort studies and dosing when none', () => {
    const orient = buildStudyOrient(
      [makeWorkspace({ study_day: 1 }), makeWorkspace({ study_day: 8 })],
      0,
    );
    expect(orient).toBe('2 visits from Day +1 to Day +8');
    expect(orient).not.toContain('cohort');
    expect(orient).not.toContain('dosing');
  });

  it('degrades honestly when nothing is parsed', () => {
    expect(buildStudyOrient([], 0)).toBe('No visits parsed yet for this protocol.');
  });
});

// ---------------------------------------------------------------------------
// buildStudyBrief
// ---------------------------------------------------------------------------

describe('buildStudyBrief — the arc', () => {
  it('sorts chronologically and formats day + window labels', () => {
    const brief = buildStudyBrief(
      [
        makeWorkspace({ visit_name: 'C1D1', study_day: 1, window_minus_days: 1, window_plus_days: 2 }),
        makeWorkspace({ visit_name: 'SCR', study_day: -14 }),
        makeWorkspace({ visit_name: 'C1D8', study_day: 8, window_minus_days: 2, window_plus_days: 2 }),
      ],
      [],
      [],
    );
    expect(brief.arc.map((a) => a.visit_name)).toEqual(['SCR', 'C1D1', 'C1D8']);
    expect(brief.arc[0]).toMatchObject({ dayLabel: 'Day -14', windowLabel: null });
    expect(brief.arc[1].windowLabel).toBe('−1/+2 days');
    expect(brief.arc[2].windowLabel).toBe('±2 days');
  });

  it('carries the rare-loud markers and cohort scope per visit', () => {
    const brief = buildStudyBrief(
      [
        makeWorkspace({
          has_safety_critical: true,
          endpoint_critical_count: 2,
          conditional_item_count: 3,
          applies_to: ['MAD'],
          is_dosing_visit: true,
        }),
      ],
      [],
      [],
    );
    expect(brief.arc[0]).toMatchObject({
      hasSafetyCritical: true,
      endpointCriticalCount: 2,
      conditionalCount: 3,
      appliesTo: ['MAD'],
      isDosing: true,
    });
  });
});

describe('buildStudyBrief — cohorts', () => {
  it('orders by ordinal and counts scoped + shared visits per cohort', () => {
    const brief = buildStudyBrief(
      [
        makeWorkspace({ applies_to: ['SAD'] }),
        makeWorkspace({ applies_to: ['MAD'] }),
        makeWorkspace({ applies_to: null }), // shared — counts for everyone
      ],
      [
        makeCohort({ label: 'MAD', ordinal: 1, dose_regimen: '20 mg BID' }),
        makeCohort({ label: 'SAD', ordinal: 0 }),
      ],
      [],
    );
    expect(brief.cohorts.map((c) => c.label)).toEqual(['SAD', 'MAD']);
    expect(brief.cohorts[0].visitCount).toBe(2); // its own + the shared visit
    expect(brief.cohorts[1]).toMatchObject({ visitCount: 2, doseRegimen: '20 mg BID' });
  });
});

describe('buildStudyBrief — divergence count', () => {
  it('counts open + raised, ignores settled', () => {
    const brief = buildStudyBrief(
      [makeWorkspace({})],
      [],
      [
        makeDivergence('open'),
        makeDivergence('raised_with_sponsor'),
        makeDivergence('resolved'),
        makeDivergence('dismissed'),
      ],
    );
    expect(brief.openDivergenceCount).toBe(2);
  });
});
