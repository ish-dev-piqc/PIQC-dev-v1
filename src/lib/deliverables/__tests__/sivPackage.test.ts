import { describe, expect, it } from 'vitest';
import { selectSivPackageBlocks, type SivBlockSpec } from '../selection/sivPackage';
import type { SelectionInput, SelectionSourceItem } from '../selection/monitoringChecklist';
import { SIV_SECTION_ORDER } from '../../../types/deliverables';

// =============================================================================
// sivPackage selection — the unit-tested SPEC for deliverable_generate's
// siv_package branch. Pins: section composition + teaching order, the
// exactly-one-speaker-note-per-emitted-section rule, the structural
// sponsor-confirmation sentence, content-origin discipline, boundary
// thresholds, prose-register uniqueness vs the three sibling lenses, and
// malformed-input guards.
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
    confidence_state:
      opts.confidence_state !== undefined ? opts.confidence_state : 'high',
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

const CONDITIONAL_CRITERION =
  'Participants with a history of hepatic impairment are excluded unless enzyme levels normalized.';
const LONG_CRITERION = 'B'.repeat(230);
const PLAIN_CRITERION = 'Age 18 to 75 years, inclusive.';

function fullInput(): SelectionInput {
  nextId = 0; // deterministic ids so two builds of the fixture are identical
  return {
    items: [
      item('metadata', 'study_design', 'Randomized, double-blind, placebo-controlled.'),
      item('metadata', 'study_phase', 'Phase II'),
      item('dosing', 'dosing_regimen', '50 mg once daily for 12 weeks.'),
      item('inclusion_criterion', 'key_inclusion_criteria[0]', PLAIN_CRITERION),
      item('exclusion_criterion', 'key_exclusion_criteria[0]', CONDITIONAL_CRITERION),
      item('inclusion_criterion', 'key_inclusion_criteria[1]', LONG_CRITERION),
      item('prohibited_med', 'prohibited_medications[0]', 'Strong CYP3A4 inhibitors'),
      item('prohibited_med', 'prohibited_medications[1]', 'Systemic corticosteroids', {
        confidence_state: null,
      }),
      item('visit', 'schedule_of_events[0]', visitValue('Baseline', 1, 0, 0, ['Blood draw'])),
      item('visit', 'schedule_of_events[1]', visitValue('Week 4', 28, 1, 1, ['MRI scan'])),
      item('visit', 'schedule_of_events[2]', visitValue('Week 12', 84, 7, 7, ['Questionnaire'])),
      item('endpoint', 'primary_endpoints[0]', 'Change in FEV1 at week 12'),
      item('endpoint', 'primary_endpoints[1]', 'Time to first exacerbation'),
      item('endpoint', 'secondary_endpoints[0]', 'Quality-of-life score'),
      item('metadata', 'amendment_summary', 'Amendment 2 narrows the dosing window.'),
    ],
    cohorts: [],
    protocolVersion: 'v2.0',
  };
}

function bySection(blocks: SivBlockSpec[]): Map<string, SivBlockSpec[]> {
  const map = new Map<string, SivBlockSpec[]>();
  for (const b of blocks) {
    const list = map.get(b.section_key) ?? [];
    list.push(b);
    map.set(b.section_key, list);
  }
  return map;
}

