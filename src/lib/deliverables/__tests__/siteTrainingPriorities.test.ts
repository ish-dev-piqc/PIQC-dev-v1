import { describe, expect, it } from 'vitest';
import {
  selectSiteTrainingPrioritiesBlocks,
  type SiteTrainingBlockSpec,
} from '../selection/siteTrainingPriorities';
import type { SelectionInput, SelectionSourceItem } from '../selection/monitoringChecklist';
import { SITE_TRAINING_SECTION_ORDER } from '../../../types/deliverables';

// =============================================================================
// siteTrainingPriorities selection — the unit-tested SPEC for
// deliverable_generate's site_training_priorities branch. Pins: the
// completeness doctrine (four fact domains ALWAYS say something), the
// instructional register (distinct from the four sibling lenses),
// content-origin discipline, boundary thresholds, malformed-input guards, and
// determinism.
// =============================================================================

let nextId = 0;
function item(
  fieldType: string,
  fieldPath: string,
  value: unknown,
  opts: Partial<Pick<SelectionSourceItem, 'confidence_state' | 'primary_evidence'>> = {},
): SelectionSourceItem {
  nextId += 1;
  return {
    id: `item-${nextId}`,
    field_type: fieldType,
    field_path: fieldPath,
    extracted_value: value,
    confidence_state: opts.confidence_state !== undefined ? opts.confidence_state : 'high',
    primary_evidence:
      opts.primary_evidence !== undefined
        ? opts.primary_evidence
        : {
            id: `ev-${nextId}`,
            quoted_text: `quote for ${fieldPath}`,
            page_number: nextId,
            section_title: `Section ${nextId}`,
          },
  };
}

function visitValue(
  name: string,
  day: number | null,
  minus: number,
  plus: number,
  procedures: string[] = [],
): Record<string, unknown> {
  return {
    visit_name: name,
    study_day: day,
    window_minus_days: minus,
    window_plus_days: plus,
    procedures,
  };
}

function input(
  items: SelectionSourceItem[],
  cohorts: SelectionInput['cohorts'] = [],
): SelectionInput {
  return { items, cohorts, protocolVersion: null };
}

/** A protocol that exercises every section with real facts. */
function fullInput(): SelectionInput {
  nextId = 0; // deterministic ids so two builds of the fixture are identical
  return input([
    item('inclusion_criterion', 'key_inclusion_criteria[0]', 'Age 18 to 75 years, inclusive.'),
    item('exclusion_criterion', 'key_exclusion_criteria[0]', 'Pregnant or breastfeeding.'),
    item('prohibited_med', 'prohibited_medications[0]', 'Strong CYP3A4 inhibitors.'),
    item('visit', 'schedule_of_events[0]', visitValue('Screening', -14, 3, 3, ['Central lab draw'])),
    item('visit', 'schedule_of_events[1]', visitValue('Baseline', 0, 0, 0, ['ECG', 'Urinalysis'])),
    item('endpoint', 'primary_endpoints[0]', 'Change in HbA1c at week 12.'),
    item('endpoint', 'secondary_endpoints[0]', 'Proportion achieving target at week 24.'),
    item('metadata', 'amendment_summary', 'Amendment 2 revised the dosing schedule.'),
  ]);
}

const bySection = (blocks: SiteTrainingBlockSpec[], key: string) =>
  blocks.filter((b) => b.section_key === key);

