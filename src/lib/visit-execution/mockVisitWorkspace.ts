// =============================================================================
// Visit Execution Workspace — Sprint 1 mock fixture.
//
// Enriches the existing BRIGHTEN-2 visit templates (from
// src/lib/demo/fixtures/visitTemplates.ts) with execution-specific data —
// phase grouping, classification, conditional rules, timing constraints,
// source field scaffolding, traceability references — that the real
// CLINICAL_EXTRACT_SCHEMA cannot yet produce.
//
// This fixture is the Sprint 2 schema specification. Every field shown here
// corresponds to a column or JSONB key that will be added in a future ingest
// schema update or a new visit_execution_items table.
//
// Gated by the piq-visit-execution-mock-v1 localStorage toggle.
// =============================================================================

import { getDemoVisitTemplates } from '../demo/fixtures/visitTemplates';
import { DEMO_PROTOCOL_IDS } from '../demo/ids';
import type {
  ConditionalRule,
  ExecutionPhase,
  ItemClassification,
  SourceFieldScaffold,
  AssessmentTimingConstraint,
  VisitCompletenessSignal,
  VisitConfidenceState,
  VisitExecutionItem,
  VisitExecutionWorkspace,
  VisitItemTraceability,
  VisitSnapshot,
} from '../../types/visit-execution';


// ---------------------------------------------------------------------------
// Helpers for building enriched items concisely.
// ---------------------------------------------------------------------------

interface MockItemSeed {
  label: string;
  description?: string;
  phase: ExecutionPhase;
  classification: ItemClassification;
  conditions?: ConditionalRule[];
  timing?: AssessmentTimingConstraint | null;
  source_fields?: SourceFieldScaffold[];
  role_hint?: string | null;
  traceability: Partial<VisitItemTraceability>;
  /**
   * Sprint 3.5a addition. When omitted, defaults to 'high' for the mock
   * fixture (the BRIGHTEN-2 demo is curated, not parser-derived). Real
   * production rows get this from protocol_extracted_items.confidence_state
   * via the v2 RPC.
   */
  confidence_state?: VisitConfidenceState;
}

function buildItem(
  visitTemplateId: string,
  index: number,
  seed: MockItemSeed,
): VisitExecutionItem {
  const traceability: VisitItemTraceability = {
    soa_column: null,
    protocol_section: null,
    protocol_page: null,
    amendment_version: 'Original (v1.0)',
    source_evidence_id: null,
    cross_reference_source_section: null,
    cross_reference_page: null,
    cross_reference_snippet: null,
    ...seed.traceability,
  };

  return {
    id: `${visitTemplateId}-item-${index.toString().padStart(2, '0')}`,
    extracted_item_id: null,
    label: seed.label,
    // Sprint 4b: mock items have no drift — derived_text mirrors label.
    // (Real-data rows from the v3 RPC carry the parser's frozen text.)
    derived_text: seed.label,
    description: seed.description ?? null,
    phase: seed.phase,
    classification: seed.classification,
    conditions: seed.conditions ?? [],
    timing: seed.timing ?? null,
    source_fields: seed.source_fields ?? [],
    role_hint: seed.role_hint ?? null,
    traceability,
    review_status: 'not_reviewed',
    review_note: null,
    confidence_state: seed.confidence_state ?? 'high',
  };
}