describe('selectSivPackageBlocks — full-protocol fixture', () => {
  const blocks = selectSivPackageBlocks(fullInput());
  const sections = bySection(blocks);

  it('emits 35 blocks across all nine sections in SIV_SECTION_ORDER', () => {
    expect(blocks).toHaveLength(35);
    const emittedOrder = [...new Set(blocks.map((b) => b.section_key))];
    expect(emittedOrder).toEqual([...SIV_SECTION_ORDER]);
  });

  it('sort_order is a contiguous 0-based global sequence', () => {
    expect(blocks.map((b) => b.sort_order)).toEqual(blocks.map((_, i) => i));
  });

  it('is deterministic', () => {
    expect(selectSivPackageBlocks(fullInput())).toEqual(blocks);
  });

  it('per-section composition matches the spec', () => {
    expect(sections.get('study_overview')).toHaveLength(5);
    expect(sections.get('participant_journey')).toHaveLength(5);
    expect(sections.get('eligibility_emphasis')).toHaveLength(6);
    expect(sections.get('endpoint_critical')).toHaveLength(4);
    expect(sections.get('windows_and_timing')).toHaveLength(4);
    expect(sections.get('vendor_lab_workflows')).toHaveLength(4);
    expect(sections.get('safety_expectations')).toHaveLength(2);
    expect(sections.get('amendment_changes')).toHaveLength(3);
    expect(sections.get('before_first_patient')).toHaveLength(2);
  });

  it('every emitted section has EXACTLY ONE speaker_note, and it is the last block', () => {
    for (const [key, list] of sections) {
      const notes = list.filter((b) => b.block_type === 'speaker_note');
      expect(notes, key).toHaveLength(1);
      expect(list[list.length - 1].block_type, key).toBe('speaker_note');
    }
  });

  it('every speaker note carries the sponsor-confirmation sentence and the structural shape', () => {
    for (const note of blocks.filter((b) => b.block_type === 'speaker_note')) {
      expect(note.derived_text).toMatch(/^Teaching point: /);
      expect(note.derived_text).toContain('Likely site question: ');
      expect(note.derived_text?.endsWith('Confirm specifics with the sponsor before presenting.')).toBe(true);
      expect(note.content_origin).toBe('derived_operational_framing');
      expect(note.extracted_item_id).toBeNull();
      expect(note.source_evidence_id).toBeNull();
      expect(note.confidence_state).toBeNull();
    }
  });

  it('facts always carry evidence passthrough + confidence; framing never does', () => {
    for (const b of blocks) {
      if (b.content_origin === 'protocol_fact') {
        expect(b.extracted_item_id).not.toBeNull();
        expect(b.confidence_state).not.toBeNull();
        expect(b.source_quote).toMatch(/^quote for /);
      } else {
        expect(b.extracted_item_id).toBeNull();
        expect(b.source_evidence_id).toBeNull();
        expect(b.confidence_state).toBeNull();
      }
    }
  });

  it('null item confidence degrades to needs_review on the med fact', () => {
    const med = blocks.find((b) => b.derived_text?.includes('Systemic corticosteroids'));
    expect(med?.confidence_state).toBe('needs_review');
  });

  it('workflow cards force low confidence and dedupe by procedure', () => {
    const workflow = sections
      .get('vendor_lab_workflows')!
      .filter((b) => b.content_origin === 'protocol_fact');
    expect(workflow).toHaveLength(2); // Blood draw (specimen) + MRI scan (imaging); Questionnaire no match
    for (const w of workflow) expect(w.confidence_state).toBe('low');
  });

  it('journey covers every visit; timing covers only narrow windows', () => {
    const journey = sections.get('participant_journey')!.filter((b) => b.content_origin === 'protocol_fact');
    expect(journey).toHaveLength(3);
    expect(journey[0].derived_text).toBe('Baseline — study day 1, exact day (no window).');
    expect(journey[1].derived_text).toBe('Week 4 — study day 28, window −1/+1 days.');
    const timing = sections.get('windows_and_timing')!.filter((b) => b.content_origin === 'protocol_fact');
    expect(timing).toHaveLength(2); // 0/0 and −1/+1; the 7/7 visit is excluded
    expect(timing[0].derived_text).toContain('exact day — no scheduling window');
  });

  it('eligibility emphasis: conditional beats length as the named reason; meds use the teaching template', () => {
    const emphasis = sections.get('eligibility_emphasis')!;
    expect(
      emphasis.find((b) => b.derived_text?.startsWith('Emphasize at SIV — conditional logic:')),
    ).toBeTruthy();
    expect(
      emphasis.find((b) => b.derived_text?.startsWith('Emphasize at SIV — lengthy criterion:')),
    ).toBeTruthy();
    expect(
      emphasis.find(
        (b) => b.derived_text === 'Medication restriction to teach: Strong CYP3A4 inhibitors',
      ),
    ).toBeTruthy();
  });

  it('endpoint section takes primary endpoints only', () => {
    const endpoint = sections.get('endpoint_critical')!.filter((b) => b.content_origin === 'protocol_fact');
    expect(endpoint).toHaveLength(2);
    expect(endpoint.every((b) => b.derived_text?.startsWith('First-patient quality depends on: '))).toBe(true);
  });

  it('amendment section presents the amendment as a fact', () => {
    const amendment = sections.get('amendment_changes')!;
    expect(
      amendment.find((b) =>
        b.derived_text?.startsWith('Amendment to present: Amendment 2 narrows the dosing window.'),
      )?.content_origin,
    ).toBe('protocol_fact');
  });

  it('before_first_patient close names the non-zero counts', () => {
    const close = sections.get('before_first_patient')![0];
    expect(close.derived_text).toContain('2 eligibility emphases');
    expect(close.derived_text).toContain('2 medication restrictions');
    expect(close.derived_text).toContain('2 endpoint-critical procedures');
    expect(close.derived_text).toContain('2 timing rehearsals');
  });

  it('contains no numeric scores in any prose', () => {
    for (const b of blocks) {
      expect(b.derived_text).not.toMatch(/\b\d+(\.\d+)?\s*(\/|out of)\s*\d+|\bscore\b/i);
    }
  });

  it('never duplicates the sibling lenses" card templates', () => {
    const foreignPrefixes = [
      'Verify: ',
      'Confirm absence of prohibited medication:',
      'Confirm absence of: ',
      'Complex eligibility — ',
      'Visit window pressure — ',
      'Primary endpoint — ',
      'Secondary endpoint — ',
      'External dependency — ',
      'Dense visit — ',
      'Restricted medication in eligibility scope:',
      'Amendment in force:',
      'Amendment noted:',
      'Prioritize eligibility verification — ',
      'Prioritize medication-history review:',
      'Plan on-site window verification — ',
      'Prioritize source-data verification',
      'Confirm on-site:',
      'Amendment-affected:',
    ];
    for (const b of blocks) {
      for (const prefix of foreignPrefixes) {
        expect(b.derived_text?.startsWith(prefix), `${b.section_key}: ${b.derived_text}`).toBe(false);
      }
    }
  });
});

