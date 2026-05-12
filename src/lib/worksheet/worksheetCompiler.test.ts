// Vitest tests for the worksheet compiler.
// Fixtures are shaped after the real CLR-18-06 extract output from Sprint 1A.
// Tests verify deterministic behavior — no mocks, no async, no network.

import { describe, it, expect } from 'vitest';
import { compileWorksheet, COMPILER_VERSION } from './worksheetCompiler';
import type { CompilerInput } from './worksheetCompiler';
import type { ProtocolVisitTemplate } from '../site/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_DOC_ID = 'doc-clr-18-06';
const BASE_PROTOCOL_VERSION_ID = 'proto-v1';

const DEFAULT_SCHEDULE: unknown[] = [
  // Source B: inline section headers — window values correct
  { visit_name: 'Baseline (Visit 1)', study_day: 1, window_minus_days: 0, window_plus_days: 0, schedule_variant: null },
  { visit_name: 'Visit 2 (Week 2)', study_day: 14, window_minus_days: 3, window_plus_days: 3, schedule_variant: null },
  { visit_name: 'Visit 3 (Week 6)', study_day: 42, window_minus_days: 7, window_plus_days: 7, schedule_variant: null },
  // Source A: SOA table rows — window=0, with schedule_variant
  { visit_name: 'Baseline (Visit 1)', study_day: 1, window_minus_days: 0, window_plus_days: 0, schedule_variant: 'All Subjects' },
  { visit_name: 'Visit 2 (Week 2)', study_day: 14, window_minus_days: 0, window_plus_days: 0, schedule_variant: 'All Subjects' },
  { visit_name: 'Visit 3 (Week 6)', study_day: 42, window_minus_days: 0, window_plus_days: 0, schedule_variant: 'All Subjects' },
];

const DEFAULT_TEMPLATES: ProtocolVisitTemplate[] = [
  {
    id: 't1', protocol_id: 'p1',
    visit_name: 'Baseline (Visit 1)', study_day: 1, window_minus_days: 0, window_plus_days: 0,
    procedures: ['Informed consent', 'Vital signs', 'Blood draw'],
    source_document_id: BASE_DOC_ID, cross_references: [],
  },
  {
    id: 't2', protocol_id: 'p1',
    visit_name: 'Visit 2 (Week 2)', study_day: 14, window_minus_days: 3, window_plus_days: 3,
    procedures: ['Vital signs', 'ECG', 'Tumor assessment'],
    source_document_id: BASE_DOC_ID, cross_references: [],
  },
  {
    id: 't3', protocol_id: 'p1',
    visit_name: 'Visit 3 (Week 6)', study_day: 42, window_minus_days: 7, window_plus_days: 7,
    procedures: ['Vital signs', 'Blood draw for PK', 'QoL questionnaire'],
    source_document_id: BASE_DOC_ID, cross_references: [],
  },
];