function deriveSnapshot(
  visit_name: string,
  study_day: number,
  window_minus_days: number,
  window_plus_days: number,
  purpose: string,
  items: VisitExecutionItem[],
  completeness_signals: VisitCompletenessSignal[] = [],
  confidence_state: VisitConfidenceState | null = 'high',
): VisitSnapshot {
  const is_dosing_visit = items.some(
    (i) => i.phase === 'dosing' || /dos|imp|infusion|administration/i.test(i.label),
  );
  const has_primary_endpoint = items.some((i) => i.classification === 'primary_endpoint');
  const has_safety_critical = items.some((i) => i.classification === 'safety_critical');
  const conditional_item_count = items.filter((i) => i.conditions.length > 0).length;
  const endpoint_critical_count = items.filter((i) =>
    ['primary_endpoint', 'secondary_endpoint', 'safety_critical'].includes(i.classification),
  ).length;

  return {
    visit_name,
    study_day,
    window_minus_days,
    window_plus_days,
    purpose,
    is_dosing_visit,
    has_primary_endpoint,
    has_safety_critical,
    item_count: items.length,
    conditional_item_count,
    endpoint_critical_count,
    needs_review_count: 0,
    reviewed_count: 0,
    flagged_count: 0,
    amendment_version: 'Original (v1.0)',
    confidence_state,
    completeness_signal_count: completeness_signals.length,
    completeness_signals,
  };
}


// ---------------------------------------------------------------------------
// Visit-by-visit enriched fixtures (BRIGHTEN-2 only — 6 visits).
// Other demo protocols fall back to a thin synthesizer in the adapter.
// ---------------------------------------------------------------------------

function brighten2ScreeningItems(visitTplId: string): VisitExecutionItem[] {
  return [
    buildItem(visitTplId, 1, {
      label: 'Confirm site readiness package on file',
      description: 'Verify IRB approval, signed delegation log, lab manual, pharmacy manual are current.',
      phase: 'pre_visit',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '5.1 Site readiness',
        protocol_page: 18,
      },
    }),
    buildItem(visitTplId, 2, {
      label: 'Obtain written informed consent',
      description: 'Use the current ICF version. File signed copies in regulatory binder; give participant a copy.',
      phase: 'check_in',
      classification: 'required',
      role_hint: 'Investigator',
      source_fields: [
        { field_label: 'ICF version', field_type: 'text', units: null, normal_range: null, is_required: true },
        { field_label: 'Date signed', field_type: 'date', units: null, normal_range: null, is_required: true },
      ],
      traceability: {
        protocol_section: '6.1 Informed consent',
        protocol_page: 22,
        soa_column: 'V1',
      },
    }),
    buildItem(visitTplId, 3, {
      label: 'Eligibility review against inclusion / exclusion criteria',
      description: 'Walk through all 14 inclusion and 19 exclusion criteria. Document any borderline calls in the source.',
      phase: 'assessment',
      classification: 'required',
      role_hint: 'Investigator',
      source_fields: [
        { field_label: 'All inclusion met', field_type: 'boolean', units: null, normal_range: null, is_required: true },
        { field_label: 'Any exclusion met', field_type: 'boolean', units: null, normal_range: null, is_required: true },
      ],
      traceability: {
        protocol_section: '4.1 Inclusion criteria',
        protocol_page: 12,
      },
    }),
    buildItem(visitTplId, 4, {
      label: 'Collect full medical history',
      phase: 'assessment',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '7.1.1 Medical history',
        protocol_page: 25,
      },
    }),
    buildItem(visitTplId, 5, {
      label: 'Baseline chemistry & hematology panel',
      phase: 'assessment',
      classification: 'required',
      timing: {
        label: 'Specimen must be drawn fasting (≥ 8 hr)',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: true,
        source_section: 'Lab Manual §3.2',
      },
      source_fields: [
        { field_label: 'Fasting status', field_type: 'boolean', units: null, normal_range: null, is_required: true },
        { field_label: 'Draw time', field_type: 'date', units: null, normal_range: null, is_required: true },
      ],
      role_hint: 'Nurse / Phlebotomy',
      traceability: {
        protocol_section: '7.2 Laboratory assessments',
        protocol_page: 27,
        soa_column: 'V1',
        cross_reference_source_section: 'Lab Manual §3.2',
        cross_reference_page: 14,
        cross_reference_snippet:
          'Baseline chemistry panel must be drawn at fasting; specimen integrity is verified before centrifugation.',
      },
    }),
    buildItem(visitTplId, 6, {
      label: 'Urine pregnancy test',
      phase: 'assessment',
      classification: 'conditional',
      conditions: [
        {
          condition_text: 'Female participant of childbearing potential',
          consequence_text:
            'Perform urine β-hCG. A positive or indeterminate result is an exclusion — do not proceed to dosing visit.',
          source_section: '4.2.7 Exclusion criteria',
          source_page: 14,
        },
      ],
      role_hint: 'Nurse',
      traceability: {
        protocol_section: '7.2.4 Pregnancy testing',
        protocol_page: 30,
      },
    }),
    buildItem(visitTplId, 7, {
      label: 'Document concomitant medications',
      phase: 'safety_ae_conmed',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '7.5 Prior & concomitant medications',
        protocol_page: 34,
      },
    }),
    buildItem(visitTplId, 8, {
      label: 'Schedule Day 1 baseline visit',
      description: 'Within 14 days of screening date. Confirm fasting & timing instructions with participant.',
      phase: 'close_out',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '6.2 Visit schedule',
        protocol_page: 24,
      },
    }),
  ];
}

