import { describe, it, expect } from 'vitest';
import { mapReductoExtractToSotr, dedupeVisitArray } from '../sourceEvidenceAdapter';
import type { ReductoExtractResponse } from '../../../types/sotr';

const DOC_ID  = 'doc-test-00000000-0000-0000-0000-000000000001';
const RUN_ID  = 'job-reducto-abc123';

describe('mapReductoExtractToSotr', () => {
  // -------------------------------------------------------------------------
  // T1 — Full citation: creates a source evidence record
  // -------------------------------------------------------------------------
  it('creates a source evidence record from a fully-cited extraction', () => {
    const input: ReductoExtractResponse = {
      protocol_title: 'STUDY-001 Protocol v2',
      _reducto_citations: {
        protocol_title: {
          text: 'Study STUDY-001 — A Phase II trial of Compound X',
          pages: [1],
          confidence: 'high',
          section: 'Cover Page',
        },
      },
    };

    const { items, evidence, links } = mapReductoExtractToSotr(DOC_ID, input, RUN_ID);

    expect(items).toHaveLength(1);
    expect(evidence).toHaveLength(1);
    expect(links).toHaveLength(1);

    expect(evidence[0].page_number).toBe(1);
    expect(evidence[0].section_title).toBe('Cover Page');
    expect(evidence[0].support_type).toBe('primary');
    expect(evidence[0].confidence_score).toBe(0.9);
    expect(evidence[0].extraction_run_id).toBe(RUN_ID);
    expect(evidence[0].document_id).toBe(DOC_ID);

    expect(items[0].confidence_state).toBe('high');
    expect(items[0].missing_source_reason).toBeNull();
    expect(items[0].field_type).toBe('metadata');
  });

  // -------------------------------------------------------------------------
  // T2 — Link integrity: item and evidence are connected via the links array
  // -------------------------------------------------------------------------
  it('links a source evidence record to a worksheet item via the links array', () => {
    const input: ReductoExtractResponse = {
      dosing_regimen: '10 mg/kg once daily oral',
      _reducto_citations: {
        dosing_regimen: {
          text: 'Patients will receive 10 mg/kg once daily by oral administration',
          pages: [8],
          confidence: 'high',
        },
      },
    };

    const { items, evidence, links } = mapReductoExtractToSotr(DOC_ID, input);

    expect(links).toHaveLength(1);

    const link = links[0];
    expect(link.is_primary_source).toBe(true);
    expect(items[link.item_index].field_path).toBe('dosing_regimen');
    expect(evidence[link.evidence_index].page_number).toBe(8);
  });

  // -------------------------------------------------------------------------
  // T3 — Multi-field: all CLINICAL_EXTRACT_SCHEMA field types are mapped
  // -------------------------------------------------------------------------
  it('maps parser output into source evidence records across multiple field types', () => {
    const input: ReductoExtractResponse = {
      primary_endpoints:      ['Change in PANSS score at week 24', 'Response rate at week 12'],
      key_inclusion_criteria: ['Age ≥ 18 years', 'Diagnosis of schizophrenia'],
      dosing_regimen:         '5 mg once daily',
      _reducto_citations: {
        primary_endpoints: [
          { text: 'Primary endpoint: PANSS total score change', pages: [5], confidence: 'high' },
          { text: 'Key secondary endpoint: response rate',      pages: [5], confidence: 'medium' },
        ],
        key_inclusion_criteria: [
          { text: 'Patients must be at least 18 years of age', pages: [10], confidence: 'high' },
          { text: 'DSM-5 diagnosis of schizophrenia',          pages: [10], confidence: 'high' },
        ],
        dosing_regimen: {
          text: '5 mg administered once daily', pages: [15], confidence: 'high',
        },
      },
    };

    const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input, RUN_ID);

    expect(items).toHaveLength(5);   // 2 endpoints + 2 criteria + 1 dosing
    expect(evidence).toHaveLength(5);

    const endpointItems = items.filter((i) => i.field_type === 'endpoint');
    expect(endpointItems).toHaveLength(2);
    expect(endpointItems[0].field_path).toBe('primary_endpoints[0]');
    expect(endpointItems[1].field_path).toBe('primary_endpoints[1]');

    const criterionItems = items.filter((i) => i.field_type === 'inclusion_criterion');
    expect(criterionItems).toHaveLength(2);

    const dosingItem = items.find((i) => i.field_path === 'dosing_regimen');
    expect(dosingItem?.field_type).toBe('dosing');
  });

  // -------------------------------------------------------------------------
  // T4 — Missing evidence: does not crash; stores needs_review + reason
  // -------------------------------------------------------------------------
  it('handles missing source evidence without crashing', () => {
    const input: ReductoExtractResponse = {
      sponsor_name: 'Acme Pharma Inc.',
      _reducto_citations: {}, // no citation for sponsor_name
    };

    expect(() => mapReductoExtractToSotr(DOC_ID, input)).not.toThrow();

    const { items, evidence, links } = mapReductoExtractToSotr(DOC_ID, input);

    expect(items).toHaveLength(1);
    expect(evidence).toHaveLength(0);   // no evidence row — nothing to store
    expect(links).toHaveLength(0);

    expect(items[0].confidence_state).toBe('needs_review');
    expect(items[0].missing_source_reason).toBe('parser_output_missing_citation');
  });

  it('handles a completely absent _reducto_citations key without crashing', () => {
    const input: ReductoExtractResponse = {
      protocol_number: 'XYZ-987',
      // no _reducto_citations key at all
    };

    expect(() => mapReductoExtractToSotr(DOC_ID, input)).not.toThrow();

    const { items } = mapReductoExtractToSotr(DOC_ID, input);
    expect(items[0].confidence_state).toBe('needs_review');
    expect(items[0].missing_source_reason).toBe('parser_output_missing_citation');
  });

  // -------------------------------------------------------------------------
  // T5 — Confidence state: correct state per citation completeness
  // -------------------------------------------------------------------------
  it('sets confidence state correctly based on citation completeness', () => {
    const input: ReductoExtractResponse = {
      protocol_number: 'ABC-001',
      protocol_title:  'A Study of Compound X',
      compound_name:   'Compound X',
      study_phase:     'Phase II',
      _reducto_citations: {
        protocol_number: { text: 'Protocol ABC-001',        pages: [1], confidence: 'high' },
        protocol_title:  { text: 'A Phase II study of...',  pages: [1], confidence: 'low'  },
        study_phase:     { text: 'Phase II open-label...', pages: [2], confidence: 'medium' },
        // compound_name has no citation entry → needs_review
      },
    };

    const { items } = mapReductoExtractToSotr(DOC_ID, input);

    const byPath = Object.fromEntries(items.map((i) => [i.field_path, i]));

    expect(byPath['protocol_number'].confidence_state).toBe('high');
    expect(byPath['protocol_title'].confidence_state).toBe('low');
    expect(byPath['study_phase'].confidence_state).toBe('medium');
    expect(byPath['compound_name'].confidence_state).toBe('needs_review');
    expect(byPath['compound_name'].missing_source_reason).toBe('parser_output_missing_citation');
  });

  it('marks needs_review when citation exists but has no source text', () => {
    const input: ReductoExtractResponse = {
      sponsor_name: 'Pharma Co.',
      _reducto_citations: {
        // Citation present but text field is absent
        sponsor_name: { pages: [1], confidence: 'high' },
      },
    };

    const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input);

    expect(items[0].confidence_state).toBe('needs_review');
    expect(items[0].missing_source_reason).toBe('source_text_not_found');
    // No evidence row — quoted_text is absent so there's nothing useful to store
    expect(evidence).toHaveLength(0);
  });

  it('marks needs_review when citation text exists but no pages are provided', () => {
    const input: ReductoExtractResponse = {
      compound_name: 'Drug X',
      _reducto_citations: {
        compound_name: { text: 'Drug X (INN)', confidence: 'high' }, // no pages field
      },
    };

    const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input);

    expect(items[0].confidence_state).toBe('needs_review');
    expect(items[0].missing_source_reason).toBe('coordinates_unavailable');
    // Evidence is still created because quoted_text is present — page is null
    expect(evidence).toHaveLength(1);
    expect(evidence[0].page_number).toBeNull();
  });

  // -------------------------------------------------------------------------
  // T6 — Multiple evidence records for one worksheet item (array field)
  // -------------------------------------------------------------------------
  it('stores multiple source evidence records — one per array element', () => {
    const input: ReductoExtractResponse = {
      primary_endpoints: ['Endpoint A', 'Endpoint B', 'Endpoint C'],
      _reducto_citations: {
        primary_endpoints: [
          { text: 'Endpoint A: change from baseline in...', pages: [5], confidence: 'high'   },
          { text: 'Endpoint B: proportion of subjects...', pages: [5], confidence: 'high'   },
          { text: 'Endpoint C: time to first response...',  pages: [6], confidence: 'medium' },
        ],
      },
    };

    const { items, evidence, links } = mapReductoExtractToSotr(DOC_ID, input);

    expect(items).toHaveLength(3);
    expect(evidence).toHaveLength(3);
    expect(links).toHaveLength(3);

    // Each item has exactly one evidence record linked to it
    links.forEach((link, i) => {
      expect(link.item_index).toBe(i);
      expect(link.evidence_index).toBe(i);
      expect(link.is_primary_source).toBe(true);
    });

    expect(items[2].confidence_state).toBe('medium');
    expect(evidence[2].page_number).toBe(6);
  });

  // -------------------------------------------------------------------------
  // T7 — Primary vs. context: adapter marks all Reducto citations as primary
  // -------------------------------------------------------------------------
  it('marks all Reducto-provided citations as primary support type', () => {
    // Context/conflict support types require explicit domain knowledge that the
    // parser alone cannot determine — they are set by callers, not the adapter.
    const input: ReductoExtractResponse = {
      study_design: 'Randomized, double-blind, placebo-controlled',
      _reducto_citations: {
        study_design: {
          text: 'This is a randomized, double-blind, placebo-controlled study',
          pages: [3],
          confidence: 'high',
        },
      },
    };

    const { evidence } = mapReductoExtractToSotr(DOC_ID, input);

    expect(evidence).toHaveLength(1);
    expect(evidence[0].support_type).toBe('primary');
  });

  // -------------------------------------------------------------------------
  // T8 — Visit deduplication: Source B (inline section) wins over Source A
  //      (SOA table) but Source A's citation is preserved as evidence.
  // -------------------------------------------------------------------------
  describe('schedule_of_events deduplication', () => {
    it('collapses two sources of the same visit into one item with both citations', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          // Source B — inline visit section, has window data
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
          // Source A — SOA table row, window=0
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0,
            schedule_variant: 'All Subjects' },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: '6.3.2 Visit 2 (Week 2, Day 14±3)', pages: [22], confidence: 'high' },
            { text: 'SOA: Visit 2 / Day 14',            pages: [98], confidence: 'medium' },
          ],
        },
      };

      const { items, evidence, links } = mapReductoExtractToSotr(DOC_ID, input);

      expect(items).toHaveLength(1);
      expect(items[0].field_path).toBe('schedule_of_events[0]'); // inline-section index
      expect(items[0].field_type).toBe('visit');

      // Two evidence rows: primary (inline) + secondary (SOA), both linked
      expect(evidence).toHaveLength(2);
      expect(evidence[0].support_type).toBe('primary');
      expect(evidence[0].page_number).toBe(22);
      expect(evidence[1].support_type).toBe('secondary');
      expect(evidence[1].page_number).toBe(98);

      expect(links).toHaveLength(2);
      expect(links[0].is_primary_source).toBe(true);
      expect(links[1].is_primary_source).toBe(false);
    });

    it('flags conflict when both sources have non-zero values that disagree', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          // Source B says Day 14, ±3
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
          // Source A says Day 15 — non-zero but different
          { visit_name: 'Visit 2', study_day: 15, window_minus_days: 0, window_plus_days: 0 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: 'Visit 2 (Day 14)',  pages: [22], confidence: 'high' },
            { text: 'SOA: V2 / Day 15',  pages: [98], confidence: 'medium' },
          ],
        },
      };

      const { evidence } = mapReductoExtractToSotr(DOC_ID, input);

      expect(evidence).toHaveLength(2);
      expect(evidence[0].support_type).toBe('primary');
      expect(evidence[1].support_type).toBe('conflict');
    });

    it('does not flag conflict when Source A has window=0 — that is the normal case', () => {
      // window=0 on the loser is the symptom we are working around, not a
      // genuine disagreement. It should be 'secondary', not 'conflict'.
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { visit_name: 'Visit 3', study_day: 42, window_minus_days: 7, window_plus_days: 7 },
          { visit_name: 'Visit 3', study_day: 42, window_minus_days: 0, window_plus_days: 0 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: '6.3.3 Visit 3 (Week 6, Day 42±7)', pages: [25], confidence: 'high' },
            { text: 'SOA: Visit 3 / Day 42',            pages: [99], confidence: 'medium' },
          ],
        },
      };

      const { evidence } = mapReductoExtractToSotr(DOC_ID, input);

      expect(evidence[1].support_type).toBe('secondary');
    });

    it('preserves unique visits (no dedup) when each visit_name appears once', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { visit_name: 'Screening', study_day: -14, window_minus_days: 0, window_plus_days: 0 },
          { visit_name: 'Visit 1',   study_day: 1,   window_minus_days: 0, window_plus_days: 0 },
          { visit_name: 'Visit 2',   study_day: 14,  window_minus_days: 3, window_plus_days: 3 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: 'Screening visit', pages: [10], confidence: 'high' },
            { text: 'Visit 1 (Day 1)', pages: [11], confidence: 'high' },
            { text: 'Visit 2 (Day 14±3)', pages: [12], confidence: 'high' },
          ],
        },
      };

      const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input);

      expect(items).toHaveLength(3);
      expect(evidence).toHaveLength(3);
      evidence.forEach(e => expect(e.support_type).toBe('primary'));
    });

    it('handles 3+ duplicate sources of the same visit', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0 },
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: 'Inline 6.3.2', pages: [22], confidence: 'high' },
            { text: 'SOA primary',   pages: [98], confidence: 'medium' },
            { text: 'SOA secondary', pages: [99], confidence: 'medium' },
          ],
        },
      };

      const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input);

      expect(items).toHaveLength(1);
      expect(evidence).toHaveLength(3);
      expect(evidence[0].support_type).toBe('primary');
      expect(evidence[1].support_type).toBe('secondary');
      expect(evidence[2].support_type).toBe('secondary');
    });

    it('falls back to first entry when no source has window>0 — no signal to pick winner', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0 },
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: 'first SOA mention',  pages: [98], confidence: 'medium' },
            { text: 'second SOA mention', pages: [99], confidence: 'medium' },
          ],
        },
      };

      const { items, evidence } = mapReductoExtractToSotr(DOC_ID, input);

      expect(items).toHaveLength(1);
      expect(items[0].field_path).toBe('schedule_of_events[0]');
      expect(evidence[1].support_type).toBe('secondary'); // not conflict — values agree
    });

    it('normalizes visit_name (case, whitespace) when grouping duplicates', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
          { visit_name: '  visit 2  ', study_day: 14, window_minus_days: 0, window_plus_days: 0 },
        ],
        _reducto_citations: {
          schedule_of_events: [
            { text: 'Inline',  pages: [22], confidence: 'high' },
            { text: 'SOA row', pages: [98], confidence: 'medium' },
          ],
        },
      };

      const { items } = mapReductoExtractToSotr(DOC_ID, input);
      expect(items).toHaveLength(1);
    });

    it('treats visits without a visit_name as singletons (no false merge)', () => {
      const input: ReductoExtractResponse = {
        schedule_of_events: [
          { study_day: 1 },
          { study_day: 14 },
          { study_day: 28 },
        ],
        _reducto_citations: {},
      };

      const { items } = mapReductoExtractToSotr(DOC_ID, input);
      expect(items).toHaveLength(3);
    });
  });

  // -------------------------------------------------------------------------
  // T9 — dedupeVisitArray unit tests (pure function, direct invocation)
  // -------------------------------------------------------------------------
  describe('dedupeVisitArray (direct unit tests)', () => {
    it('returns all indices when the array has no duplicates', () => {
      const result = dedupeVisitArray([
        { visit_name: 'A' },
        { visit_name: 'B' },
        { visit_name: 'C' },
      ]);
      expect(result.winningIndices).toEqual([0, 1, 2]);
      expect(result.extraEvidenceFor.size).toBe(0);
    });

    it('keeps winning indices in original order', () => {
      const result = dedupeVisitArray([
        // Source A first (window=0)
        { visit_name: 'V2', window_minus_days: 0, window_plus_days: 0 },
        // Source B second (window>0) — should win
        { visit_name: 'V2', window_minus_days: 3, window_plus_days: 3 },
        { visit_name: 'V3', window_minus_days: 0, window_plus_days: 0 },
      ]);
      expect(result.winningIndices).toEqual([1, 2]);
      expect(result.extraEvidenceFor.get(1)?.[0].sourceIndex).toBe(0);
      expect(result.extraEvidenceFor.get(1)?.[0].supportType).toBe('secondary');
    });

    it('returns empty result for empty input', () => {
      const result = dedupeVisitArray([]);
      expect(result.winningIndices).toEqual([]);
      expect(result.extraEvidenceFor.size).toBe(0);
    });

    it('ignores non-object entries gracefully', () => {
      const result = dedupeVisitArray([
        { visit_name: 'V1', window_minus_days: 3, window_plus_days: 3 },
        null,
        'not-an-object',
        42,
      ]);
      // All four still get "winning" indices because they don't group with each other
      expect(result.winningIndices.length).toBeGreaterThan(0);
    });
  });
});