function makeInput(opts: {
  extractedFields?: Record<string, unknown> | null;
  scheduleOverride?: unknown[];
  visitTemplates?: ProtocolVisitTemplate[];
  sourceDocuments?: CompilerInput['sourceDocuments'];
  protocolVersionId?: string;
} = {}): CompilerInput {
  const schedule = opts.scheduleOverride !== undefined ? opts.scheduleOverride : DEFAULT_SCHEDULE;

  const fields: Record<string, unknown> = opts.extractedFields !== undefined
    ? (opts.extractedFields ?? {})
    : {
        protocol_title: 'A Phase II Study of CLR-001',
        protocol_number: 'CLR_18_06',
        sponsor_name: 'ClearPath Therapeutics',
        study_phase: 'Phase II',
        is_amendment: false,
        amendment_summary: null,
        primary_endpoints: ['Overall response rate at Week 24'],
        secondary_endpoints: ['Progression-free survival'],
        key_inclusion_criteria: ['Age ≥ 18 years', 'ECOG PS 0-1'],
        key_exclusion_criteria: ['Prior anti-CLR therapy'],
        schedule_of_events: schedule,
      };

  return {
    protocolVersionId: opts.protocolVersionId ?? BASE_PROTOCOL_VERSION_ID,
    documentId: BASE_DOC_ID,
    documentTitle: 'CLR-18-06 Protocol v1.0',
    extractedFields: fields,
    visitTemplates: opts.visitTemplates ?? DEFAULT_TEMPLATES,
    sourceDocuments: opts.sourceDocuments ?? [
      {
        document_id: BASE_DOC_ID,
        document_title: 'CLR-18-06 Protocol v1.0',
        document_status: 'processed',
        included_at: '2026-05-12T00:00:00.000Z',
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compileWorksheet', () => {
  describe('bundle envelope', () => {
    it('returns the correct bundle_version and compiler_version', () => {
      const bundle = compileWorksheet(makeInput());
      expect(bundle.bundle_version).toBe('1.0');
      expect(bundle.compiler_version).toBe(COMPILER_VERSION);
    });

    it('sets protocol_version_id from input', () => {
      const bundle = compileWorksheet(makeInput());
      expect(bundle.protocol_version_id).toBe(BASE_PROTOCOL_VERSION_ID);
    });

    it('sets compiled_at to a valid ISO 8601 timestamp', () => {
      const bundle = compileWorksheet(makeInput());
      expect(() => new Date(bundle.compiled_at)).not.toThrow();
      expect(new Date(bundle.compiled_at).toISOString()).toBe(bundle.compiled_at);
    });
  });

  describe('protocol metadata', () => {
    it('populates title, study_number, sponsor from extractedFields', () => {
      const bundle = compileWorksheet(makeInput());
      expect(bundle.protocol.title).toMatchObject({ value: 'A Phase II Study of CLR-001' });
      expect(bundle.protocol.study_number).toMatchObject({ value: 'CLR_18_06' });
      expect(bundle.protocol.sponsor_name).toMatchObject({ value: 'ClearPath Therapeutics' });
    });

    it('returns null MaybeCited when protocol_title is absent', () => {
      const bundle = compileWorksheet(makeInput({
        extractedFields: { protocol_number: 'CLR_18_06' },
        visitTemplates: [],
      }));
      expect(bundle.protocol.title.value).toBeNull();
      if (bundle.protocol.title.value === null) {
        expect(bundle.protocol.title.reason).toBe('not_found_in_extract');
      }
    });

    it('records missing title in qa_ledger.missing_fields', () => {
      const bundle = compileWorksheet(makeInput({
        extractedFields: { protocol_number: 'CLR_18_06' },
        visitTemplates: [],
      }));
      const missing = bundle.qa_ledger.missing_fields.find(f => f.field_path === 'protocol.title');
      expect(missing).toBeDefined();
      expect(missing?.recoverable).toBe(false);
    });

    it('sets is_amendment false when absent', () => {
      const bundle = compileWorksheet(makeInput());
      expect(bundle.protocol.is_amendment).toBe(false);
    });
  });

  describe('objectives', () => {
    it('maps primary and secondary endpoints to ObjectiveEntry[]', () => {
      const bundle = compileWorksheet(makeInput());
      const primary = bundle.objectives.filter(o => o.objective_type === 'primary');
      const secondary = bundle.objectives.filter(o => o.objective_type === 'secondary');
      expect(primary).toHaveLength(1);
      expect(secondary).toHaveLength(1);
      expect(primary[0].text.value).toBe('Overall response rate at Week 24');
    });

    it('tier is null in Sprint 1B (pending Sprint 1C linkage)', () => {
      const bundle = compileWorksheet(makeInput());
      for (const obj of bundle.objectives) {
        expect(obj.tier.value).toBeNull();
      }
    });
  });

  describe('eligibility', () => {
    it('populates inclusion and exclusion from extractedFields', () => {
      const bundle = compileWorksheet(makeInput());
      expect(bundle.eligibility.inclusion).toHaveLength(2);
      expect(bundle.eligibility.exclusion).toHaveLength(1);
      expect(bundle.eligibility.inclusion[0].value).toBe('Age ≥ 18 years');
    });
  });

  describe('deduplication — Source B wins over Source A', () => {
    it('produces one visit entry per unique visit_name', () => {
      const bundle = compileWorksheet(makeInput());
      // 3 unique visits × 2 sources each = 6 raw entries → 3 deduped
      expect(bundle.visits).toHaveLength(3);
    });

    it('prefers Source B (window > 0) window values', () => {
      const bundle = compileWorksheet(makeInput());
      const v2 = bundle.visits.find(v => v.visit_name.value === 'Visit 2 (Week 2)');
      expect(v2?.window_minus_days.value).toBe(3);
      expect(v2?.window_plus_days.value).toBe(3);
    });

    it('preserves schedule_variant from Source A entries', () => {
      const bundle = compileWorksheet(makeInput());
      const v2 = bundle.visits.find(v => v.visit_name.value === 'Visit 2 (Week 2)');
      expect(v2?.schedule_variant).toBe('All Subjects');
    });

    it('logs a DeduplicationEvent per visit with winning_source = inline_section', () => {
      const bundle = compileWorksheet(makeInput());
      const dupEvents = bundle.qa_ledger.deduplication_events.filter(
        d => d.winning_source === 'inline_section'
      );
      expect(dupEvents).toHaveLength(3);
      expect(dupEvents[0].sources_found).toBe(2);
    });
  });

  describe('deduplication — discrepancy detection', () => {
    it('generates a DiscrepancyEvent when Source A and Source B have conflicting non-zero study_days', () => {
      const conflictingSchedule = [
        // Source B: study_day=14, window=3
        { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3, schedule_variant: null },
        // Source A: study_day=15 (conflict!), window=0
        { visit_name: 'Visit 2', study_day: 15, window_minus_days: 0, window_plus_days: 0, schedule_variant: 'All Subjects' },
      ];
      const bundle = compileWorksheet(makeInput({ scheduleOverride: conflictingSchedule, visitTemplates: [] }));
      const discrepancy = bundle.qa_ledger.discrepancy_events.find(
        d => d.field === 'study_day' && d.visit_name === 'Visit 2'
      );
      expect(discrepancy).toBeDefined();
      expect(discrepancy?.source_a_value).toBe(15);
      expect(discrepancy?.source_b_value).toBe(14);
      expect(discrepancy?.winning_value).toBe(14);
    });

    it('generates a DiscrepancyEvent when both sources have non-zero window_minus_days that differ', () => {
      const conflictingSchedule = [
        { visit_name: 'Visit 3', study_day: 42, window_minus_days: 7, window_plus_days: 7, schedule_variant: null },
        { visit_name: 'Visit 3', study_day: 42, window_minus_days: 5, window_plus_days: 7, schedule_variant: 'All Subjects' },
      ];
      const bundle = compileWorksheet(makeInput({ scheduleOverride: conflictingSchedule, visitTemplates: [] }));
      const discrepancy = bundle.qa_ledger.discrepancy_events.find(
        d => d.field === 'window_minus_days' && d.visit_name === 'Visit 3'
      );
      expect(discrepancy).toBeDefined();
      expect(discrepancy?.source_a_value).toBe(5);
      expect(discrepancy?.source_b_value).toBe(7);
    });

    it('does NOT generate a DiscrepancyEvent when Source A window=0 and Source B window=3 (normal case)', () => {
      const bundle = compileWorksheet(makeInput()); // default fixture has this pattern
      const windowDiscrepancies = bundle.qa_ledger.discrepancy_events.filter(
        d => d.field === 'window_minus_days' || d.field === 'window_plus_days'
      );
      expect(windowDiscrepancies).toHaveLength(0);
    });
  });

  describe('procedures (Q5: from protocol_visit_templates)', () => {
    it('populates procedures from matching template', () => {
      const bundle = compileWorksheet(makeInput());
      const v2 = bundle.visits.find(v => v.visit_name.value === 'Visit 2 (Week 2)');
      expect(v2?.procedures.map(p => p.label)).toEqual(['Vital signs', 'ECG', 'Tumor assessment']);
    });

    it('criticality_ref is null for all procedures in Sprint 1B', () => {
      const bundle = compileWorksheet(makeInput());
      for (const visit of bundle.visits) {
        for (const proc of visit.procedures) {
          expect(proc.criticality_ref).toBeNull();
        }
      }
    });

    it('logs missing_field when no template matches a deduped visit', () => {
      const bundle = compileWorksheet(makeInput({ visitTemplates: [] }));
      // All 3 visits have no template match
      const procMissing = bundle.qa_ledger.missing_fields.filter(
        f => f.field_path.includes('procedures')
      );
      expect(procMissing.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('fallback to templates when no raw schedule', () => {
    it('builds visits from templates when schedule_of_events is absent', () => {
      const bundle = compileWorksheet(makeInput({
        extractedFields: { protocol_title: 'Test', protocol_number: 'X-01' },
      }));
      expect(bundle.visits).toHaveLength(3); // from default templates
      expect(bundle.visits[0].visit_name.value).toBe('Baseline (Visit 1)');
    });

    it('logs template_only dedup event when falling back', () => {
      const bundle = compileWorksheet(makeInput({
        extractedFields: { protocol_title: 'Test', protocol_number: 'X-01' },
      }));
      const templateEvent = bundle.qa_ledger.deduplication_events.find(
        d => d.winning_source === 'template_only'
      );
      expect(templateEvent).toBeDefined();
    });

    it('records missing_field for window values when using template fallback', () => {
      const bundle = compileWorksheet(makeInput({
        extractedFields: { protocol_title: 'Test', protocol_number: 'X-01' },
      }));
      const windowMissing = bundle.qa_ledger.missing_fields.find(
        f => f.field_path.includes('window_*_days')
      );
      expect(windowMissing).toBeDefined();
      expect(windowMissing?.recoverable).toBe(true);
    });
  });

  describe('SOA-only visits (no inline section)', () => {
    it('flags window=0 as low_confidence when winning source is soa_table', () => {
      const soaOnlySchedule = [
        { visit_name: 'Screening', study_day: -14, window_minus_days: 0, window_plus_days: 0, schedule_variant: 'All Subjects' },
      ];
      const bundle = compileWorksheet(makeInput({
        scheduleOverride: soaOnlySchedule,
        visitTemplates: [],
      }));
      const lowConf = bundle.qa_ledger.low_confidence_fields.find(
        f => f.field_path.includes('Screening')
      );
      expect(lowConf).toBeDefined();
    });
  });

  describe('empty inputs', () => {
    it('returns a valid bundle with all-null protocol metadata when extractedFields is null', () => {
      const bundle = compileWorksheet(makeInput({ extractedFields: null, visitTemplates: [] }));
      expect(bundle.protocol.title.value).toBeNull();
      expect(bundle.protocol.study_number.value).toBeNull();
      expect(bundle.visits).toHaveLength(0);
    });

    it('qa_ledger.missing_fields is populated when extractedFields is null', () => {
      const bundle = compileWorksheet(makeInput({ extractedFields: null, visitTemplates: [] }));
      expect(bundle.qa_ledger.missing_fields.length).toBeGreaterThan(0);
    });
  });
});