function brighten2BaselineItems(visitTplId: string): VisitExecutionItem[] {
  return [
    buildItem(visitTplId, 1, {
      label: 'Confirm overnight fast and timing',
      description: 'Ask participant: time of last meal, last fluid intake. Document any deviation.',
      phase: 'pre_visit',
      classification: 'required',
      role_hint: 'Coordinator',
      source_fields: [
        { field_label: 'Last meal time', field_type: 'date', units: null, normal_range: null, is_required: true },
      ],
      traceability: {
        protocol_section: '7.2 Laboratory assessments',
        protocol_page: 27,
      },
    }),
    buildItem(visitTplId, 2, {
      label: 'Pre-dose vital signs',
      phase: 'check_in',
      classification: 'safety_critical',
      timing: {
        label: 'Within 30 minutes prior to dosing',
        window_before_minutes: 30,
        window_after_minutes: 0,
        is_hard_constraint: true,
        source_section: '7.4 Safety monitoring',
      },
      source_fields: [
        { field_label: 'Systolic BP', field_type: 'number', units: 'mmHg', normal_range: '90-140', is_required: true },
        { field_label: 'Diastolic BP', field_type: 'number', units: 'mmHg', normal_range: '60-90', is_required: true },
        { field_label: 'Heart rate', field_type: 'number', units: 'bpm', normal_range: '50-100', is_required: true },
        { field_label: 'Temperature', field_type: 'number', units: '°C', normal_range: '36.0-37.5', is_required: true },
      ],
      role_hint: 'Nurse',
      traceability: {
        protocol_section: '7.4.1 Vital signs',
        protocol_page: 32,
        soa_column: 'V2',
        cross_reference_source_section: '7.4 Safety monitoring',
        cross_reference_page: 27,
        cross_reference_snippet:
          'On Day 1, vital signs must be recorded prior to dosing and again 60 minutes post-dose.',
      },
    }),
    buildItem(visitTplId, 3, {
      label: 'Pre-treatment 12-lead ECG',
      phase: 'check_in',
      classification: 'primary_endpoint',
      timing: {
        label: 'Within 60 minutes prior to dosing',
        window_before_minutes: 60,
        window_after_minutes: 0,
        is_hard_constraint: true,
        source_section: '7.4.2 Cardiac monitoring',
      },
      role_hint: 'Nurse / Cardiology',
      traceability: {
        protocol_section: '7.4.2 Cardiac monitoring',
        protocol_page: 33,
        soa_column: 'V2',
      },
    }),
    buildItem(visitTplId, 4, {
      label: 'Baseline chemistry & hematology',
      phase: 'check_in',
      classification: 'required',
      timing: {
        label: 'Fasting specimen; before dosing',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: true,
        source_section: 'Lab Manual §3.2',
      },
      role_hint: 'Phlebotomy',
      traceability: {
        protocol_section: '7.2 Laboratory assessments',
        protocol_page: 27,
        soa_column: 'V2',
      },
    }),
    buildItem(visitTplId, 5, {
      label: 'Verify negative pregnancy test on file',
      phase: 'assessment',
      classification: 'conditional',
      conditions: [
        {
          condition_text: 'Female participant of childbearing potential',
          consequence_text:
            'Pregnancy test from screening must be negative AND less than 7 days old. If older, repeat urine β-hCG before dosing.',
          source_section: '4.2.7 Exclusion criteria',
          source_page: 14,
        },
      ],
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '7.2.4 Pregnancy testing',
        protocol_page: 30,
      },
    }),
    buildItem(visitTplId, 6, {
      label: 'PRO questionnaire battery (baseline)',
      description: 'PHQ-9, GAD-7, EQ-5D-5L. Participant completes on tablet before dosing.',
      phase: 'assessment',
      classification: 'primary_endpoint',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '7.3 Patient-reported outcomes',
        protocol_page: 31,
        soa_column: 'V2',
      },
    }),
    buildItem(visitTplId, 7, {
      label: 'Dispense study drug — first 7-day supply',
      phase: 'dosing',
      classification: 'required',
      timing: {
        label: 'Witness first dose on-site after all pre-dose assessments complete',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: true,
        source_section: 'Pharmacy Manual §5',
      },
      source_fields: [
        { field_label: 'Drug kit ID', field_type: 'text', units: null, normal_range: null, is_required: true },
        { field_label: 'First dose time', field_type: 'date', units: null, normal_range: null, is_required: true },
        { field_label: 'Witnessed by', field_type: 'text', units: null, normal_range: null, is_required: true },
      ],
      role_hint: 'Pharmacist + Coordinator',
      traceability: {
        protocol_section: '8.1 Study drug dispensation',
        protocol_page: 38,
        soa_column: 'V2',
        cross_reference_source_section: 'Pharmacy Manual §5',
        cross_reference_page: 9,
        cross_reference_snippet:
          'At each scheduled visit through Week 12, dispense the next 7-day study drug supply and reconcile the returned bottle.',
      },
    }),
    buildItem(visitTplId, 8, {
      label: 'Post-dose vital signs',
      phase: 'post_dose',
      classification: 'safety_critical',
      timing: {
        label: '60 minutes (± 5 min) after first dose',
        window_before_minutes: 5,
        window_after_minutes: 5,
        is_hard_constraint: true,
        source_section: '7.4 Safety monitoring',
      },
      source_fields: [
        { field_label: 'Systolic BP', field_type: 'number', units: 'mmHg', normal_range: '90-140', is_required: true },
        { field_label: 'Diastolic BP', field_type: 'number', units: 'mmHg', normal_range: '60-90', is_required: true },
        { field_label: 'Heart rate', field_type: 'number', units: 'bpm', normal_range: '50-100', is_required: true },
      ],
      role_hint: 'Nurse',
      traceability: {
        protocol_section: '7.4.1 Vital signs',
        protocol_page: 32,
      },
    }),
    buildItem(visitTplId, 9, {
      label: 'Adverse event check (60 min post-dose)',
      phase: 'safety_ae_conmed',
      classification: 'safety_critical',
      role_hint: 'Nurse',
      traceability: {
        protocol_section: '9.1 Adverse event reporting',
        protocol_page: 42,
      },
    }),
    buildItem(visitTplId, 10, {
      label: 'Schedule Week 1 visit',
      phase: 'close_out',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: {
        protocol_section: '6.2 Visit schedule',
        protocol_page: 24,
      },
    }),
  ];
}

