import { describe, it, expect } from 'vitest';
import { mapReductoExtractToSotr } from '../sourceEvidenceAdapter';
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
});
