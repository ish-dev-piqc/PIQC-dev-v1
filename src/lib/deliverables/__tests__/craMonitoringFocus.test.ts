import { describe, it, expect } from 'vitest';
import {
  selectCraMonitoringFocusBlocks,
  type CraFocusBlockSpec,
} from '../selection/craMonitoringFocus';
import type { SelectionInput, SelectionSourceItem } from '../selection/monitoringChecklist';
import { CRA_FOCUS_SECTION_ORDER } from '../../../types/deliverables';

// -----------------------------------------------------------------------------
// Fixture builders (mirrors riskOverview.test.ts / monitoringChecklist.test.ts)
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

function blocksIn(blocks: CraFocusBlockSpec[], sectionKey: string): CraFocusBlockSpec[] {
  return blocks.filter((b) => b.section_key === sectionKey);
}

/** The handover doctrine pattern: no "N/M", "N out of M", or the word 'score'
 *  may ever appear in generated prose. */
const NO_SCORE_PATTERN = /\b\d+(\.\d+)?\s*(\/|out of)\s*\d+|score/i;

/** > 220 chars, deliberately free of conditional keywords (if / unless /
 *  except / prior / history of / within) and of the word 'score'. */
const LONG_CRITERION =
  'Participants must demonstrate adequate hematologic, hepatic, and renal function as defined ' +
  'by laboratory values collected at screening, and must agree to use protocol-specified ' +
  'contraception methods for the full duration of study participation and the follow-up period.';

/**
 * A protocol exercising every section: 4 usable criteria (2 flagged — one
 * conditional-keyword, one lengthy; 2 unflagged), 2 prohibited medications,
 * 3 visits (one 0/0 exact-day with specimen+imaging matches, one ±1 with a
 * vendor match and an overlapping procedure for dedupe, one ±3 that must NOT
 * flag), primary + secondary endpoints, an amendment summary, non-selected
 * items (dosing, protocol_version metadata), and a cohort the focus lens
 * ignores.
 */