function brighten2WeeklyItems(visitTplId: string, weekNumber: number): VisitExecutionItem[] {
  return [
    buildItem(visitTplId, 1, {
      label: 'Confirm participant identity and consent still in effect',
      phase: 'pre_visit',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: { protocol_section: '6.1 Informed consent', protocol_page: 22 },
    }),
    buildItem(visitTplId, 2, {
      label: 'Vital signs',
      phase: 'check_in',
      classification: 'required',
      source_fields: [
        { field_label: 'Systolic BP', field_type: 'number', units: 'mmHg', normal_range: '90-140', is_required: true },
        { field_label: 'Diastolic BP', field_type: 'number', units: 'mmHg', normal_range: '60-90', is_required: true },
        { field_label: 'Heart rate', field_type: 'number', units: 'bpm', normal_range: '50-100', is_required: true },
      ],
      role_hint: 'Nurse',
      traceability: { protocol_section: '7.4.1 Vital signs', protocol_page: 32, soa_column: `V${weekNumber + 2}` },
    }),
    buildItem(visitTplId, 3, {
      label: 'Concomitant medication review',
      phase: 'safety_ae_conmed',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: { protocol_section: '7.5 Prior & concomitant medications', protocol_page: 34 },
    }),
    buildItem(visitTplId, 4, {
      label: 'Adverse event interview',
      phase: 'safety_ae_conmed',
      classification: 'safety_critical',
      role_hint: 'Investigator',
      traceability: { protocol_section: '9.1 Adverse event reporting', protocol_page: 42 },
    }),
    buildItem(visitTplId, 5, {
      label: 'Chemistry & hematology panel',
      phase: 'assessment',
      classification: 'required',
      timing: {
        label: 'Non-fasting OK from Week 1 onward',
        window_before_minutes: null,
        window_after_minutes: null,
        is_hard_constraint: false,
        source_section: 'Lab Manual §3.3',
      },
      role_hint: 'Phlebotomy',
      traceability: { protocol_section: '7.2 Laboratory assessments', protocol_page: 27, soa_column: `V${weekNumber + 2}` },
    }),
    ...(weekNumber >= 4
      ? [
          buildItem(visitTplId, 6, {
            label: 'PRO questionnaire battery',
            phase: 'assessment',
            classification: 'primary_endpoint',
            role_hint: 'Coordinator',
            traceability: {
              protocol_section: '7.3 Patient-reported outcomes',
              protocol_page: 31,
              soa_column: `V${weekNumber + 2}`,
            },
          }),
        ]
      : []),
    buildItem(visitTplId, 7, {
      label: 'Drug accountability — count returned, dispense next supply',
      phase: 'dosing',
      classification: 'required',
      source_fields: [
        { field_label: 'Tablets returned', field_type: 'number', units: 'count', normal_range: null, is_required: true },
        { field_label: 'New kit ID', field_type: 'text', units: null, normal_range: null, is_required: true },
      ],
      role_hint: 'Pharmacist',
      traceability: {
        protocol_section: '8.2 Drug accountability',
        protocol_page: 39,
        cross_reference_source_section: 'Pharmacy Manual §5',
        cross_reference_page: 9,
        cross_reference_snippet:
          'At each scheduled visit through Week 12, dispense the next 7-day study drug supply and reconcile the returned bottle.',
      },
    }),
    buildItem(visitTplId, 8, {
      label: `Schedule next visit (Week ${weekNumber + 1})`,
      phase: 'close_out',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: { protocol_section: '6.2 Visit schedule', protocol_page: 24 },
    }),
  ];
}

