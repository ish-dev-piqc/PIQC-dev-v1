import { describe, it, expect } from 'vitest';
import {
  selectMonitoringChecklistBlocks,
  type SelectionInput,
  type SelectionSourceItem,
  type NewBlockSpec,
} from '../selection/monitoringChecklist';
import { MONITORING_SECTION_ORDER } from '../../../types/deliverables';

// -----------------------------------------------------------------------------
// Fixture builders
// -----------------------------------------------------------------------------

function evidence(
  id: string,
  quote: string,
  page: number | null,
  section: string | null,
): NonNullable<SelectionSourceItem['primary_evidence']> {
  return { id, quoted_text: quote, page_number: page, section_title: section };
}

function item(
  overrides: Pick<SelectionSourceItem, 'id' | 'field_type' | 'field_path' | 'extracted_value'> &
    Partial<SelectionSourceItem>,
): SelectionSourceItem {
  return { confidence_state: 'high', primary_evidence: null, ...overrides };
}

function input(
  items: SelectionSourceItem[],
  cohorts: SelectionInput['cohorts'] = [],
  protocolVersion: string | null = 'v2.0',
): SelectionInput {
  return { items, cohorts, protocolVersion };
}

function blocksIn(blocks: NewBlockSpec[], sectionKey: string): NewBlockSpec[] {
  return blocks.filter((b) => b.section_key === sectionKey);
}

/**
 * A protocol exercising every section: 2 inclusion criteria, 1 exclusion
 * criterion, 2 visits (one windowed with lab+imaging procedures, one 0/0 with
 * an overlapping procedure for dedupe), primary + secondary endpoints, an
 * amendment summary, non-selected items (dosing, protocol_version metadata),
 * and 2 cohorts.
 */