describe('selectSivPackageBlocks — emission policy', () => {
  it('empty input emits only the five always-on sections (10 framing blocks)', () => {
    const blocks = selectSivPackageBlocks({ items: [], cohorts: [], protocolVersion: null });
    expect(blocks).toHaveLength(10);
    const keys = [...new Set(blocks.map((b) => b.section_key))];
    expect(keys).toEqual([
      'study_overview',
      'vendor_lab_workflows',
      'safety_expectations',
      'amendment_changes',
      'before_first_patient',
    ]);
    expect(blocks.every((b) => b.content_origin === 'derived_operational_framing')).toBe(true);
    // Fallback branches still close with their speaker note.
    const notes = blocks.filter((b) => b.block_type === 'speaker_note');
    expect(notes).toHaveLength(5);
  });

  it('criterion length boundary: 220 chars does not flag, 221 does', () => {
    const at = selectSivPackageBlocks({
      items: [item('inclusion_criterion', 'key_inclusion_criteria[0]', 'C'.repeat(220))],
      cohorts: [],
      protocolVersion: null,
    });
    expect(at.some((b) => b.section_key === 'eligibility_emphasis')).toBe(false);
    const over = selectSivPackageBlocks({
      items: [item('inclusion_criterion', 'key_inclusion_criteria[0]', 'C'.repeat(221))],
      cohorts: [],
      protocolVersion: null,
    });
    expect(
      over.find((b) => b.derived_text?.startsWith('Emphasize at SIV — lengthy criterion:')),
    ).toBeTruthy();
  });

  it('window boundary: total 2 is a rehearsal, total 3 is not', () => {
    const two = selectSivPackageBlocks({
      items: [item('visit', 'schedule_of_events[0]', visitValue('V1', 10, 1, 1))],
      cohorts: [],
      protocolVersion: null,
    });
    expect(two.some((b) => b.section_key === 'windows_and_timing')).toBe(true);
    const three = selectSivPackageBlocks({
      items: [item('visit', 'schedule_of_events[0]', visitValue('V1', 10, 1, 2))],
      cohorts: [],
      protocolVersion: null,
    });
    expect(three.some((b) => b.section_key === 'windows_and_timing')).toBe(false);
  });

  it('malformed values never throw and never produce fact blocks', () => {
    const blocks = selectSivPackageBlocks({
      items: [
        item('visit', 'schedule_of_events[0]', null),
        item('visit', 'schedule_of_events[1]', 42),
        item('visit', 'schedule_of_events[2]', { study_day: 5 }), // nameless
        item('visit', 'schedule_of_events[3]', visitValue('OK', 1, 0, 0, 'not-array' as unknown as string[])),
        item('prohibited_med', 'prohibited_medications[0]', { nested: true }),
        item('endpoint', 'primary_endpoints[0]', '   '),
        item('mystery_type', 'mystery[0]', 'value'),
      ],
      cohorts: [],
      protocolVersion: null,
    });
    // Only the 'OK' visit survives (journey + exact-day timing rehearsal).
    const facts = blocks.filter((b) => b.content_origin === 'protocol_fact');
    expect(facts.every((b) => b.derived_text?.includes('OK'))).toBe(true);
  });

  it('missing primary evidence still counts the fact, with null evidence fields', () => {
    const blocks = selectSivPackageBlocks({
      items: [
        item('endpoint', 'primary_endpoints[0]', 'Endpoint text', { primary_evidence: null }),
      ],
      cohorts: [],
      protocolVersion: null,
    });
    const fact = blocks.find((b) => b.content_origin === 'protocol_fact');
    expect(fact).toBeTruthy();
    expect(fact?.source_evidence_id).toBeNull();
    expect(fact?.source_quote).toBeNull();
  });
});