describe('selectSiteTrainingPrioritiesBlocks', () => {
  it('emits sections only in SITE_TRAINING_SECTION_ORDER and in that order', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const seen: string[] = [];
    for (const b of blocks) {
      if (seen[seen.length - 1] !== b.section_key) seen.push(b.section_key);
    }
    // No section repeats non-contiguously, and every key is known + ordered.
    expect(new Set(seen).size).toBe(seen.length);
    const orderIndex = (k: string) => SITE_TRAINING_SECTION_ORDER.indexOf(k as never);
    for (const k of seen) expect(orderIndex(k)).toBeGreaterThanOrEqual(0);
    expect(seen).toEqual([...seen].sort((a, b) => orderIndex(a) - orderIndex(b)));
  });

  it('completeness doctrine: all seven sections appear on a full protocol', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    for (const key of SITE_TRAINING_SECTION_ORDER) {
      expect(bySection(blocks, key).length, `section ${key} missing`).toBeGreaterThan(0);
    }
  });

  it('sort_order is a contiguous 0-based sequence in emission order', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    expect(blocks.map((b) => b.sort_order)).toEqual(blocks.map((_, i) => i));
  });

  it('is deterministic — two builds of the same fixture are identical', () => {
    expect(selectSiteTrainingPrioritiesBlocks(fullInput())).toEqual(
      selectSiteTrainingPrioritiesBlocks(fullInput()),
    );
  });

  // --- content-origin discipline --------------------------------------------

  it('protocol_fact blocks always carry item id + evidence + confidence', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    for (const b of blocks.filter((x) => x.content_origin === 'protocol_fact')) {
      expect(b.extracted_item_id).toBeTruthy();
      expect(b.source_evidence_id).toBeTruthy();
      expect(b.confidence_state).not.toBeNull();
    }
  });

  it('framing blocks never carry evidence or confidence (no false provenance)', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    for (const b of blocks.filter((x) => x.content_origin === 'derived_operational_framing')) {
      expect(b.extracted_item_id).toBeNull();
      expect(b.source_evidence_id).toBeNull();
      expect(b.confidence_state).toBeNull();
    }
  });

  it('never emits human_editorial', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    expect(blocks.some((b) => b.content_origin === 'human_editorial')).toBe(false);
  });

  // --- register: instructional, distinct from the sibling lenses ------------

  it('every fact card uses a training verb, never a sibling lens template', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const facts = blocks.filter((b) => b.content_origin === 'protocol_fact');
    for (const b of facts) {
      expect(/\b(train|retrain|brief)\b/i.test(b.derived_text), b.derived_text).toBe(true);
    }
    const allProse = blocks.map((b) => b.derived_text).join('\n');
    // Signature imperatives owned by the other four lenses must not appear.
    expect(allProse).not.toMatch(/Confirm absence of/);
    expect(allProse).not.toMatch(/Prioritize verification of/);
    expect(allProse).not.toMatch(/Visit window pressure —/);
    expect(allProse).not.toMatch(/^Verify:/m);
  });

  it('contains no numeric readiness score anywhere', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const allProse = blocks.map((b) => b.derived_text).join('\n');
    expect(allProse).not.toMatch(/\b(score|scored|scoring|rating|\/\s*(10|100))\b/i);
  });

  // --- section 1: eligibility -----------------------------------------------

  it('eligibility: one fact per inclusion, exclusion, and prohibited_med', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const facts = bySection(blocks, 'eligibility_screening_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(facts.some((b) => /inclusion requirement/.test(b.derived_text))).toBe(true);
    expect(facts.some((b) => /rule out the exclusion/.test(b.derived_text))).toBe(true);
    expect(facts.some((b) => /screen medication history/.test(b.derived_text))).toBe(true);
    expect(facts).toHaveLength(3);
  });

  it('eligibility: gap framing when no criteria extracted', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(input([]));
    const sec = bySection(blocks, 'eligibility_screening_training');
    expect(sec.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
    expect(sec.some((b) => /No eligibility criteria were extracted/.test(b.derived_text))).toBe(true);
  });

  // --- section 2: visit schedule --------------------------------------------

  it('visit schedule: narrow window (<=2d) gets emphasis, wide window does not', () => {
    nextId = 0;
    const blocks = selectSiteTrainingPrioritiesBlocks(
      input([
        item('visit', 'schedule_of_events[0]', visitValue('Tight', 7, 1, 0)),
        item('visit', 'schedule_of_events[1]', visitValue('Loose', 30, 7, 7)),
      ]),
    );
    const facts = bySection(blocks, 'visit_schedule_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    const tight = facts.find((b) => /Tight/.test(b.derived_text))!;
    const loose = facts.find((b) => /Loose/.test(b.derived_text))!;
    expect(tight.derived_text).toMatch(/narrow window/);
    expect(loose.derived_text).not.toMatch(/narrow window/);
  });

  it('visit schedule: gap framing when no visits extracted', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(input([]));
    const sec = bySection(blocks, 'visit_schedule_training');
    expect(sec.some((b) => /No visit schedule was extracted/.test(b.derived_text))).toBe(true);
  });

  // --- section 3: procedures -------------------------------------------------

  it('procedures: categorized procedures become forced-low facts, deduped', () => {
    nextId = 0;
    const blocks = selectSiteTrainingPrioritiesBlocks(
      input([
        item('visit', 'schedule_of_events[0]', visitValue('V1', 1, 3, 3, ['MRI scan', 'Central lab'])),
        item('visit', 'schedule_of_events[1]', visitValue('V2', 8, 3, 3, ['MRI scan'])), // dup MRI
      ]),
    );
    const facts = bySection(blocks, 'procedure_specimen_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(facts.every((b) => b.confidence_state === 'low')).toBe(true);
    // MRI deduped (first visit wins), central lab kept → 2 facts, not 3.
    expect(facts).toHaveLength(2);
    expect(facts.every((b) => /^Train site staff on/.test(b.derived_text))).toBe(true);
  });

  it('procedures: gap framing when no vendor/lab/imaging procedures', () => {
    nextId = 0;
    const blocks = selectSiteTrainingPrioritiesBlocks(
      input([item('visit', 'schedule_of_events[0]', visitValue('V1', 1, 3, 3, ['Vital signs']))]),
    );
    const sec = bySection(blocks, 'procedure_specimen_training');
    expect(sec.some((b) => /detected no laboratory, imaging, or vendor/.test(b.derived_text))).toBe(
      true,
    );
  });

  // --- section 4: endpoints --------------------------------------------------

  it('endpoints: primary and secondary get distinct prefixes', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const facts = bySection(blocks, 'endpoint_data_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(facts.some((b) => /^PRIMARY ENDPOINT — train/.test(b.derived_text))).toBe(true);
    expect(facts.some((b) => /^Secondary endpoint — train/.test(b.derived_text))).toBe(true);
  });

  // --- section 5: safety (always framing) -----------------------------------

  it('safety: always two framing training items regardless of facts', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(input([]));
    const items = bySection(blocks, 'safety_oversight_training').filter(
      (b) => b.block_type === 'checklist_item',
    );
    expect(items).toHaveLength(2);
    expect(items.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
  });

  // --- section 6: amendment --------------------------------------------------

  it('amendment: fact + Retrain instruction when an amendment was extracted', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(fullInput());
    const fact = bySection(blocks, 'amendment_retraining').find(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(fact).toBeDefined();
    expect(fact!.derived_text).toMatch(/Retrain affected site staff/);
  });

  it('amendment: framing fallback when no amendment', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(input([]));
    const sec = bySection(blocks, 'amendment_retraining');
    expect(sec.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
    expect(sec.some((b) => /No amendment was detected/.test(b.derived_text))).toBe(true);
  });

  // --- section 7: logistics questions ---------------------------------------

  it('logistics: always three site_question blocks', () => {
    const blocks = selectSiteTrainingPrioritiesBlocks(input([]));
    const qs = bySection(blocks, 'training_logistics_questions');
    expect(qs).toHaveLength(3);
    expect(qs.every((b) => b.block_type === 'site_question')).toBe(true);
  });

  // --- malformed-input guards ------------------------------------------------

  it('skips malformed visit values without throwing', () => {
    nextId = 0;
    const blocks = selectSiteTrainingPrioritiesBlocks(
      input([
        item('visit', 'schedule_of_events[0]', 'not an object'),
        item('visit', 'schedule_of_events[1]', { study_day: 5 }), // no visit_name
        item('visit', 'schedule_of_events[2]', visitValue('Real', 1, 0, 0)),
      ]),
    );
    const facts = bySection(blocks, 'visit_schedule_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].derived_text).toMatch(/Real/);
  });

  it('skips empty-string criteria', () => {
    nextId = 0;
    const blocks = selectSiteTrainingPrioritiesBlocks(
      input([item('inclusion_criterion', 'key_inclusion_criteria[0]', '   ')]),
    );
    const facts = bySection(blocks, 'eligibility_screening_training').filter(
      (b) => b.content_origin === 'protocol_fact',
    );
    expect(facts).toHaveLength(0);
  });
});