function fullProtocolInput(): SelectionInput {
  return input(
    [
      item({
        id: 'inc-1',
        field_type: 'inclusion_criterion',
        field_path: 'key_inclusion_criteria[0]',
        extracted_value: 'Age >= 18 years',
        primary_evidence: evidence(
          'ev-inc-1',
          'Patients must be at least 18 years of age',
          10,
          'Section 4.1 Inclusion Criteria',
        ),
      }),
      item({
        id: 'inc-2',
        field_type: 'inclusion_criterion',
        field_path: 'key_inclusion_criteria[1]',
        extracted_value: 'Diagnosis of schizophrenia',
        confidence_state: 'medium',
        primary_evidence: evidence('ev-inc-2', 'DSM-5 diagnosis of schizophrenia', 10, 'Section 4.1'),
      }),
      item({
        id: 'exc-1',
        field_type: 'exclusion_criterion',
        field_path: 'key_exclusion_criteria[0]',
        extracted_value: 'Pregnancy or breastfeeding',
        primary_evidence: evidence(
          'ev-exc-1',
          'Pregnant or breastfeeding women are excluded',
          11,
          'Section 4.2 Exclusion Criteria',
        ),
      }),
      item({
        id: 'vis-1',
        field_type: 'visit',
        field_path: 'schedule_of_events[0]',
        extracted_value: {
          visit_name: 'Visit 2',
          study_day: 14,
          window_minus_days: 3,
          window_plus_days: 3,
          procedures: ['Blood draw', 'ECG (12-lead)'],
        },
        primary_evidence: evidence('ev-vis-1', '6.3.2 Visit 2 (Week 2, Day 14±3)', 22, 'Section 6.3'),
      }),
      item({
        id: 'vis-2',
        field_type: 'visit',
        field_path: 'schedule_of_events[1]',
        extracted_value: {
          visit_name: 'Screening',
          study_day: -14,
          window_minus_days: 0,
          window_plus_days: 0,
          // 'Blood draw' repeats from Visit 2 → must dedupe (first visit wins)
          procedures: ['Serum chemistry', 'Blood draw'],
        },
        primary_evidence: evidence('ev-vis-2', 'Screening (Day -14)', 20, 'Section 6.1'),
      }),
      item({
        id: 'ep-1',
        field_type: 'endpoint',
        field_path: 'primary_endpoints[0]',
        extracted_value: 'Change in PANSS score at week 24',
        primary_evidence: evidence('ev-ep-1', 'Primary endpoint: PANSS total score change', 5, 'Section 2.1'),
      }),
      item({
        id: 'ep-2',
        field_type: 'endpoint',
        field_path: 'secondary_endpoints[0]',
        extracted_value: 'Response rate at week 12',
        confidence_state: 'medium',
        primary_evidence: evidence('ev-ep-2', 'Key secondary endpoint: response rate', 5, 'Section 2.2'),
      }),
      item({
        id: 'amd-1',
        field_type: 'metadata',
        field_path: 'amendment_summary',
        extracted_value: 'Dosing frequency reduced in Amendment 2',
        primary_evidence: evidence('ev-amd-1', 'Amendment 2: dosing frequency reduced', 3, 'Amendment History'),
      }),
      // Non-selected items — must produce no blocks.
      item({
        id: 'meta-1',
        field_type: 'metadata',
        field_path: 'protocol_version',
        extracted_value: 'v2.0',
      }),
      item({
        id: 'dos-1',
        field_type: 'dosing',
        field_path: 'dosing_regimen',
        extracted_value: '10 mg/kg once daily',
        primary_evidence: evidence('ev-dos-1', '10 mg/kg administered once daily', 15, 'Section 5.1'),
      }),
    ],
    [
      { label: 'S1', dose_regimen: '10 mg QD', description: 'Single ascending dose' },
      { label: 'MAD', dose_regimen: null, description: null },
    ],
  );
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('selectMonitoringChecklistBlocks', () => {
  // ---------------------------------------------------------------------------
  // T1 — Full protocol: section grouping, counts, global ordering
  // ---------------------------------------------------------------------------
  describe('full-protocol fixture', () => {
    const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());

    it('emits all nine sections in MONITORING_SECTION_ORDER', () => {
      const sectionSequence: string[] = [];
      for (const block of blocks) {
        if (sectionSequence[sectionSequence.length - 1] !== block.section_key) {
          sectionSequence.push(block.section_key);
        }
      }
      expect(sectionSequence).toEqual([...MONITORING_SECTION_ORDER]);
    });

    it('emits the expected block count per section', () => {
      expect(blocksIn(blocks, 'eligibility_verification')).toHaveLength(3);      // intro + 2 facts
      expect(blocksIn(blocks, 'exclusion_prohibited_med_review')).toHaveLength(3); // intro + 1 fact + gap
      expect(blocksIn(blocks, 'visit_window_verification')).toHaveLength(3);     // intro + 2 facts
      expect(blocksIn(blocks, 'endpoint_critical_checks')).toHaveLength(3);      // intro + 2 facts
      expect(blocksIn(blocks, 'arm_cohort_randomization_deps')).toHaveLength(4); // intro + 2 cohorts + randomization
      expect(blocksIn(blocks, 'safety_specimen_imaging_vendor_checks')).toHaveLength(3); // 3 unique matched procedures
      expect(blocksIn(blocks, 'source_doc_focus')).toHaveLength(3);              // intro + primary + safety
      expect(blocksIn(blocks, 'amendment_sensitive')).toHaveLength(2);           // intro + fact
      expect(blocksIn(blocks, 'site_questions')).toHaveLength(3);                // 3 templated questions
      expect(blocks).toHaveLength(27);
    });

    it('assigns a contiguous, globally increasing sort_order starting at 0', () => {
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });

    it('opens fact-bearing sections with a section_intro framing block', () => {
      for (const sectionKey of [
        'eligibility_verification',
        'exclusion_prohibited_med_review',
        'visit_window_verification',
        'endpoint_critical_checks',
        'arm_cohort_randomization_deps',
        'source_doc_focus',
        'amendment_sensitive',
      ]) {
        const first = blocksIn(blocks, sectionKey)[0];
        expect(first.block_type).toBe('section_intro');
        expect(first.content_origin).toBe('derived_operational_framing');
      }
    });

    it('does not select dosing or non-amendment metadata items', () => {
      const referencedIds = blocks.map((b) => b.extracted_item_id);
      expect(referencedIds).not.toContain('dos-1');
      expect(referencedIds).not.toContain('meta-1');
    });

    it('is deterministic — same input yields identical output', () => {
      expect(selectMonitoringChecklistBlocks(fullProtocolInput())).toEqual(blocks);
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Content-origin discipline (the 3-way taxonomy, never blurred)
  // ---------------------------------------------------------------------------
  describe('content_origin discipline', () => {
    const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());

    it('never emits human_editorial', () => {
      expect(blocks.every((b) => b.content_origin !== 'human_editorial')).toBe(true);
    });

    it('gives every protocol_fact block an extracted_item_id AND a confidence_state', () => {
      const facts = blocks.filter((b) => b.content_origin === 'protocol_fact');
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.extracted_item_id).not.toBeNull();
        expect(fact.confidence_state).not.toBeNull();
        expect(fact.block_type).toBe('checklist_item');
      }
    });

    it('gives every framing block NO evidence linkage and NO confidence', () => {
      const framing = blocks.filter((b) => b.content_origin === 'derived_operational_framing');
      expect(framing.length).toBeGreaterThan(0);
      for (const block of framing) {
        expect(block.extracted_item_id).toBeNull();
        expect(block.source_evidence_id).toBeNull();
        expect(block.source_quote).toBeNull();
        expect(block.source_page_number).toBeNull();
        expect(block.source_section).toBeNull();
        expect(block.confidence_state).toBeNull();
      }
    });

    it('degrades a fact with null item confidence to needs_review, never null', () => {
      const result = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'inc-nc',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'ECOG performance status 0-1',
            confidence_state: null,
          }),
        ]),
      );
      const fact = result.find((b) => b.extracted_item_id === 'inc-nc');
      expect(fact?.confidence_state).toBe('needs_review');
    });
  });

  // ---------------------------------------------------------------------------
  // T3 — Evidence passthrough onto fact blocks
  // ---------------------------------------------------------------------------
  describe('evidence passthrough', () => {
    const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());

    it('copies quote, page, and section from the primary evidence onto the block', () => {
      const fact = blocks.find((b) => b.extracted_item_id === 'inc-1');
      expect(fact).toBeDefined();
      expect(fact?.source_evidence_id).toBe('ev-inc-1');
      expect(fact?.source_quote).toBe('Patients must be at least 18 years of age');
      expect(fact?.source_page_number).toBe(10);
      expect(fact?.source_section).toBe('Section 4.1 Inclusion Criteria');
      expect(fact?.confidence_state).toBe('high');
    });

    it('carries the item confidence through unchanged (non-heuristic sections)', () => {
      const fact = blocks.find((b) => b.extracted_item_id === 'inc-2');
      expect(fact?.confidence_state).toBe('medium');
    });

    it('emits a fact with null evidence fields when the item has no primary evidence', () => {
      const result = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'inc-noev',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Able to provide informed consent',
            primary_evidence: null,
          }),
        ]),
      );
      const fact = result.find((b) => b.extracted_item_id === 'inc-noev');
      expect(fact).toBeDefined();
      expect(fact?.source_evidence_id).toBeNull();
      expect(fact?.source_quote).toBeNull();
      expect(fact?.source_page_number).toBeNull();
      expect(fact?.source_section).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // T4 — Section 1: eligibility verification
  // ---------------------------------------------------------------------------
  describe('eligibility_verification', () => {
    it('prefixes each inclusion criterion with "Verify: "', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'eligibility_verification').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.map((f) => f.derived_text)).toEqual([
        'Verify: Age >= 18 years',
        'Verify: Diagnosis of schizophrenia',
      ]);
    });

    it('emits nothing when no inclusion criteria were extracted', () => {
      const blocks = selectMonitoringChecklistBlocks(input([]));
      expect(blocksIn(blocks, 'eligibility_verification')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T5 — Section 2: exclusions + prohibited-med facts + the zero-med gap fallback
  // ---------------------------------------------------------------------------
  describe('exclusion_prohibited_med_review', () => {
    const GAP_TEXT =
      'No prohibited-medication list was extracted from this protocol. Review the ' +
      'concomitant/prohibited medication section of the protocol manually and ' +
      'verify medication-history cross-checks at the site.';

    const medItems: SelectionSourceItem[] = [
      item({
        id: 'med-1',
        field_type: 'prohibited_med',
        field_path: 'prohibited_medications[0]',
        extracted_value: 'Strong CYP3A4 inhibitors',
        primary_evidence: evidence(
          'ev-med-1',
          'Strong CYP3A4 inhibitors are prohibited within 14 days of dosing',
          12,
          'Section 4.3 Concomitant Medications',
        ),
      }),
      item({
        id: 'med-2',
        field_type: 'prohibited_med',
        field_path: 'prohibited_medications[1]',
        extracted_value: 'Warfarin',
        confidence_state: 'medium',
        primary_evidence: evidence('ev-med-2', 'Warfarin use is not permitted', 12, 'Section 4.3'),
      }),
    ];

    it('prefixes each exclusion criterion with "Confirm absence of: "', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const fact = blocks.find((b) => b.extracted_item_id === 'exc-1');
      expect(fact?.derived_text).toBe('Confirm absence of: Pregnancy or breastfeeding');
    });

    it('appends the coverage-gap framing block after the exclusion facts when no prohibited_med facts exist', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      const gap = section[section.length - 1];
      expect(gap.derived_text).toBe(GAP_TEXT);
      expect(gap.content_origin).toBe('derived_operational_framing');
      expect(gap.block_type).toBe('checklist_item');
      expect(gap.extracted_item_id).toBeNull();
      expect(gap.confidence_state).toBeNull();
    });

    it('emits the gap block even when zero exclusion criteria were extracted', () => {
      const blocks = selectMonitoringChecklistBlocks(input([]));
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      expect(section).toHaveLength(2); // intro + gap, no facts
      expect(section.some((b) => b.derived_text === GAP_TEXT)).toBe(true);
      expect(section.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
    });

    it('emits one checklist_item per prohibited medication with the exact prose and evidence passthrough', () => {
      const blocks = selectMonitoringChecklistBlocks(input(medItems));
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      expect(section).toHaveLength(3); // intro + 2 med facts, no gap

      const med1 = section[1];
      expect(med1.derived_text).toBe(
        'Confirm absence of prohibited medication: Strong CYP3A4 inhibitors — ' +
        "cross-check the participant's medication history.",
      );
      expect(med1.content_origin).toBe('protocol_fact');
      expect(med1.block_type).toBe('checklist_item');
      expect(med1.extracted_item_id).toBe('med-1');
      expect(med1.source_evidence_id).toBe('ev-med-1');
      expect(med1.source_quote).toBe(
        'Strong CYP3A4 inhibitors are prohibited within 14 days of dosing',
      );
      expect(med1.source_page_number).toBe(12);
      expect(med1.source_section).toBe('Section 4.3 Concomitant Medications');
      expect(med1.confidence_state).toBe('high');

      const med2 = section[2];
      expect(med2.derived_text).toBe(
        "Confirm absence of prohibited medication: Warfarin — cross-check the participant's medication history.",
      );
      expect(med2.extracted_item_id).toBe('med-2');
      expect(med2.confidence_state).toBe('medium');
    });

    it('suppresses the coverage-gap block when any prohibited_med fact exists', () => {
      const blocks = selectMonitoringChecklistBlocks(input(medItems));
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      expect(section.some((b) => b.derived_text === GAP_TEXT)).toBe(false);
    });

    it('orders the section intro → exclusion facts → medication facts, and nothing else', () => {
      // Meds deliberately interleaved before/after the exclusion in input order.
      const blocks = selectMonitoringChecklistBlocks(
        input([
          medItems[0],
          item({
            id: 'exc-a',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: 'Pregnancy or breastfeeding',
          }),
          medItems[1],
        ]),
      );
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      expect(section.map((b) => b.block_type)).toEqual([
        'section_intro', 'checklist_item', 'checklist_item', 'checklist_item',
      ]);
      expect(section.map((b) => b.extracted_item_id)).toEqual([null, 'exc-a', 'med-1', 'med-2']);
      expect(section.some((b) => b.derived_text === GAP_TEXT)).toBe(false);
    });

    it('degrades a prohibited_med fact with null item confidence to needs_review', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'med-nc',
            field_type: 'prohibited_med',
            field_path: 'prohibited_medications[0]',
            extracted_value: 'Systemic corticosteroids',
            confidence_state: null,
          }),
        ]),
      );
      const fact = blocks.find((b) => b.extracted_item_id === 'med-nc');
      expect(fact?.confidence_state).toBe('needs_review');
    });

    it('skips malformed prohibited_med values without throwing and falls back to the gap block', () => {
      const badMeds: SelectionSourceItem[] = [
        item({ id: 'med-bad-1', field_type: 'prohibited_med', field_path: 'prohibited_medications[0]', extracted_value: null }),
        item({ id: 'med-bad-2', field_type: 'prohibited_med', field_path: 'prohibited_medications[1]', extracted_value: 42 }),
        item({ id: 'med-bad-3', field_type: 'prohibited_med', field_path: 'prohibited_medications[2]', extracted_value: '   ' }),
        item({ id: 'med-bad-4', field_type: 'prohibited_med', field_path: 'prohibited_medications[3]', extracted_value: { unexpected: 'object' } }),
      ];
      expect(() => selectMonitoringChecklistBlocks(input(badMeds))).not.toThrow();
      const section = blocksIn(
        selectMonitoringChecklistBlocks(input(badMeds)),
        'exclusion_prohibited_med_review',
      );
      expect(section).toHaveLength(2); // intro + gap — no usable meds
      expect(section.some((b) => b.derived_text === GAP_TEXT)).toBe(true);
      expect(section.every((b) => b.extracted_item_id === null)).toBe(true);
    });

    it('keeps usable medications when sibling values are malformed (no gap block)', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({ id: 'med-bad', field_type: 'prohibited_med', field_path: 'prohibited_medications[0]', extracted_value: null }),
          medItems[1],
        ]),
      );
      const section = blocksIn(blocks, 'exclusion_prohibited_med_review');
      expect(section).toHaveLength(2); // intro + the one usable med
      expect(section[1].extracted_item_id).toBe('med-2');
      expect(section.some((b) => b.derived_text === GAP_TEXT)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // T6 — Section 3: visit window prose
  // ---------------------------------------------------------------------------
  describe('visit_window_verification', () => {
    it('renders windowed visits as "study day N (window −X/+Y days)"', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-1' && b.section_key === 'visit_window_verification',
      );
      expect(fact?.derived_text).toBe(
        'Verify Visit 2 occurred on study day 14 (window −3/+3 days) and that ' +
        'any out-of-window visits are documented with a deviation.',
      );
    });

    it('renders 0/0 windows as "no window — exact day"', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-2' && b.section_key === 'visit_window_verification',
      );
      expect(fact?.derived_text).toBe(
        'Verify Screening occurred on study day -14 (no window — exact day) and ' +
        'that any out-of-window visits are documented with a deviation.',
      );
    });

    it('falls back to "its scheduled study day" when study_day is missing', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'vis-noday',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: { visit_name: 'Unscheduled Visit', procedures: [] },
          }),
        ]),
      );
      const fact = blocks.find((b) => b.extracted_item_id === 'vis-noday');
      expect(fact?.derived_text).toBe(
        'Verify Unscheduled Visit occurred on its scheduled study day (no window ' +
        '— exact day) and that any out-of-window visits are documented with a deviation.',
      );
    });

    it('emits nothing when no visits were extracted', () => {
      const blocks = selectMonitoringChecklistBlocks(input([]));
      expect(blocksIn(blocks, 'visit_window_verification')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T7 — Section 4: primary vs secondary endpoint prefixing
  // ---------------------------------------------------------------------------
  describe('endpoint_critical_checks', () => {
    it('prefixes primary_endpoints items with "PRIMARY ENDPOINT — "', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const fact = blocks.find((b) => b.extracted_item_id === 'ep-1');
      expect(fact?.derived_text).toBe(
        'PRIMARY ENDPOINT — verify source data completeness for: Change in PANSS score at week 24',
      );
    });

    it('prefixes non-primary endpoints with "Secondary endpoint — "', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const fact = blocks.find((b) => b.extracted_item_id === 'ep-2');
      expect(fact?.derived_text).toBe(
        'Secondary endpoint — verify source data completeness for: Response rate at week 12',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T8 — Section 5: cohorts (framing-only; section absent when none)
  // ---------------------------------------------------------------------------
  describe('arm_cohort_randomization_deps', () => {
    it('emits the section only when cohorts exist', () => {
      const blocks = selectMonitoringChecklistBlocks(input([], []));
      expect(blocksIn(blocks, 'arm_cohort_randomization_deps')).toHaveLength(0);
    });

    it('renders cohort blocks as framing (no evidence row exists for cohorts)', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'arm_cohort_randomization_deps');
      expect(section.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
    });

    it('includes dose regimen and description when present', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const texts = blocksIn(blocks, 'arm_cohort_randomization_deps').map((b) => b.derived_text);
      expect(texts).toContain(
        'Cohort S1: 10 mg QD — verify participants are assigned per protocol and ' +
        'dosing matches the cohort. Description: Single ascending dose',
      );
    });

    it('falls back to "dose per protocol" and omits the description sentence when null', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const texts = blocksIn(blocks, 'arm_cohort_randomization_deps').map((b) => b.derived_text);
      expect(texts).toContain(
        'Cohort MAD: dose per protocol — verify participants are assigned per ' +
        'protocol and dosing matches the cohort.',
      );
    });

    it('always closes the section with the randomization-mechanics framing block', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'arm_cohort_randomization_deps');
      expect(section[section.length - 1].derived_text).toBe(
        'Randomization mechanics are not extracted by PIQC — verify assignment ' +
        "procedures against the protocol's randomization section.",
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T9 — Section 6: safety/specimen/imaging/vendor heuristic
  // ---------------------------------------------------------------------------
  describe('safety_specimen_imaging_vendor_checks', () => {
    it('emits one fact per matched visit-procedure pair with forced low confidence', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'safety_specimen_imaging_vendor_checks');
      expect(section).toHaveLength(3);
      for (const block of section) {
        expect(block.content_origin).toBe('protocol_fact');
        // Heuristic keyword match — forced low even though the visit items are 'high'.
        expect(block.confidence_state).toBe('low');
      }
      expect(section.map((b) => b.derived_text)).toEqual([
        "Confirm handling/documentation for 'Blood draw' (Visit 2) — specimen workflow.",
        "Confirm handling/documentation for 'ECG (12-lead)' (Visit 2) — imaging workflow.",
        "Confirm handling/documentation for 'Serum chemistry' (Screening) — specimen workflow.",
      ]);
    });

    it('dedupes identical procedure strings across visits — first visit wins', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const bloodDrawBlocks = blocksIn(blocks, 'safety_specimen_imaging_vendor_checks').filter(
        (b) => b.derived_text.includes("'Blood draw'"),
      );
      expect(bloodDrawBlocks).toHaveLength(1);
      expect(bloodDrawBlocks[0].derived_text).toContain('(Visit 2)');
      // Evidence passthrough comes from the winning (first) visit item.
      expect(bloodDrawBlocks[0].extracted_item_id).toBe('vis-1');
      expect(bloodDrawBlocks[0].source_evidence_id).toBe('ev-vis-1');
    });

    it('classifies vendor keywords ahead of specimen ("central lab" is not "lab")', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'vis-vendor',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit 3',
              study_day: 28,
              window_minus_days: 2,
              window_plus_days: 2,
              procedures: ['Central lab sample shipment', 'MRI brain', 'Urine collection'],
            },
          }),
        ]),
      );
      const texts = blocksIn(blocks, 'safety_specimen_imaging_vendor_checks').map(
        (b) => b.derived_text,
      );
      expect(texts).toEqual([
        "Confirm handling/documentation for 'Central lab sample shipment' (Visit 3) — vendor workflow.",
        "Confirm handling/documentation for 'MRI brain' (Visit 3) — imaging workflow.",
        "Confirm handling/documentation for 'Urine collection' (Visit 3) — specimen workflow.",
      ]);
    });

    it('emits a single framing fallback block when no procedures match', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'vis-plain',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit 1',
              study_day: 1,
              window_minus_days: 0,
              window_plus_days: 0,
              procedures: ['Vital signs', 'Physical examination'],
            },
          }),
        ]),
      );
      const section = blocksIn(blocks, 'safety_specimen_imaging_vendor_checks');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].confidence_state).toBeNull();
      expect(section[0].derived_text).toContain('No laboratory, imaging, or vendor-dependent procedures');
    });
  });

  // ---------------------------------------------------------------------------
  // T10 — Section 7: source-doc focus conditionals
  // ---------------------------------------------------------------------------
  describe('source_doc_focus', () => {
    it('emits the primary-endpoint focus block only when a primary endpoint exists', () => {
      const withPrimary = selectMonitoringChecklistBlocks(fullProtocolInput());
      expect(
        blocksIn(withPrimary, 'source_doc_focus').some((b) =>
          b.derived_text.startsWith('Prioritize source verification for primary-endpoint'),
        ),
      ).toBe(true);

      const secondaryOnly = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'ep-sec',
            field_type: 'endpoint',
            field_path: 'secondary_endpoints[0]',
            extracted_value: 'Response rate at week 12',
          }),
        ]),
      );
      expect(
        blocksIn(secondaryOnly, 'source_doc_focus').some((b) =>
          b.derived_text.startsWith('Prioritize source verification'),
        ),
      ).toBe(false);
    });

    it('emits the safety-assessment block only when section 6 produced fact blocks', () => {
      const withSafety = selectMonitoringChecklistBlocks(fullProtocolInput());
      expect(
        blocksIn(withSafety, 'source_doc_focus').some((b) =>
          b.derived_text.startsWith('Confirm safety assessments'),
        ),
      ).toBe(true);

      const noSafety = selectMonitoringChecklistBlocks(input([]));
      expect(
        blocksIn(noSafety, 'source_doc_focus').some((b) =>
          b.derived_text.startsWith('Confirm safety assessments'),
        ),
      ).toBe(false);
      // The section intro still frames the section.
      expect(blocksIn(noSafety, 'source_doc_focus')).toHaveLength(1);
      expect(blocksIn(noSafety, 'source_doc_focus')[0].block_type).toBe('section_intro');
    });
  });

  // ---------------------------------------------------------------------------
  // T11 — Section 8: amendment present / absent branches
  // ---------------------------------------------------------------------------
  describe('amendment_sensitive', () => {
    it('emits intro + a fact with evidence passthrough when an amendment exists', () => {
      const blocks = selectMonitoringChecklistBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'amendment_sensitive');
      expect(section).toHaveLength(2);
      expect(section[0].block_type).toBe('section_intro');

      const fact = section[1];
      expect(fact.content_origin).toBe('protocol_fact');
      expect(fact.extracted_item_id).toBe('amd-1');
      expect(fact.source_evidence_id).toBe('ev-amd-1');
      expect(fact.source_quote).toBe('Amendment 2: dosing frequency reduced');
      expect(fact.derived_text).toBe(
        'Amendment noted: Dosing frequency reduced in Amendment 2. Verify affected ' +
        'requirements below are executed per the CURRENT version.',
      );
    });

    it('emits a single framing block when no amendment was detected', () => {
      const blocks = selectMonitoringChecklistBlocks(input([]));
      const section = blocksIn(blocks, 'amendment_sensitive');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].derived_text).toBe(
        'No amendment was detected in this protocol version. Confirm with the ' +
        'sponsor that you hold the current version.',
      );
    });

    it('treats an empty-string amendment_summary as no amendment', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'amd-empty',
            field_type: 'metadata',
            field_path: 'amendment_summary',
            extracted_value: '   ',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitive');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
    });

    it('does not treat other metadata field_paths as amendments', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'meta-ver',
            field_type: 'metadata',
            field_path: 'protocol_version',
            extracted_value: 'v3.0',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitive');
      expect(section).toHaveLength(1);
      expect(section[0].derived_text).toContain('No amendment was detected');
    });
  });

  // ---------------------------------------------------------------------------
  // T12 — Section 9: templated site questions
  // ---------------------------------------------------------------------------
  describe('site_questions', () => {
    it('always emits exactly 3 framing site_question blocks', () => {
      for (const testInput of [fullProtocolInput(), input([])]) {
        const section = blocksIn(selectMonitoringChecklistBlocks(testInput), 'site_questions');
        expect(section).toHaveLength(3);
        for (const block of section) {
          expect(block.block_type).toBe('site_question');
          expect(block.content_origin).toBe('derived_operational_framing');
        }
      }
    });

    it('covers staffing, investigator oversight, and enrollment patterns', () => {
      const texts = blocksIn(
        selectMonitoringChecklistBlocks(input([])),
        'site_questions',
      ).map((b) => b.derived_text);
      expect(texts[0]).toContain('staffing changes');
      expect(texts[1]).toContain('investigator oversight');
      expect(texts[2]).toContain('screening-failure');
    });
  });

  // ---------------------------------------------------------------------------
  // T13 — Empty input: only the always-emit sections, all framing
  // ---------------------------------------------------------------------------
  describe('empty input', () => {
    it('emits only framing blocks from the always-emit sections', () => {
      const blocks = selectMonitoringChecklistBlocks(input([], [], null));
      // 2 (exclusion intro+gap) + 1 (safety fallback) + 1 (source-doc intro)
      // + 1 (no amendment) + 3 (site questions) = 8
      expect(blocks).toHaveLength(8);
      expect(blocks.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });
  });

  // ---------------------------------------------------------------------------
  // T14 — Malformed extracted_value: skip, never throw
  // ---------------------------------------------------------------------------
  describe('malformed input guards', () => {
    const malformed: SelectionSourceItem[] = [
      item({ id: 'bad-1', field_type: 'inclusion_criterion', field_path: 'key_inclusion_criteria[0]', extracted_value: null }),
      item({ id: 'bad-2', field_type: 'inclusion_criterion', field_path: 'key_inclusion_criteria[1]', extracted_value: 42 }),
      item({ id: 'bad-3', field_type: 'inclusion_criterion', field_path: 'key_inclusion_criteria[2]', extracted_value: '   ' }),
      item({ id: 'bad-4', field_type: 'exclusion_criterion', field_path: 'key_exclusion_criteria[0]', extracted_value: { unexpected: 'object' } }),
      item({ id: 'bad-5', field_type: 'visit', field_path: 'schedule_of_events[0]', extracted_value: 'not-an-object' }),
      item({ id: 'bad-6', field_type: 'visit', field_path: 'schedule_of_events[1]', extracted_value: { study_day: 14 } }), // no visit_name
      item({ id: 'bad-7', field_type: 'visit', field_path: 'schedule_of_events[2]', extracted_value: ['array', 'not', 'object'] }),
      item({ id: 'bad-8', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: undefined }),
      item({ id: 'bad-11', field_type: 'prohibited_med', field_path: 'prohibited_medications[0]', extracted_value: { med: 'object' } }),
      item({ id: 'bad-9', field_type: 'metadata', field_path: 'amendment_summary', extracted_value: { nested: true } }),
      item({ id: 'bad-10', field_type: 'unknown_future_type', field_path: 'whatever', extracted_value: 'text' }),
    ];

    it('does not throw on malformed values and emits no fact blocks for them', () => {
      expect(() => selectMonitoringChecklistBlocks(input(malformed))).not.toThrow();
      const blocks = selectMonitoringChecklistBlocks(input(malformed));
      expect(blocks.every((b) => b.extracted_item_id === null)).toBe(true);
    });

    it('degrades a non-array procedures field to no safety matches', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([
          item({
            id: 'vis-badproc',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit 4',
              study_day: 56,
              window_minus_days: 3,
              window_plus_days: 3,
              procedures: 'blood draw', // not an array
            },
          }),
        ]),
      );
      // The visit still produces its window fact...
      expect(blocksIn(blocks, 'visit_window_verification')).toHaveLength(2);
      // ...but section 6 sees no procedures → fallback framing block.
      const safety = blocksIn(blocks, 'safety_specimen_imaging_vendor_checks');
      expect(safety).toHaveLength(1);
      expect(safety[0].content_origin).toBe('derived_operational_framing');
    });

    it('skips cohorts with blank labels but keeps usable ones', () => {
      const blocks = selectMonitoringChecklistBlocks(
        input([], [
          { label: '   ', dose_regimen: '5 mg', description: null },
          { label: 'B', dose_regimen: null, description: null },
        ]),
      );
      const section = blocksIn(blocks, 'arm_cohort_randomization_deps');
      // intro + 1 usable cohort + randomization block
      expect(section).toHaveLength(3);
      expect(section.some((b) => b.derived_text.startsWith('Cohort B:'))).toBe(true);
    });
  });
});
