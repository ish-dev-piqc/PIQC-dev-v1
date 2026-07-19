import { describe, it, expect } from 'vitest';
import {
  BRIEF_LINE_CAP,
  buildVisitBrief,
  formatBriefWhere,
  type VisitBriefLine,
} from '../visitBriefModel';
import type { DivergenceRecord } from '../../../types/divergence';
import type {
  VisitExecutionItem,
  VisitExecutionWorkspace,
  VisitSnapshot,
} from '../../../types/visit-execution';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<VisitExecutionItem> = {}): VisitExecutionItem {
  return {
    id: crypto.randomUUID(),
    extracted_item_id: null,
    label: 'Vital signs',
    derived_text: 'Vital signs',
    description: null,
    phase: 'assessment',
    classification: 'required',
    conditions: [],
    timing: null,
    source_fields: [],
    traceability: {
      soa_column: null,
      protocol_section: '5.1',
      protocol_page: 30,
      amendment_version: null,
      source_evidence_id: null,
      source_quote: 'Vital signs will be assessed at every visit.',
      cross_reference_source_section: null,
      cross_reference_page: null,
      cross_reference_snippet: null,
    },
    role_hint: 'Nurse',
    review_status: 'not_reviewed',
    review_note: null,
    confidence_state: null,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<VisitSnapshot> = {}): VisitSnapshot {
  return {
    visit_name: 'C2D1',
    study_day: 22,
    window_minus_days: 3,
    window_plus_days: 3,
    purpose: 'First continued-dosing decision: safety and PK before the Cycle 2 dose.',
    is_dosing_visit: true,
    has_primary_endpoint: false,
    has_safety_critical: true,
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
    ...overrides,
  };
}

function makeWorkspace(
  snapshot: Partial<VisitSnapshot> = {},
  items: VisitExecutionItem[] = [],
): VisitExecutionWorkspace {
  return {
    visit_template_id: 'vt-1',
    protocol_id: 'p-1',
    snapshot: makeSnapshot({ ...snapshot, item_count: items.length }),
    items,
  };
}

function makeDivergence(overrides: Partial<DivergenceRecord> = {}): DivergenceRecord {
  return {
    id: crypto.randomUUID(),
    protocol_id: 'p-1',
    class: 'window_mismatch',
    locus_key: 'visit:C2D1:window',
    visit_name: 'C2D1',
    procedure_label: null,
    reading_a: { source: 'soa_grid', value: '±3 days', where: 'Appendix 2 p 96' },
    reading_b: { source: 'narrative', value: '±2 days', where: '§5.2 p 28' },
    detail: 'Window components differ.',
    status: 'open',
    dispositions: [],
    created_at: '2026-07-19T10:00:00Z',
    updated_at: '2026-07-19T10:00:00Z',
    ...overrides,
  } as DivergenceRecord;
}

function byKind(lines: VisitBriefLine[], kind: VisitBriefLine['kind']) {
  return lines.filter((l) => l.kind === kind);
}

// ---------------------------------------------------------------------------
// formatBriefWhere
// ---------------------------------------------------------------------------

describe('formatBriefWhere', () => {
  it('joins section and page, normalizing a pre-existing § prefix', () => {
    expect(formatBriefWhere('7.3.1', 42)).toBe('§7.3.1 · p 42');
    expect(formatBriefWhere('§ 7.3.1', 42)).toBe('§7.3.1 · p 42');
  });

  it('degrades to whichever half exists, and null when neither does', () => {
    expect(formatBriefWhere('7.4', null)).toBe('§7.4');
    expect(formatBriefWhere(null, 45)).toBe('p 45');
    expect(formatBriefWhere(null, null)).toBeNull();
    expect(formatBriefWhere('   ', null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildVisitBrief
// ---------------------------------------------------------------------------

describe('buildVisitBrief — line assembly', () => {
  it('always opens with the PIQC-drafted orient line, then the clock', () => {
    const lines = buildVisitBrief(makeWorkspace(), []);
    expect(lines[0]).toMatchObject({
      kind: 'orient',
      piqcDrafted: true,
      text: expect.stringContaining('First continued-dosing decision'),
    });
    expect(byKind(lines, 'clock')[0].text).toBe(
      'Scheduled at Study Day +22, window ±3 days.',
    );
  });

  it('renders asymmetric windows and omits the window when the schedule states none', () => {
    const asym = buildVisitBrief(
      makeWorkspace({ window_minus_days: 1, window_plus_days: 2 }),
      [],
    );
    expect(byKind(asym, 'clock')[0].text).toContain('window −1/+2 days');

    const none = buildVisitBrief(
      makeWorkspace({ window_minus_days: 0, window_plus_days: 0 }),
      [],
    );
    expect(byKind(none, 'clock')[0].text).toBe('Scheduled at Study Day +22.');
    expect(byKind(none, 'clock')[0].text).not.toContain('window');
  });

  it('adds a scope line only for cohort-scoped visits', () => {
    const scoped = buildVisitBrief(makeWorkspace({ applies_to: ['Cohort B'] }), []);
    expect(byKind(scoped, 'scope')[0].text).toBe('Applies to Cohort B only.');

    const shared = buildVisitBrief(makeWorkspace({ applies_to: null }), []);
    expect(byKind(shared, 'scope')).toHaveLength(0);
  });

  it('passes the thin-adapter placeholder purpose through honestly', () => {
    const placeholder =
      'Per-protocol visit. Detailed execution requirements pending structured ingest extraction.';
    const lines = buildVisitBrief(makeWorkspace({ purpose: placeholder }), []);
    expect(lines[0].text).toBe(placeholder);
  });
});

describe('buildVisitBrief — gate lines and citation discipline', () => {
  const ecg = makeItem({
    label: '12-lead ECG, triplicate',
    conditions: [
      {
        condition_text: 'mean triplicate QTcF exceeds 480 ms',
        consequence_text: 'withhold study drug and notify the medical monitor within 24 hours',
        source_section: '7.3.2',
        source_page: 43,
      },
    ],
  });

  it('writes an if/then sentence citing the condition’s OWN source only', () => {
    const lines = buildVisitBrief(makeWorkspace({}, [ecg]), []);
    const gate = byKind(lines, 'gate')[0];
    expect(gate.text).toBe(
      '12-lead ECG, triplicate — if mean triplicate QTcF exceeds 480 ms, then withhold study drug and notify the medical monitor within 24 hours',
    );
    expect(gate.refs).toEqual([{ label: '§7.3.2 · p 43', section: '7.3.2', page: 43 }]);
  });

  it('never borrows the item’s SoA traceability for an unlocated condition', () => {
    const unlocated = makeItem({
      label: 'Safety labs review',
      conditions: [
        {
          condition_text: 'ANC below 1.5',
          consequence_text: 'hold the dose',
          source_section: null,
          source_page: null,
        },
      ],
      // Item-level traceability exists — must NOT be attached to the gate claim.
      traceability: {
        ...makeItem().traceability,
        protocol_section: '7.4',
        protocol_page: 45,
      },
    });
    const gate = byKind(buildVisitBrief(makeWorkspace({}, [unlocated]), []), 'gate')[0];
    expect(gate.refs).toEqual([]);
  });

  it('summarizes multi-condition items instead of dropping the extras silently', () => {
    const multi = makeItem({
      label: 'PK draw',
      conditions: [
        { condition_text: 'A', consequence_text: 'B', source_section: null, source_page: null },
        { condition_text: 'C', consequence_text: 'D', source_section: null, source_page: null },
      ],
    });
    const gate = byKind(buildVisitBrief(makeWorkspace({}, [multi]), []), 'gate')[0];
    expect(gate.text).toContain('(+1 more condition)');
  });

  it('caps gate lines and names the trimmed remainder', () => {
    const gates = Array.from({ length: BRIEF_LINE_CAP + 2 }, (_, i) =>
      makeItem({
        label: `Gated ${i}`,
        conditions: [
          { condition_text: 'x', consequence_text: 'y', source_section: null, source_page: null },
        ],
      }),
    );
    const lines = buildVisitBrief(makeWorkspace({}, gates), []);
    expect(byKind(lines, 'gate')).toHaveLength(BRIEF_LINE_CAP);
    const more = byKind(lines, 'more')[0];
    expect(more.text).toContain('2 more conditional or timed requirements');
    expect(more.text).toContain('sequence below');
  });
});

describe('buildVisitBrief — timed lines', () => {
  it('surfaces hard timing constraints with the timing source, skipping soft ones', () => {
    const hard = makeItem({
      label: 'PK draw — pre-dose',
      timing: {
        label: 'Within 30 min before dosing',
        window_before_minutes: 30,
        window_after_minutes: 0,
        is_hard_constraint: true,
        source_section: '9.1',
      },
    });
    const soft = makeItem({
      label: 'Questionnaire',
      timing: {
        label: 'Any time during visit',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: false,
        source_section: null,
      },
    });
    const lines = buildVisitBrief(makeWorkspace({}, [hard, soft]), []);
    const timed = byKind(lines, 'timed');
    expect(timed).toHaveLength(1);
    expect(timed[0].text).toBe('PK draw — pre-dose — Within 30 min before dosing.');
    expect(timed[0].refs).toEqual([{ label: '§9.1', section: '9.1', page: null }]);
  });

  it('does not restate a gated item as a timed line (the gate sentence is sharper)', () => {
    const both = makeItem({
      label: 'ECG',
      conditions: [
        { condition_text: 'x', consequence_text: 'y', source_section: null, source_page: null },
      ],
      timing: {
        label: 'Before dosing',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: true,
        source_section: null,
      },
    });
    const lines = buildVisitBrief(makeWorkspace({}, [both]), []);
    expect(byKind(lines, 'gate')).toHaveLength(1);
    expect(byKind(lines, 'timed')).toHaveLength(0);
  });
});

describe('buildVisitBrief — divergence watch-out', () => {
  it('counts open and raised divergences, ignoring settled ones', () => {
    const lines = buildVisitBrief(makeWorkspace(), [
      makeDivergence({ status: 'open' }),
      makeDivergence({ status: 'raised_with_sponsor' }),
      makeDivergence({ status: 'resolved' }),
      makeDivergence({ status: 'dismissed' }),
    ]);
    const watch = byKind(lines, 'watchout')[0];
    expect(watch.text).toContain('conflicting readings on 2 details');
  });

  it('uses the singular sentence for one live divergence and no line for none', () => {
    const one = buildVisitBrief(makeWorkspace(), [makeDivergence()]);
    expect(byKind(one, 'watchout')[0].text).toContain('two readings of one detail');

    const settled = buildVisitBrief(makeWorkspace(), [
      makeDivergence({ status: 'dismissed' }),
    ]);
    expect(byKind(settled, 'watchout')).toHaveLength(0);
  });
});
