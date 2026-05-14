// =============================================================================
// Drift detector — canonical src/ adapter vs Deno copy under supabase/functions/_shared/.
//
// The Deno copy exists because Supabase edge functions can't import from the
// Vite src/ tree. The two files MUST stay in functional sync — when they
// diverge, production writes data shaped differently than the frontend
// expects to read.
//
// This test imports BOTH adapters and runs them against the same fixture.
// If outputs differ, the test fails and the diff makes the drift visible.
//
// Note: the test file paths use TypeScript's bare module resolution, which
// works under vitest. The .ts extension on the Deno import is preserved
// because that's what Deno requires; vitest tolerates it.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { mapReductoExtractToSotr as canonical } from '../sourceEvidenceAdapter';
// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { mapReductoExtractToSotr as denoCopy } from
  '../../../../supabase/functions/_shared/sourceEvidenceAdapter';
import type { ReductoExtractResponse } from '../../../types/sotr';

const DOC_ID = 'doc-drift-test-00000000-0000-0000-0000-000000000001';
const RUN_ID = 'job-reducto-drift-001';

const FIXTURE: ReductoExtractResponse = {
  protocol_title:    'A Phase II Study of Drift Detection',
  protocol_number:   'DRIFT-001',
  sponsor_name:      'Sync Sciences Inc.',
  study_phase:       'Phase II',
  primary_endpoints: ['Maintain parity across two adapter copies'],
  key_inclusion_criteria: ['Both files exist'],
  schedule_of_events: [
    // Source B — inline section (winner)
    { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
    // Source A — SOA table (loser, secondary evidence)
    { visit_name: 'Visit 2', study_day: 14, window_minus_days: 0, window_plus_days: 0,
      schedule_variant: 'All Subjects' },
    // Unique visit
    { visit_name: 'Visit 3', study_day: 42, window_minus_days: 7, window_plus_days: 7 },
  ],
  _reducto_citations: {
    protocol_title:  { text: 'A Phase II Study of Drift Detection', pages: [1], confidence: 'high' },
    protocol_number: { text: 'DRIFT-001',                            pages: [1], confidence: 'high' },
    primary_endpoints: [
      { text: 'Primary endpoint: maintain parity', pages: [5], confidence: 'high' },
    ],
    key_inclusion_criteria: [
      { text: 'Both files exist', pages: [10], confidence: 'high' },
    ],
    schedule_of_events: [
      { text: '6.3.2 Visit 2 (Week 2, Day 14±3)', pages: [22], confidence: 'high' },
      { text: 'SOA: Visit 2 / Day 14',            pages: [98], confidence: 'medium' },
      { text: '6.3.3 Visit 3 (Week 6, Day 42±7)', pages: [25], confidence: 'high' },
    ],
  },
};

describe('Deno adapter copy stays in sync with canonical adapter', () => {
  it('produces identical AdapterOutput for the same fixture', () => {
    const canonicalOut = canonical(DOC_ID, FIXTURE, RUN_ID);
    const denoOut      = denoCopy(DOC_ID, FIXTURE, RUN_ID);

    expect(denoOut).toEqual(canonicalOut);
  });

  it('produces identical empty output for empty extract', () => {
    const empty: ReductoExtractResponse = {};
    expect(denoCopy(DOC_ID, empty, null)).toEqual(canonical(DOC_ID, empty, null));
  });

  it('produces identical conflict evidence for disagreeing visit sources', () => {
    const conflict: ReductoExtractResponse = {
      schedule_of_events: [
        { visit_name: 'Visit 2', study_day: 14, window_minus_days: 3, window_plus_days: 3 },
        { visit_name: 'Visit 2', study_day: 15, window_minus_days: 0, window_plus_days: 0 },
      ],
      _reducto_citations: {
        schedule_of_events: [
          { text: 'Inline says Day 14',       pages: [22], confidence: 'high' },
          { text: 'SOA disagrees — Day 15',   pages: [98], confidence: 'medium' },
        ],
      },
    };

    expect(denoCopy(DOC_ID, conflict, null)).toEqual(canonical(DOC_ID, conflict, null));
  });
});
