import { describe, expect, it } from 'vitest';
import {
  adaptVisitTemplate,
  adaptVisitTemplates,
} from '../visitExecutionAdapter';
import type { ProtocolVisitTemplate } from '../../site/types';

// =============================================================================
// visitExecutionAdapter — pure mapper from ProtocolVisitTemplate (existing
// site-mode schema) to VisitExecutionWorkspace. Sprint 1: thin honest
// passthrough — flat items default to phase 'assessment' + classification
// 'required'. Rich workspace data comes from the mock fixture, not this
// adapter, so these tests focus on the adapter's small but important job:
// shape correctness, ordering, dosing-visit heuristic, cross-reference
// surfacing, defensive nullability.
// =============================================================================

function makeTemplate(overrides: Partial<ProtocolVisitTemplate> = {}): ProtocolVisitTemplate {
  return {
    id: 'tpl-x',
    protocol_id: 'proto-x',
    visit_name: 'Visit',
    study_day: 1,
    window_minus_days: 0,
    window_plus_days: 0,
    procedures: [],
    source_document_id: null,
    cross_references: [],
    ...overrides,
  };
}

describe('adaptVisitTemplate', () => {
  it('produces a workspace keyed to the template id', () => {
    const ws = adaptVisitTemplate(makeTemplate({ id: 'abc', protocol_id: 'p1' }));
    expect(ws.visit_template_id).toBe('abc');
    expect(ws.protocol_id).toBe('p1');
  });

  it('maps each procedure to a VisitExecutionItem with required+assessment defaults', () => {
    const ws = adaptVisitTemplate(
      makeTemplate({ procedures: ['Vitals', 'Labs', 'PRO questionnaire'] }),
    );
    expect(ws.items).toHaveLength(3);
    expect(ws.items.map((i) => i.label)).toEqual(['Vitals', 'Labs', 'PRO questionnaire']);
    for (const item of ws.items) {
      expect(item.phase).toBe('assessment');
      expect(item.classification).toBe('required');
      expect(item.review_status).toBe('not_reviewed');
      expect(item.extracted_item_id).toBeNull();
      expect(item.conditions).toEqual([]);
      expect(item.timing).toBeNull();
    }
  });

  it('produces stable, deterministic item ids derived from the template id and index', () => {
    const ws = adaptVisitTemplate(makeTemplate({ id: 'tpl-99', procedures: ['A', 'B'] }));
    expect(ws.items[0].id).toBe('tpl-99-item-00');
    expect(ws.items[1].id).toBe('tpl-99-item-01');
  });

  it('flags is_dosing_visit when any procedure mentions dose/IMP/infusion/administration/dispens', () => {
    const dosingHits = [
      ['Investigational drug administration'],
      ['IMP dispensation'],
      ['IV infusion (60 min)'],
      ['Study drug dispensation'],
      ['Pre-dose vitals'],
    ];
    for (const procs of dosingHits) {
      expect(adaptVisitTemplate(makeTemplate({ procedures: procs })).snapshot.is_dosing_visit).toBe(
        true,
      );
    }

    const nonDosing = adaptVisitTemplate(
      makeTemplate({ procedures: ['Vitals', 'Labs', 'PRO questionnaire'] }),
    );
    expect(nonDosing.snapshot.is_dosing_visit).toBe(false);
  });

  it('hoists the first visit-level cross-reference onto every item that has no other source', () => {
    const ws = adaptVisitTemplate(
      makeTemplate({
        procedures: ['Vitals', 'Labs'],
        cross_references: [
          {
            source_section: 'Pharmacy Manual §5',
            snippet: 'At each visit, dispense the next supply.',
            page: 9,
            document_id: null,
          },
          {
            source_section: 'Lab Manual §3',
            snippet: 'Fasting required.',
            page: 14,
            document_id: null,
          },
        ],
      }),
    );
    for (const item of ws.items) {
      expect(item.traceability.cross_reference_source_section).toBe('Pharmacy Manual §5');
      expect(item.traceability.cross_reference_page).toBe(9);
      expect(item.traceability.cross_reference_snippet).toContain('dispense');
    }
  });

  it('leaves cross-reference traceability fields null when none exist', () => {
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['Vitals'], cross_references: [] }));
    expect(ws.items[0].traceability.cross_reference_source_section).toBeNull();
    expect(ws.items[0].traceability.cross_reference_page).toBeNull();
    expect(ws.items[0].traceability.cross_reference_snippet).toBeNull();
  });

  it('produces a snapshot with item_count matching items length', () => {
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['A', 'B', 'C'] }));
    expect(ws.snapshot.item_count).toBe(3);
  });

  it('reports zero endpoint/conditional counts in the thin Sprint 1 mapping', () => {
    // The adapter cannot infer classification from a TEXT[] of procedure names.
    // These should be zero — rich classification is the mock fixture's job.
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['Vitals', 'Labs'] }));
    expect(ws.snapshot.endpoint_critical_count).toBe(0);
    expect(ws.snapshot.conditional_item_count).toBe(0);
    expect(ws.snapshot.has_primary_endpoint).toBe(false);
    expect(ws.snapshot.has_safety_critical).toBe(false);
  });

  it('honestly labels the purpose as pending structured extraction', () => {
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['Vitals'] }));
    expect(ws.snapshot.purpose.toLowerCase()).toContain('pending');
  });

  it('treats missing procedures array defensively (empty items, no crash)', () => {
    const ws = adaptVisitTemplate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeTemplate({ procedures: undefined as unknown as any[] }),
    );
    expect(ws.items).toEqual([]);
    expect(ws.snapshot.item_count).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // Sprint 3.5a additions — the new VisitConfidenceState + VisitCompletenessSignal
  // fields. The thin adapter has no parser confidence or detected gaps to
  // report (those come from the v2 RPC once 3.5b ingest writes the new tables).
  // The adapter MUST default them honestly:
  //   snapshot.confidence_state         → null
  //   snapshot.completeness_signal_count → 0
  //   snapshot.completeness_signals      → []
  //   item.confidence_state              → null
  // ---------------------------------------------------------------------------

  it('defaults snapshot.confidence_state to null in the thin Sprint 1 mapping', () => {
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['Vitals'] }));
    expect(ws.snapshot.confidence_state).toBeNull();
  });

  it('defaults completeness_signals to an empty array (count 0)', () => {
    const ws = adaptVisitTemplate(makeTemplate({ procedures: ['Vitals'] }));
    expect(ws.snapshot.completeness_signals).toEqual([]);
    expect(ws.snapshot.completeness_signal_count).toBe(0);
  });

  it('defaults each item.confidence_state to null (no extracted_item linked)', () => {
    const ws = adaptVisitTemplate(
      makeTemplate({ procedures: ['Vitals', 'Labs', 'PRO questionnaire'] }),
    );
    for (const item of ws.items) {
      expect(item.confidence_state).toBeNull();
    }
  });
});

describe('adaptVisitTemplates (batch)', () => {
  it('sorts visits by study_day ascending', () => {
    const out = adaptVisitTemplates([
      makeTemplate({ id: 'late', visit_name: 'Late', study_day: 28 }),
      makeTemplate({ id: 'screen', visit_name: 'Screening', study_day: -14 }),
      makeTemplate({ id: 'baseline', visit_name: 'Baseline', study_day: 1 }),
    ]);
    expect(out.map((w) => w.visit_template_id)).toEqual(['screen', 'baseline', 'late']);
  });

  it('returns an empty array when given no templates', () => {
    expect(adaptVisitTemplates([])).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const input = [
      makeTemplate({ id: 'b', study_day: 7 }),
      makeTemplate({ id: 'a', study_day: 1 }),
    ];
    const originalOrder = input.map((t) => t.id);
    adaptVisitTemplates(input);
    expect(input.map((t) => t.id)).toEqual(originalOrder);
  });
});