function fullProtocolInput(): SelectionInput {
  return input(
    [
      item({
        id: 'inc-1',
        field_type: 'inclusion_criterion',
        field_path: 'key_inclusion_criteria[0]',
        extracted_value: 'Age between 18 and 65 years, inclusive',
        primary_evidence: evidence('ev-inc-1', 'Aged 18 to 65 years', 10, 'Section 4.1 Inclusion Criteria'),
      }),
      item({
        id: 'inc-2',
        field_type: 'inclusion_criterion',
        field_path: 'key_inclusion_criteria[1]',
        extracted_value: 'Documented diagnosis within the past 5 years',
        confidence_state: 'medium',
        primary_evidence: evidence('ev-inc-2', 'Diagnosis documented within 5 years', 10, 'Section 4.1'),
      }),
      item({
        id: 'exc-1',
        field_type: 'exclusion_criterion',
        field_path: 'key_exclusion_criteria[0]',
        extracted_value: LONG_CRITERION,
        primary_evidence: evidence('ev-exc-1', 'Adequate organ function required', 11, 'Section 4.2 Exclusion Criteria'),
      }),
      item({
        id: 'exc-2',
        field_type: 'exclusion_criterion',
        field_path: 'key_exclusion_criteria[1]',
        extracted_value: 'Pregnancy or breastfeeding',
        primary_evidence: evidence('ev-exc-2', 'Pregnant or breastfeeding women are excluded', 11, 'Section 4.2'),
      }),
      item({
        id: 'med-1',
        field_type: 'prohibited_med',
        field_path: 'prohibited_medications[0]',
        extracted_value: 'Warfarin',
        primary_evidence: evidence('ev-med-1', 'Warfarin is prohibited during the study', 12, 'Section 5.3 Prohibited Medications'),
      }),
      item({
        id: 'med-2',
        field_type: 'prohibited_med',
        field_path: 'prohibited_medications[1]',
        extracted_value: 'Strong CYP3A4 inhibitors',
        confidence_state: 'medium',
        primary_evidence: evidence('ev-med-2', 'Strong CYP3A4 inhibitors must be avoided', 12, 'Section 5.3'),
      }),
      item({
        id: 'vis-1',
        field_type: 'visit',
        field_path: 'schedule_of_events[0]',
        extracted_value: {
          visit_name: 'Baseline',
          study_day: 1,
          window_minus_days: 0,
          window_plus_days: 0,
          // 'Blood draw' (specimen) + 'ECG (12-lead)' (imaging) match the
          // workflow taxonomy; the rest must not.
          procedures: [
            'Blood draw',
            'Vital signs',
            'ECG (12-lead)',
            'Physical examination',
            'Randomization',
            'Dosing administration',
            'Questionnaire battery',
            'Adverse event review',
          ],
        },
        primary_evidence: evidence('ev-vis-1', 'Baseline (Day 1, no window)', 20, 'Section 6.1'),
      }),
      item({
        id: 'vis-2',
        field_type: 'visit',
        field_path: 'schedule_of_events[1]',
        extracted_value: {
          visit_name: 'Week 4',
          study_day: 28,
          window_minus_days: 1,
          window_plus_days: 1,
          // 'Blood draw' repeats from Baseline → must dedupe (first visit wins).
          procedures: ['Central lab sample shipment', 'Blood draw'],
        },
        primary_evidence: evidence('ev-vis-2', 'Week 4 (Day 28, one day either side)', 22, 'Section 6.3'),
      }),
      item({
        id: 'vis-3',
        field_type: 'visit',
        field_path: 'schedule_of_events[2]',
        extracted_value: {
          visit_name: 'Week 12',
          study_day: 84,
          window_minus_days: 3,
          window_plus_days: 3,
          procedures: ['Vital signs'],
        },
        primary_evidence: evidence('ev-vis-3', 'Week 12 (Day 84, three days either side)', 23, 'Section 6.4'),
      }),
      item({
        id: 'ep-1',
        field_type: 'endpoint',
        field_path: 'primary_endpoints[0]',
        extracted_value: 'Change in PANSS total at week 24',
        primary_evidence: evidence('ev-ep-1', 'Primary endpoint: PANSS total change', 5, 'Section 2.1'),
      }),
      item({
        id: 'ep-2',
        field_type: 'endpoint',
        field_path: 'secondary_endpoints[0]',
        extracted_value: 'Overall response rate at week 12',
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
    [{ label: 'S1', dose_regimen: '10 mg QD', description: 'Single ascending dose' }],
  );
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe('selectCraMonitoringFocusBlocks', () => {
  // ---------------------------------------------------------------------------
  // T1 — Full protocol: section grouping, counts, global ordering
  // ---------------------------------------------------------------------------
  describe('full-protocol fixture', () => {
    const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());

    it('emits all five sections in CRA_FOCUS_SECTION_ORDER', () => {
      const sectionSequence: string[] = [];
      for (const block of blocks) {
        if (sectionSequence[sectionSequence.length - 1] !== block.section_key) {
          sectionSequence.push(block.section_key);
        }
      }
      expect(sectionSequence).toEqual([...CRA_FOCUS_SECTION_ORDER]);
    });

    it('emits the expected block count per section', () => {
      expect(blocksIn(blocks, 'eligibility_verification_emphasis')).toHaveLength(5); // intro + 2 flagged + 2 meds
      expect(blocksIn(blocks, 'fragile_visit_windows')).toHaveLength(3);             // intro + 2 fragile visits
      expect(blocksIn(blocks, 'endpoint_critical_verification')).toHaveLength(2);    // intro + 1 primary
      expect(blocksIn(blocks, 'vendor_specimen_workflows')).toHaveLength(4);         // intro + 3 unique matches
      expect(blocksIn(blocks, 'amendment_sensitive_requirements')).toHaveLength(2);  // intro + fact
      expect(blocks).toHaveLength(16);
    });

    it('assigns a contiguous, globally increasing sort_order starting at 0', () => {
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });

    it('opens every emitted section with a section_intro framing block', () => {
      for (const sectionKey of CRA_FOCUS_SECTION_ORDER) {
        const first = blocksIn(blocks, sectionKey)[0];
        expect(first.block_type).toBe('section_intro');
        expect(first.content_origin).toBe('derived_operational_framing');
      }
    });

    it('does not select unflagged criteria, wide-window visits, secondary endpoints, dosing, or non-amendment metadata', () => {
      const referencedIds = blocks.map((b) => b.extracted_item_id);
      expect(referencedIds).not.toContain('inc-1');  // simple short criterion
      expect(referencedIds).not.toContain('exc-2');  // simple short criterion
      expect(referencedIds).not.toContain('ep-2');   // secondary endpoint
      expect(referencedIds).not.toContain('dos-1');
      expect(referencedIds).not.toContain('meta-1');
      // vis-3 (±3 window, 1 plain procedure) appears in NO section.
      expect(referencedIds).not.toContain('vis-3');
    });

    it('is deterministic — same input yields identical output', () => {
      expect(selectCraMonitoringFocusBlocks(fullProtocolInput())).toEqual(blocks);
    });

    it('ignores cohorts — output is identical with and without them', () => {
      const base = fullProtocolInput();
      const withoutCohorts: SelectionInput = { ...base, cohorts: [] };
      expect(selectCraMonitoringFocusBlocks(withoutCohorts)).toEqual(blocks);
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Content-origin discipline (the 3-way taxonomy, never blurred)
  // ---------------------------------------------------------------------------
  describe('content_origin discipline', () => {
    const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());

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
      const result = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'med-nc',
            field_type: 'prohibited_med',
            field_path: 'prohibited_medications[0]',
            extracted_value: 'St. John’s Wort',
            confidence_state: null,
          }),
        ]),
      );
      const fact = result.find((b) => b.extracted_item_id === 'med-nc');
      expect(fact?.confidence_state).toBe('needs_review');
    });
  });

  // ---------------------------------------------------------------------------
  // T3 — Evidence passthrough onto fact blocks
  // ---------------------------------------------------------------------------
  describe('evidence passthrough', () => {
    const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());

    it('copies quote, page, and section from the primary evidence onto the block', () => {
      const fact = blocks.find((b) => b.extracted_item_id === 'med-1');
      expect(fact).toBeDefined();
      expect(fact?.source_evidence_id).toBe('ev-med-1');
      expect(fact?.source_quote).toBe('Warfarin is prohibited during the study');
      expect(fact?.source_page_number).toBe(12);
      expect(fact?.source_section).toBe('Section 5.3 Prohibited Medications');
    });

    it('carries the item confidence through unchanged (non-heuristic sections)', () => {
      const criterionFact = blocks.find((b) => b.extracted_item_id === 'inc-2');
      expect(criterionFact?.confidence_state).toBe('medium');
      const medFact = blocks.find((b) => b.extracted_item_id === 'med-2');
      expect(medFact?.confidence_state).toBe('medium');
    });

    it('emits a fact with null evidence fields when the item has no primary evidence', () => {
      const result = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'med-noev',
            field_type: 'prohibited_med',
            field_path: 'prohibited_medications[0]',
            extracted_value: 'Systemic corticosteroids',
            primary_evidence: null,
          }),
        ]),
      );
      const fact = result.find((b) => b.extracted_item_id === 'med-noev');
      expect(fact).toBeDefined();
      expect(fact?.source_evidence_id).toBeNull();
      expect(fact?.source_quote).toBeNull();
      expect(fact?.source_page_number).toBeNull();
      expect(fact?.source_section).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // T4 — Section 1: eligibility verification emphasis (criteria + meds)
  // ---------------------------------------------------------------------------
  describe('eligibility_verification_emphasis', () => {
    it('the length fixture really is longer than the 220-char threshold', () => {
      expect(LONG_CRITERION.length).toBeGreaterThan(220);
    });

    it('names the reason per flagged criterion, then one card per prohibited medication', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'eligibility_verification_emphasis').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.map((f) => f.derived_text)).toEqual([
        'Prioritize eligibility verification — conditional logic: Documented diagnosis within the past 5 years',
        `Prioritize eligibility verification — lengthy criterion: ${LONG_CRITERION}`,
        'Prioritize medication-history review: Warfarin is restricted by the protocol.',
        'Prioritize medication-history review: Strong CYP3A4 inhibitors is restricted by the protocol.',
      ]);
    });

    it('states the combined criteria + medication counts in the section intro', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const intro = blocksIn(blocks, 'eligibility_verification_emphasis')[0];
      expect(intro.derived_text).toContain(
        'PIQC identified 2 complex eligibility criteria and 2 protocol-restricted medications',
      );
    });

    it('emits the section for prohibited meds alone, with a meds-only intro count', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'med-only',
            field_type: 'prohibited_med',
            field_path: 'prohibited_medications[0]',
            extracted_value: 'Warfarin',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'eligibility_verification_emphasis');
      expect(section).toHaveLength(2); // intro + 1 med card
      expect(section[0].derived_text).toContain('1 protocol-restricted medication');
      expect(section[0].derived_text).not.toContain('complex eligibility');
      expect(section[1].derived_text).toBe(
        'Prioritize medication-history review: Warfarin is restricted by the protocol.',
      );
    });

    it('emits a criteria-only intro count when no prohibited meds exist', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'inc-cond',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Documented diagnosis within the past 5 years',
          }),
        ]),
      );
      const intro = blocksIn(blocks, 'eligibility_verification_emphasis')[0];
      expect(intro.derived_text).toContain('1 complex eligibility criterion');
      expect(intro.derived_text).not.toContain('protocol-restricted');
    });

    it('matches conditional keywords case-insensitively', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'exc-hist',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: 'HISTORY OF malignancy requiring systemic treatment',
          }),
        ]),
      );
      const fact = blocksIn(blocks, 'eligibility_verification_emphasis').find(
        (b) => b.extracted_item_id === 'exc-hist',
      );
      expect(fact?.derived_text).toContain('conditional logic');
    });

    it('requires word boundaries — "if" inside "Specific" does not flag', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'inc-spec',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Specific laboratory values are required at enrollment',
          }),
        ]),
      );
      expect(blocksIn(blocks, 'eligibility_verification_emphasis')).toHaveLength(0);
    });

    it('names conditional logic as the reason when a criterion is both conditional AND lengthy', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'exc-both',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: `${LONG_CRITERION} This does not apply unless the sponsor agrees in writing.`,
          }),
        ]),
      );
      const fact = blocksIn(blocks, 'eligibility_verification_emphasis').find(
        (b) => b.extracted_item_id === 'exc-both',
      );
      expect(fact?.derived_text).toContain('Prioritize eligibility verification — conditional logic:');
    });

    it('flags strictly above 220 chars and not at exactly 220 (threshold boundary)', () => {
      const at220 = 'x'.repeat(220);
      const at221 = 'y'.repeat(221);
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'inc-220',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: at220,
          }),
          item({
            id: 'inc-221',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[1]',
            extracted_value: at221,
          }),
        ]),
      );
      const section = blocksIn(blocks, 'eligibility_verification_emphasis');
      expect(section).toHaveLength(2); // intro + the 221-char criterion only
      expect(section[1].extracted_item_id).toBe('inc-221');
      expect(section[1].derived_text).toContain('lengthy criterion');
    });

    it('emits no section when no criterion is flagged and no meds exist', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'inc-plain',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Age between 18 and 65 years, inclusive',
          }),
          item({
            id: 'exc-plain',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: 'Pregnancy or breastfeeding',
          }),
        ]),
      );
      expect(blocksIn(blocks, 'eligibility_verification_emphasis')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T5 — Section 2: fragile visit windows
  // ---------------------------------------------------------------------------
  describe('fragile_visit_windows', () => {
    it('renders 0/0 visits as exact-date verification plans', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-1' && b.section_key === 'fragile_visit_windows',
      );
      expect(fact?.derived_text).toBe(
        'Plan on-site window verification — Baseline (study day 1): the protocol allows no ' +
        'scheduling window — confirm the exact visit date against source records.',
      );
    });

    it('states the ±window for fragile non-exact visits', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-2' && b.section_key === 'fragile_visit_windows',
      );
      expect(fact?.derived_text).toBe(
        'Plan on-site window verification — Week 4 (study day 28): window −1/+1 days — confirm ' +
        'each occurrence fell inside this tolerance.',
      );
    });

    it('states the fragile-visit count in the section intro', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const intro = blocksIn(blocks, 'fragile_visit_windows')[0];
      expect(intro.derived_text).toContain('PIQC identified 2 visits with a fragile scheduling window');
    });

    it('includes a total window of exactly 2 days and excludes 3 (threshold boundary)', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'vis-a',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit A', study_day: 7,
              window_minus_days: 2, window_plus_days: 0, procedures: [],
            },
          }),
          item({
            id: 'vis-b',
            field_type: 'visit',
            field_path: 'schedule_of_events[1]',
            extracted_value: {
              visit_name: 'Visit B', study_day: 14,
              window_minus_days: 2, window_plus_days: 1, procedures: [],
            },
          }),
        ]),
      );
      const section = blocksIn(blocks, 'fragile_visit_windows');
      expect(section).toHaveLength(2); // intro + Visit A only
      expect(section[1].extracted_item_id).toBe('vis-a');
      expect(section[1].derived_text).toContain('window −2/+0 days');
    });

    it('falls back to "its scheduled study day" when study_day is missing', () => {
      const blocks = selectCraMonitoringFocusBlocks(
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
      expect(fact?.derived_text).toContain('Unscheduled Visit (its scheduled study day)');
    });

    it('emits no section when every visit has a wide window', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'vis-wide',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Week 24', study_day: 168,
              window_minus_days: 7, window_plus_days: 7, procedures: [],
            },
          }),
        ]),
      );
      expect(blocksIn(blocks, 'fragile_visit_windows')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T6 — Section 3: primary endpoints only
  // ---------------------------------------------------------------------------
  describe('endpoint_critical_verification', () => {
    it('emits a verification-priority card per PRIMARY endpoint', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const fact = blocks.find((b) => b.extracted_item_id === 'ep-1');
      expect(fact?.section_key).toBe('endpoint_critical_verification');
      expect(fact?.derived_text).toBe(
        'Prioritize source-data verification for the primary endpoint: Change in PANSS total at week 24',
      );
    });

    it('emits no section when only secondary endpoints exist', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'ep-sec',
            field_type: 'endpoint',
            field_path: 'secondary_endpoints[0]',
            extracted_value: 'Overall response rate at week 12',
          }),
        ]),
      );
      expect(blocksIn(blocks, 'endpoint_critical_verification')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T7 — Section 4: vendor/specimen workflow heuristic
  // ---------------------------------------------------------------------------
  describe('vendor_specimen_workflows', () => {
    it('names the workflow category and visit, one card per unique match', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'vendor_specimen_workflows').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.map((f) => f.derived_text)).toEqual([
        "Confirm on-site: 'Blood draw' (Baseline) — specimen workflow warrants direct verification.",
        "Confirm on-site: 'ECG (12-lead)' (Baseline) — imaging workflow warrants direct verification.",
        "Confirm on-site: 'Central lab sample shipment' (Week 4) — vendor workflow warrants direct verification.",
      ]);
    });

    it('forces low confidence on every workflow card (heuristic match)', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'vendor_specimen_workflows').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      // Visit items are 'high' confidence — the heuristic still forces low.
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.confidence_state).toBe('low');
      }
    });

    it('classifies vendor keywords ahead of specimen ("central lab" is not "lab")', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const central = blocksIn(blocks, 'vendor_specimen_workflows').find((b) =>
        b.derived_text.includes("'Central lab sample shipment'"),
      );
      expect(central?.derived_text).toContain('vendor workflow');
    });

    it('dedupes identical procedure strings across visits — first visit wins', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const bloodDraw = blocksIn(blocks, 'vendor_specimen_workflows').filter((b) =>
        b.derived_text.includes("'Blood draw'"),
      );
      expect(bloodDraw).toHaveLength(1);
      expect(bloodDraw[0].derived_text).toContain('(Baseline)');
      // Evidence passthrough comes from the winning (first) visit item.
      expect(bloodDraw[0].extracted_item_id).toBe('vis-1');
      expect(bloodDraw[0].source_evidence_id).toBe('ev-vis-1');
    });

    it('opens with an intro framing block disclosing the heuristic when matches exist', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'vendor_specimen_workflows');
      expect(section[0].block_type).toBe('section_intro');
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].derived_text).toContain('keyword-based detection');
    });

    it('emits a single framing note when no procedures match', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'vis-plain',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit 1', study_day: 1,
              window_minus_days: 0, window_plus_days: 0,
              procedures: ['Vital signs', 'Physical examination'],
            },
          }),
        ]),
      );
      const section = blocksIn(blocks, 'vendor_specimen_workflows');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].confidence_state).toBeNull();
      expect(section[0].derived_text).toContain(
        'PIQC detected no laboratory, imaging, or vendor-dependent procedures',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // T8 — Section 5: amendment present / absent branches
  // ---------------------------------------------------------------------------
  describe('amendment_sensitive_requirements', () => {
    it('emits intro + a fact with evidence passthrough when an amendment exists', () => {
      const blocks = selectCraMonitoringFocusBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'amendment_sensitive_requirements');
      expect(section).toHaveLength(2);
      expect(section[0].block_type).toBe('section_intro');

      const fact = section[1];
      expect(fact.content_origin).toBe('protocol_fact');
      expect(fact.extracted_item_id).toBe('amd-1');
      expect(fact.source_evidence_id).toBe('ev-amd-1');
      expect(fact.source_quote).toBe('Amendment 2: dosing frequency reduced');
      expect(fact.derived_text).toBe(
        'Amendment-affected: Dosing frequency reduced in Amendment 2 — re-verify impacted ' +
        'requirements against the current version.',
      );
    });

    it('emits a single framing note to confirm the current version when no amendment exists', () => {
      const blocks = selectCraMonitoringFocusBlocks(input([]));
      const section = blocksIn(blocks, 'amendment_sensitive_requirements');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].derived_text).toContain('PIQC detected no amendment');
      expect(section[0].derived_text).toContain('current version');
    });

    it('treats an empty-string amendment_summary as no amendment', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'amd-empty',
            field_type: 'metadata',
            field_path: 'amendment_summary',
            extracted_value: '   ',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitive_requirements');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
    });

    it('does not treat other metadata field_paths as amendments', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'meta-ver',
            field_type: 'metadata',
            field_path: 'protocol_version',
            extracted_value: 'v3.0',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitive_requirements');
      expect(section).toHaveLength(1);
      expect(section[0].derived_text).toContain('PIQC detected no amendment');
    });
  });

  // ---------------------------------------------------------------------------
  // T9 — Empty input: only the always-emit fallbacks, all framing
  // ---------------------------------------------------------------------------
  describe('empty input', () => {
    it('emits only the workflow and amendment fallback framing blocks', () => {
      const blocks = selectCraMonitoringFocusBlocks(input([], [], null));
      // 1 (workflow fallback) + 1 (no-amendment note) = 2
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.section_key)).toEqual([
        'vendor_specimen_workflows',
        'amendment_sensitive_requirements',
      ]);
      expect(blocks.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });
  });

  // ---------------------------------------------------------------------------
  // T10 — Malformed extracted_value: skip, never throw
  // ---------------------------------------------------------------------------
  describe('malformed input guards', () => {
    const malformed: SelectionSourceItem[] = [
      item({ id: 'bad-1', field_type: 'inclusion_criterion', field_path: 'key_inclusion_criteria[0]', extracted_value: null }),
      item({ id: 'bad-2', field_type: 'exclusion_criterion', field_path: 'key_exclusion_criteria[0]', extracted_value: 42 }),
      item({ id: 'bad-3', field_type: 'inclusion_criterion', field_path: 'key_inclusion_criteria[1]', extracted_value: '   ' }),
      item({ id: 'bad-4', field_type: 'visit', field_path: 'schedule_of_events[0]', extracted_value: 'not-an-object' }),
      item({ id: 'bad-5', field_type: 'visit', field_path: 'schedule_of_events[1]', extracted_value: { study_day: 14 } }), // no visit_name
      item({ id: 'bad-6', field_type: 'visit', field_path: 'schedule_of_events[2]', extracted_value: ['array', 'not', 'object'] }),
      item({ id: 'bad-7', field_type: 'endpoint', field_path: 'primary_endpoints[0]', extracted_value: undefined }),
      item({ id: 'bad-8', field_type: 'metadata', field_path: 'amendment_summary', extracted_value: { nested: true } }),
      item({ id: 'bad-9', field_type: 'prohibited_med', field_path: 'prohibited_medications[0]', extracted_value: null }),
      item({ id: 'bad-10', field_type: 'prohibited_med', field_path: 'prohibited_medications[1]', extracted_value: '   ' }),
      item({ id: 'bad-11', field_type: 'prohibited_med', field_path: 'prohibited_medications[2]', extracted_value: { name: 'Warfarin' } }),
      item({ id: 'bad-12', field_type: 'unknown_future_type', field_path: 'whatever', extracted_value: 'text' }),
    ];

    it('does not throw on malformed values and emits no fact blocks for them', () => {
      expect(() => selectCraMonitoringFocusBlocks(input(malformed))).not.toThrow();
      const blocks = selectCraMonitoringFocusBlocks(input(malformed));
      expect(blocks.every((b) => b.extracted_item_id === null)).toBe(true);
    });

    it('degrades a non-array procedures field to zero workflow matches', () => {
      const blocks = selectCraMonitoringFocusBlocks(
        input([
          item({
            id: 'vis-badproc',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit 4',
              study_day: 56,
              window_minus_days: 0,
              window_plus_days: 0,
              procedures: 'blood draw', // not an array
            },
          }),
        ]),
      );
      // The visit still produces its fragile-window card...
      expect(blocksIn(blocks, 'fragile_visit_windows')).toHaveLength(2);
      // ...but no workflow matches (fallback framing).
      const workflows = blocksIn(blocks, 'vendor_specimen_workflows');
      expect(workflows).toHaveLength(1);
      expect(workflows[0].content_origin).toBe('derived_operational_framing');
    });
  });

  // ---------------------------------------------------------------------------
  // T11 — Doctrine: no numeric risk scores anywhere in generated prose
  // ---------------------------------------------------------------------------
  describe('no-score doctrine (handover §6.1-A)', () => {
    it('never emits "N/M", "N out of M", or the word "score" in any derived_text', () => {
      for (const testInput of [fullProtocolInput(), input([], [], null)]) {
        for (const block of selectCraMonitoringFocusBlocks(testInput)) {
          expect(block.derived_text).not.toMatch(NO_SCORE_PATTERN);
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // T12 — Doctrine: attention-allocation register, never the other lenses'
  // card templates (plan Decision 3 — same facts, different question)
  // ---------------------------------------------------------------------------
  describe('prose-register uniqueness (plan Decision 3)', () => {
    /** Distinctive card-template prefixes owned by the OTHER two lenses.
     *  KEEP IN SYNC with selection/monitoringChecklist.ts and
     *  selection/riskOverview.ts card templates. */
    const FOREIGN_TEMPLATE_PREFIXES = [
      // monitoringChecklist card templates
      'Verify: ',
      'Confirm absence of: ',
      'Confirm absence of prohibited medication: ',
      'Verify ',                 // visit-window checklist cards
      'PRIMARY ENDPOINT — ',
      'Secondary endpoint — ',
      'Confirm handling/documentation for ',
      'Amendment noted: ',
      // riskOverview card templates
      'Complex eligibility — ',
      'Visit window pressure — ',
      'Primary endpoint — ',
      'External dependency — ',
      'Dense visit — ',
      'Amendment in force: ',
      'Restricted medication in eligibility scope: ',
    ];

    it('no derived_text starts with a checklist or risk-overview card template', () => {
      for (const testInput of [fullProtocolInput(), input([], [], null)]) {
        for (const block of selectCraMonitoringFocusBlocks(testInput)) {
          for (const prefix of FOREIGN_TEMPLATE_PREFIXES) {
            expect(block.derived_text.startsWith(prefix)).toBe(false);
          }
        }
      }
    });

    it('every fact card opens in the attention-allocation register', () => {
      const OWN_PREFIXES = [
        'Prioritize eligibility verification — ',
        'Prioritize medication-history review: ',
        'Plan on-site window verification — ',
        'Prioritize source-data verification for the primary endpoint: ',
        "Confirm on-site: '",
        'Amendment-affected: ',
      ];
      const facts = selectCraMonitoringFocusBlocks(fullProtocolInput()).filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(OWN_PREFIXES.some((prefix) => fact.derived_text.startsWith(prefix))).toBe(true);
      }
    });
  });
});