function brighten2EndOfStudyItems(visitTplId: string): VisitExecutionItem[] {
  return [
    buildItem(visitTplId, 1, {
      label: 'Confirm participant still consents to final visit',
      phase: 'pre_visit',
      classification: 'required',
      role_hint: 'Coordinator',
      traceability: { protocol_section: '6.1 Informed consent', protocol_page: 22 },
    }),
    buildItem(visitTplId, 2, {
      label: 'Final vital signs',
      phase: 'check_in',
      classification: 'required',
      role_hint: 'Nurse',
      traceability: { protocol_section: '7.4.1 Vital signs', protocol_page: 32, soa_column: 'V12' },
    }),
    buildItem(visitTplId, 3, {
      label: 'Final chemistry & hematology panel',
      phase: 'assessment',
      classification: 'required',
      role_hint: 'Phlebotomy',
      traceability: { protocol_section: '7.2 Laboratory assessments', protocol_page: 27, soa_column: 'V12' },
    }),
    buildItem(visitTplId, 4, {
      label: 'Final PRO questionnaire battery',
      phase: 'assessment',
      classification: 'primary_endpoint',
      role_hint: 'Coordinator',
      traceability: { protocol_section: '7.3 Patient-reported outcomes', protocol_page: 31, soa_column: 'V12' },
    }),
    buildItem(visitTplId, 5, {
      label: 'Final adverse event interview',
      phase: 'safety_ae_conmed',
      classification: 'safety_critical',
      role_hint: 'Investigator',
      traceability: { protocol_section: '9.1 Adverse event reporting', protocol_page: 42 },
    }),
    buildItem(visitTplId, 6, {
      label: 'Drug accountability final reconciliation',
      phase: 'dosing',
      classification: 'required',
      source_fields: [
        { field_label: 'Tablets returned', field_type: 'number', units: 'count', normal_range: null, is_required: true },
        { field_label: 'Tablets unaccounted', field_type: 'number', units: 'count', normal_range: '0', is_required: true },
      ],
      role_hint: 'Pharmacist',
      traceability: { protocol_section: '8.2 Drug accountability', protocol_page: 39 },
    }),
    buildItem(visitTplId, 7, {
      label: 'Exit interview & discharge counseling',
      description: 'Discuss any post-study care needs, hand off to standard-of-care if applicable.',
      phase: 'close_out',
      classification: 'required',
      role_hint: 'Investigator',
      traceability: { protocol_section: '6.3 Study completion', protocol_page: 26 },
    }),
    buildItem(visitTplId, 8, {
      label: 'Post-study safety follow-up — schedule if needed',
      phase: 'close_out',
      classification: 'if_applicable',
      conditions: [
        {
          condition_text: 'Active or unresolved AE at end of treatment',
          consequence_text:
            'Schedule a 30-day post-treatment safety contact (phone or in-person) until resolution or stabilization.',
          source_section: '9.2 Safety follow-up',
          source_page: 44,
        },
      ],
      role_hint: 'Coordinator',
      traceability: { protocol_section: '9.2 Safety follow-up', protocol_page: 44 },
    }),
  ];
}


