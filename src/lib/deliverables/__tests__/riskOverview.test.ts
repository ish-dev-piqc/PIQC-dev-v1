import { describe, it, expect } from 'vitest';
import { selectRiskOverviewBlocks, type RiskBlockSpec } from '../selection/riskOverview';
import type { SelectionInput, SelectionSourceItem } from '../selection/monitoringChecklist';
import { RISK_SECTION_ORDER } from '../../../types/deliverables';

// -----------------------------------------------------------------------------
// Fixture builders (mirrors monitoringChecklist.test.ts)
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

function blocksIn(blocks: RiskBlockSpec[], sectionKey: string): RiskBlockSpec[] {
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
 * conditional-keyword, one lengthy; 2 unflagged), 3 visits (one 0/0 exact-day
 * with 8 procedures incl. specimen+imaging matches, one ±1 with a vendor
 * match and an overlapping procedure for dedupe, one ±3 that must NOT flag),
 * primary + secondary endpoints, an amendment summary, non-selected items
 * (dosing, protocol_version metadata), and a cohort the risk lens ignores.
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
        id: 'vis-1',
        field_type: 'visit',
        field_path: 'schedule_of_events[0]',
        extracted_value: {
          visit_name: 'Baseline',
          study_day: 1,
          window_minus_days: 0,
          window_plus_days: 0,
          // 8 procedures → dense; 'Blood draw' (specimen) + 'ECG (12-lead)'
          // (imaging) match the dependency taxonomy, the rest must not.
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

describe('selectRiskOverviewBlocks', () => {
  // ---------------------------------------------------------------------------
  // T1 — Full protocol: section grouping, counts, global ordering
  // ---------------------------------------------------------------------------
  describe('full-protocol fixture', () => {
    const blocks = selectRiskOverviewBlocks(fullProtocolInput());

    it('emits all six sections in RISK_SECTION_ORDER', () => {
      const sectionSequence: string[] = [];
      for (const block of blocks) {
        if (sectionSequence[sectionSequence.length - 1] !== block.section_key) {
          sectionSequence.push(block.section_key);
        }
      }
      expect(sectionSequence).toEqual([...RISK_SECTION_ORDER]);
    });

    it('emits the expected block count per section', () => {
      expect(blocksIn(blocks, 'eligibility_complexity')).toHaveLength(3);         // intro + 2 flagged
      expect(blocksIn(blocks, 'visit_window_pressure')).toHaveLength(3);          // intro + 2 narrow visits
      expect(blocksIn(blocks, 'endpoint_critical_procedures')).toHaveLength(2);   // intro + 1 primary
      expect(blocksIn(blocks, 'vendor_lab_imaging_dependencies')).toHaveLength(4); // intro + 3 unique matches
      expect(blocksIn(blocks, 'coordination_burden')).toHaveLength(2);            // intro + 1 dense visit
      expect(blocksIn(blocks, 'amendment_sensitivity')).toHaveLength(2);          // intro + fact
      expect(blocks).toHaveLength(16);
    });

    it('assigns a contiguous, globally increasing sort_order starting at 0', () => {
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });

    it('opens every emitted section with a section_intro framing block', () => {
      for (const sectionKey of RISK_SECTION_ORDER) {
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
      expect(selectRiskOverviewBlocks(fullProtocolInput())).toEqual(blocks);
    });

    it('ignores cohorts — output is identical with and without them', () => {
      const base = fullProtocolInput();
      const withoutCohorts: SelectionInput = { ...base, cohorts: [] };
      expect(selectRiskOverviewBlocks(withoutCohorts)).toEqual(blocks);
    });
  });

  // ---------------------------------------------------------------------------
  // T2 — Content-origin discipline (the 3-way taxonomy, never blurred)
  // ---------------------------------------------------------------------------
  describe('content_origin discipline', () => {
    const blocks = selectRiskOverviewBlocks(fullProtocolInput());

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
      const result = selectRiskOverviewBlocks(
        input([
          item({
            id: 'inc-nc',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Prior exposure to the study drug class',
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
    const blocks = selectRiskOverviewBlocks(fullProtocolInput());

    it('copies quote, page, and section from the primary evidence onto the block', () => {
      const fact = blocks.find((b) => b.extracted_item_id === 'inc-2');
      expect(fact).toBeDefined();
      expect(fact?.source_evidence_id).toBe('ev-inc-2');
      expect(fact?.source_quote).toBe('Diagnosis documented within 5 years');
      expect(fact?.source_page_number).toBe(10);
      expect(fact?.source_section).toBe('Section 4.1');
    });

    it('carries the item confidence through unchanged (non-heuristic sections)', () => {
      const fact = blocks.find((b) => b.extracted_item_id === 'inc-2');
      expect(fact?.confidence_state).toBe('medium');
    });

    it('emits a fact with null evidence fields when the item has no primary evidence', () => {
      const result = selectRiskOverviewBlocks(
        input([
          item({
            id: 'inc-noev',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'No history of clinically significant arrhythmia',
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
  // T4 — Section 1: eligibility complexity flags
  // ---------------------------------------------------------------------------
  describe('eligibility_complexity', () => {
    it('the length fixture really is longer than the 220-char threshold', () => {
      expect(LONG_CRITERION.length).toBeGreaterThan(220);
    });

    it('names the reason per flagged criterion — conditional logic vs lengthy criterion', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'eligibility_complexity').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.map((f) => f.derived_text)).toEqual([
        'Complex eligibility — conditional logic: Documented diagnosis within the past 5 years',
        `Complex eligibility — lengthy criterion: ${LONG_CRITERION}`,
      ]);
    });

    it('states the flagged-of-total counts in the section intro', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const intro = blocksIn(blocks, 'eligibility_complexity')[0];
      expect(intro.derived_text).toContain('PIQC flagged 2 of 4 eligibility criteria as complex');
    });

    it('matches conditional keywords case-insensitively', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'exc-hist',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: 'HISTORY OF malignancy requiring systemic treatment',
          }),
        ]),
      );
      const fact = blocksIn(blocks, 'eligibility_complexity').find(
        (b) => b.extracted_item_id === 'exc-hist',
      );
      expect(fact?.derived_text).toContain('conditional logic');
    });

    it('requires word boundaries — "if" inside "Specific" does not flag', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'inc-spec',
            field_type: 'inclusion_criterion',
            field_path: 'key_inclusion_criteria[0]',
            extracted_value: 'Specific laboratory values are required at enrollment',
          }),
        ]),
      );
      expect(blocksIn(blocks, 'eligibility_complexity')).toHaveLength(0);
    });

    it('names conditional logic as the reason when a criterion is both conditional AND lengthy', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'exc-both',
            field_type: 'exclusion_criterion',
            field_path: 'key_exclusion_criteria[0]',
            extracted_value: `${LONG_CRITERION} This does not apply unless the sponsor agrees in writing.`,
          }),
        ]),
      );
      const fact = blocksIn(blocks, 'eligibility_complexity').find(
        (b) => b.extracted_item_id === 'exc-both',
      );
      expect(fact?.derived_text).toContain('Complex eligibility — conditional logic:');
    });

    it('emits no section when no criterion is flagged', () => {
      const blocks = selectRiskOverviewBlocks(
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
      expect(blocksIn(blocks, 'eligibility_complexity')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T5 — Section 2: visit window pressure
  // ---------------------------------------------------------------------------
  describe('visit_window_pressure', () => {
    it('renders 0/0 visits as exact-day requirements with deviation-risk prose', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-1' && b.section_key === 'visit_window_pressure',
      );
      expect(fact?.derived_text).toBe(
        'Visit window pressure — Baseline (study day 1): no window — exact day required. ' +
        'Any scheduling slip immediately becomes a protocol deviation.',
      );
    });

    it('states the ±window for narrow non-exact visits', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const fact = blocks.find(
        (b) => b.extracted_item_id === 'vis-2' && b.section_key === 'visit_window_pressure',
      );
      expect(fact?.derived_text).toBe(
        'Visit window pressure — Week 4 (study day 28): window −1/+1 days. A tolerance this ' +
        'narrow makes scheduling conflicts likely to end in documented deviations.',
      );
    });

    it('states the narrow-of-total counts in the section intro', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const intro = blocksIn(blocks, 'visit_window_pressure')[0];
      expect(intro.derived_text).toContain('PIQC identified 2 of 3 extracted visits');
    });

    it('includes a total window of exactly 2 days and excludes 3', () => {
      const blocks = selectRiskOverviewBlocks(
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
      const section = blocksIn(blocks, 'visit_window_pressure');
      expect(section).toHaveLength(2); // intro + Visit A only
      expect(section[1].extracted_item_id).toBe('vis-a');
      expect(section[1].derived_text).toContain('window −2/+0 days');
    });

    it('falls back to "its scheduled study day" when study_day is missing', () => {
      const blocks = selectRiskOverviewBlocks(
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
      const blocks = selectRiskOverviewBlocks(
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
      expect(blocksIn(blocks, 'visit_window_pressure')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T6 — Section 3: primary endpoints only (Decision 3)
  // ---------------------------------------------------------------------------
  describe('endpoint_critical_procedures', () => {
    it('emits a verification-emphasis card per PRIMARY endpoint', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const fact = blocks.find((b) => b.extracted_item_id === 'ep-1');
      expect(fact?.section_key).toBe('endpoint_critical_procedures');
      expect(fact?.derived_text).toBe(
        'Primary endpoint — source-data verification emphasis: Change in PANSS total at week 24',
      );
    });

    it('emits no section when only secondary endpoints exist', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'ep-sec',
            field_type: 'endpoint',
            field_path: 'secondary_endpoints[0]',
            extracted_value: 'Overall response rate at week 12',
          }),
        ]),
      );
      expect(blocksIn(blocks, 'endpoint_critical_procedures')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T7 — Section 4: vendor/lab/imaging dependency heuristic
  // ---------------------------------------------------------------------------
  describe('vendor_lab_imaging_dependencies', () => {
    it('names the dependency category and visit, one card per unique match', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'vendor_lab_imaging_dependencies').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts.map((f) => f.derived_text)).toEqual([
        "External dependency — 'Blood draw' (Baseline): specimen workflow depends on " +
          "coordination and turnaround outside the site's direct control.",
        "External dependency — 'ECG (12-lead)' (Baseline): imaging workflow depends on " +
          "coordination and turnaround outside the site's direct control.",
        "External dependency — 'Central lab sample shipment' (Week 4): vendor workflow " +
          "depends on coordination and turnaround outside the site's direct control.",
      ]);
    });

    it('forces low confidence on every dependency card (heuristic match)', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'vendor_lab_imaging_dependencies').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      // Visit items are 'high' confidence — the heuristic still forces low.
      expect(facts.length).toBeGreaterThan(0);
      for (const fact of facts) {
        expect(fact.confidence_state).toBe('low');
      }
    });

    it('classifies vendor keywords ahead of specimen ("central lab" is not "lab")', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const central = blocksIn(blocks, 'vendor_lab_imaging_dependencies').find((b) =>
        b.derived_text.includes("'Central lab sample shipment'"),
      );
      expect(central?.derived_text).toContain('vendor workflow');
    });

    it('dedupes identical procedure strings across visits — first visit wins', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const bloodDraw = blocksIn(blocks, 'vendor_lab_imaging_dependencies').filter((b) =>
        b.derived_text.includes("'Blood draw'"),
      );
      expect(bloodDraw).toHaveLength(1);
      expect(bloodDraw[0].derived_text).toContain('(Baseline)');
      // Evidence passthrough comes from the winning (first) visit item.
      expect(bloodDraw[0].extracted_item_id).toBe('vis-1');
      expect(bloodDraw[0].source_evidence_id).toBe('ev-vis-1');
    });

    it('opens with an intro framing block when matches exist', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'vendor_lab_imaging_dependencies');
      expect(section[0].block_type).toBe('section_intro');
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].derived_text).toContain('keyword-based detection');
    });

    it('emits a single framing note when no procedures match', () => {
      const blocks = selectRiskOverviewBlocks(
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
      const section = blocksIn(blocks, 'vendor_lab_imaging_dependencies');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].confidence_state).toBeNull();
      expect(section[0].derived_text).toContain('No laboratory, imaging, or vendor-dependent procedures');
    });
  });

  // ---------------------------------------------------------------------------
  // T8 — Section 5: coordination burden (dense visits)
  // ---------------------------------------------------------------------------
  describe('coordination_burden', () => {
    it('renders a dense-visit card with the procedure count and pressure prose', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const facts = blocksIn(blocks, 'coordination_burden').filter(
        (b) => b.content_origin === 'protocol_fact',
      );
      expect(facts).toHaveLength(1);
      expect(facts[0].extracted_item_id).toBe('vis-1');
      expect(facts[0].derived_text).toBe(
        'Dense visit — Baseline: 8 procedures scheduled; multi-role coordination pressure.',
      );
    });

    it('states the dense-visit count in the section intro', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const intro = blocksIn(blocks, 'coordination_burden')[0];
      expect(intro.derived_text).toContain('PIQC flagged 1 visit with a dense procedure load');
    });

    it('flags at exactly 8 procedures and not at 7 (threshold boundary)', () => {
      const procedures = (n: number, prefix: string) =>
        Array.from({ length: n }, (_, i) => `${prefix} assessment ${i + 1}`);
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'vis-seven',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit Seven', study_day: 7,
              window_minus_days: 3, window_plus_days: 3,
              procedures: procedures(7, 'Routine'),
            },
          }),
          item({
            id: 'vis-eight',
            field_type: 'visit',
            field_path: 'schedule_of_events[1]',
            extracted_value: {
              visit_name: 'Visit Eight', study_day: 14,
              window_minus_days: 3, window_plus_days: 3,
              procedures: procedures(8, 'Extended'),
            },
          }),
        ]),
      );
      const section = blocksIn(blocks, 'coordination_burden');
      expect(section).toHaveLength(2); // intro + Visit Eight only
      expect(section[1].extracted_item_id).toBe('vis-eight');
      expect(section[1].derived_text).toBe(
        'Dense visit — Visit Eight: 8 procedures scheduled; multi-role coordination pressure.',
      );
    });

    it('emits no section when no visit is dense', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'vis-light',
            field_type: 'visit',
            field_path: 'schedule_of_events[0]',
            extracted_value: {
              visit_name: 'Visit Light', study_day: 1,
              window_minus_days: 0, window_plus_days: 0,
              procedures: ['Vital signs'],
            },
          }),
        ]),
      );
      expect(blocksIn(blocks, 'coordination_burden')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T9 — Section 6: amendment present / absent branches
  // ---------------------------------------------------------------------------
  describe('amendment_sensitivity', () => {
    it('emits intro + a fact with evidence passthrough when an amendment exists', () => {
      const blocks = selectRiskOverviewBlocks(fullProtocolInput());
      const section = blocksIn(blocks, 'amendment_sensitivity');
      expect(section).toHaveLength(2);
      expect(section[0].block_type).toBe('section_intro');

      const fact = section[1];
      expect(fact.content_origin).toBe('protocol_fact');
      expect(fact.extracted_item_id).toBe('amd-1');
      expect(fact.source_evidence_id).toBe('ev-amd-1');
      expect(fact.source_quote).toBe('Amendment 2: dosing frequency reduced');
      expect(fact.derived_text).toBe(
        'Amendment in force: Dosing frequency reduced in Amendment 2 — affected requirements ' +
        'deserve monitoring emphasis.',
      );
    });

    it('emits a single framing note to confirm the current version when no amendment exists', () => {
      const blocks = selectRiskOverviewBlocks(input([]));
      const section = blocksIn(blocks, 'amendment_sensitivity');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
      expect(section[0].derived_text).toContain('No amendment was detected');
      expect(section[0].derived_text).toContain('current protocol version');
    });

    it('treats an empty-string amendment_summary as no amendment', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'amd-empty',
            field_type: 'metadata',
            field_path: 'amendment_summary',
            extracted_value: '   ',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitivity');
      expect(section).toHaveLength(1);
      expect(section[0].content_origin).toBe('derived_operational_framing');
    });

    it('does not treat other metadata field_paths as amendments', () => {
      const blocks = selectRiskOverviewBlocks(
        input([
          item({
            id: 'meta-ver',
            field_type: 'metadata',
            field_path: 'protocol_version',
            extracted_value: 'v3.0',
          }),
        ]),
      );
      const section = blocksIn(blocks, 'amendment_sensitivity');
      expect(section).toHaveLength(1);
      expect(section[0].derived_text).toContain('No amendment was detected');
    });
  });

  // ---------------------------------------------------------------------------
  // T10 — Empty input: only the always-emit fallbacks, all framing
  // ---------------------------------------------------------------------------
  describe('empty input', () => {
    it('emits only the dependency and amendment fallback framing blocks', () => {
      const blocks = selectRiskOverviewBlocks(input([], [], null));
      // 1 (dependency fallback) + 1 (no-amendment note) = 2
      expect(blocks).toHaveLength(2);
      expect(blocks.map((b) => b.section_key)).toEqual([
        'vendor_lab_imaging_dependencies',
        'amendment_sensitivity',
      ]);
      expect(blocks.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
      blocks.forEach((block, i) => expect(block.sort_order).toBe(i));
    });
  });

  // ---------------------------------------------------------------------------
  // T11 — Malformed extracted_value: skip, never throw
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
      item({ id: 'bad-9', field_type: 'unknown_future_type', field_path: 'whatever', extracted_value: 'text' }),
    ];

    it('does not throw on malformed values and emits no fact blocks for them', () => {
      expect(() => selectRiskOverviewBlocks(input(malformed))).not.toThrow();
      const blocks = selectRiskOverviewBlocks(input(malformed));
      expect(blocks.every((b) => b.extracted_item_id === null)).toBe(true);
    });

    it('degrades a non-array procedures field to zero dependencies and zero density', () => {
      const blocks = selectRiskOverviewBlocks(
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
      // The visit still produces its window-pressure card...
      expect(blocksIn(blocks, 'visit_window_pressure')).toHaveLength(2);
      // ...but no dependency matches (fallback framing) and no dense flag.
      const deps = blocksIn(blocks, 'vendor_lab_imaging_dependencies');
      expect(deps).toHaveLength(1);
      expect(deps[0].content_origin).toBe('derived_operational_framing');
      expect(blocksIn(blocks, 'coordination_burden')).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // T12 — Doctrine: no numeric risk scores anywhere in generated prose
  // ---------------------------------------------------------------------------
  describe('no-score doctrine (handover §6.1-A)', () => {
    it('never emits "N/M", "N out of M", or the word "score" in any derived_text', () => {
      for (const testInput of [fullProtocolInput(), input([], [], null)]) {
        for (const block of selectRiskOverviewBlocks(testInput)) {
          expect(block.derived_text).not.toMatch(NO_SCORE_PATTERN);
        }
      }
    });
  });
});