// ---------------------------------------------------------------------------
// BRIGHTEN-2 visit purpose strings.
// ---------------------------------------------------------------------------

const BRIGHTEN2_PURPOSES: Record<string, string> = {
  Screening:
    'Confirm eligibility, obtain consent, and capture the baseline data needed before the participant can be enrolled.',
  'Day 1 baseline':
    'Establish pre-treatment baseline, dispense the first study drug supply, and observe the first dose under direct supervision.',
  'Week 1 visit':
    'First post-dose safety and tolerability check. Reconcile drug accountability and dispense the next supply.',
  'Week 2 visit':
    'Routine safety follow-up. Lab panel, AE review, and continued drug accountability.',
  'Week 6 visit':
    'Mid-treatment efficacy assessment. PRO questionnaires alongside the usual safety battery.',
  'End of study':
    'Final assessments, drug reconciliation, and discharge. Post-study safety follow-up scheduled if AE-driven.',
};


// ---------------------------------------------------------------------------
// Build all BRIGHTEN-2 workspaces.
// ---------------------------------------------------------------------------

/**
 * Sprint 3.5a fixture seed: one pending completeness signal on the Week 6
 * visit. Exercises the new VisitCompletenessSignal type through the mock
 * path so UI work can build against realistic shapes before 3.5b ingest
 * starts populating real signals. Other visits ship with empty arrays —
 * not every visit has a detected gap.
 */
function brighten2CompletenessSignalsFor(
  visitName: string,
): VisitCompletenessSignal[] {
  if (visitName !== 'Week 6 visit') {
    return [];
  }
  // Relative-to-now so the fixture doesn't go stale as time passes. ~7 days
  // ago gives the gap a realistic "recently detected, not yet acted on" feel.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  return [
    {
      id: 'mock-signal-week6-bodyweight',
      gap_text:
        'Body weight measurement appears required at mid-treatment efficacy visits ' +
        'but no procedure was extracted for this visit.',
      source_section: '7.4.1 Vital signs',
      source_page: 32,
      detection_confidence: 'medium',
      detection_reason:
        'Section 7.4.1 lists weight under "ongoing vital-sign assessments" but ' +
        'this visit has no matching procedures_structured row.',
      detected_at: sevenDaysAgo,
    },
  ];
}

/**
 * Sprint 3.5a fixture seed: confidence_state varies a bit so the snapshot
 * card has something to render when the field is wired up. Defaults to
 * 'high' for clinic-curated visits, lower for visits where the LLM would
 * realistically have to interpret more loosely-structured protocol prose.
 */
function brighten2ConfidenceFor(visitName: string): VisitConfidenceState {
  if (visitName === 'Week 6 visit') return 'medium';
  if (visitName === 'End of study') return 'medium';
  return 'high';
}

function buildBrighten2Workspaces(): VisitExecutionWorkspace[] {
  const protocolId = DEMO_PROTOCOL_IDS['BRIGHTEN-2'];
  const templates = getDemoVisitTemplates().filter((t) => t.protocol_id === protocolId);

  return templates.map((tpl) => {
    let items: VisitExecutionItem[];
    if (tpl.visit_name === 'Screening') {
      items = brighten2ScreeningItems(tpl.id);
    } else if (tpl.visit_name === 'Day 1 baseline') {
      items = brighten2BaselineItems(tpl.id);
    } else if (tpl.visit_name === 'Week 1 visit') {
      items = brighten2WeeklyItems(tpl.id, 1);
    } else if (tpl.visit_name === 'Week 2 visit') {
      items = brighten2WeeklyItems(tpl.id, 2);
    } else if (tpl.visit_name === 'Week 6 visit') {
      items = brighten2WeeklyItems(tpl.id, 6);
    } else if (tpl.visit_name === 'End of study') {
      items = brighten2EndOfStudyItems(tpl.id);
    } else {
      items = [];
    }

    const snapshot = deriveSnapshot(
      tpl.visit_name,
      tpl.study_day,
      tpl.window_minus_days,
      tpl.window_plus_days,
      BRIGHTEN2_PURPOSES[tpl.visit_name] ??
        'Per-protocol visit with assessments per Schedule of Events.',
      items,
      brighten2CompletenessSignalsFor(tpl.visit_name),
      brighten2ConfidenceFor(tpl.visit_name),
    );

    return {
      visit_template_id: tpl.id,
      protocol_id: tpl.protocol_id,
      snapshot,
      items,
    };
  });
}


// ---------------------------------------------------------------------------
// Public entry point. Returns Sprint 1 mock workspaces for the active
// protocol. For non-BRIGHTEN-2 protocols, returns an empty array — the
// real adapter handles those (flat passthrough from procedures TEXT[]).
// ---------------------------------------------------------------------------

export function getMockVisitExecutionWorkspaces(
  protocolId: string,
): VisitExecutionWorkspace[] {
  if (protocolId === DEMO_PROTOCOL_IDS['BRIGHTEN-2']) {
    return buildBrighten2Workspaces();
  }
  return [];
}
