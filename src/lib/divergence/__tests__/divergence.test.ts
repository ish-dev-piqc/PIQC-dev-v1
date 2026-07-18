import { describe, it, expect } from 'vitest';
import { adaptDivergenceRow, sortDivergences } from '../divergenceAdapter';
import { draftClarificationQuery } from '../draftClarificationQuery';
import type { DivergenceRecord } from '../../../types/divergence';

const validRow = {
  id: 'd1',
  protocol_id: 'p1',
  class: 'window_mismatch',
  locus_key: 'w:visit 3',
  visit_name: 'Visit 3',
  procedure_label: null,
  reading_a: {
    source: 'soa_grid',
    quote: 'Visit 3 Day 15 (±2 days)',
    verbatim: true,
    section: 'Schedule of Assessments',
    page: null,
  },
  reading_b: {
    source: 'narrative',
    quote: 'extraction recorded a ±3 day(s) scheduling window for this visit',
    verbatim: false,
    section: null,
    page: null,
  },
  detail: 'Two readings differ.',
  status: 'open',
  dispositions: [{ status: 'open', note: null, actor: 'u1', at: '2026-07-18T00:00:00Z' }],
  created_at: '2026-07-18T00:00:00Z',
};

describe('adaptDivergenceRow', () => {
  it('adapts a valid row, renaming class → divergence_class', () => {
    const r = adaptDivergenceRow(validRow);
    expect(r).not.toBeNull();
    expect(r?.divergence_class).toBe('window_mismatch');
    expect(r?.reading_a.verbatim).toBe(true);
    expect(r?.dispositions).toHaveLength(1);
  });

  it('returns null for malformed rows instead of a partially-typed record', () => {
    expect(adaptDivergenceRow(null)).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, class: 'made_up' })).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, reading_a: { source: 'nope' } })).toBeNull();
    expect(adaptDivergenceRow({ ...validRow, status: 'archived' })).toBeNull();
  });

  it('drops malformed dispositions but keeps the record', () => {
    const r = adaptDivergenceRow({ ...validRow, dispositions: [{ bogus: true }, ...validRow.dispositions] });
    expect(r?.dispositions).toHaveLength(1);
  });
});

describe('sortDivergences', () => {
  it('orders open work first, then by class consequence', () => {
    const mk = (over: Partial<typeof validRow>) => adaptDivergenceRow({ ...validRow, ...over })!;
    const sorted = sortDivergences([
      mk({ id: 'a', status: 'resolved' }),
      mk({ id: 'b', class: 'cohort_scope', visit_name: null }),
      mk({ id: 'c', class: 'window_mismatch' }),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('draftClarificationQuery', () => {
  const record = adaptDivergenceRow(validRow) as DivergenceRecord;

  it('carries both readings and the fixed asking scaffold — no verdict', () => {
    const q = draftClarificationQuery(record, { protocolCode: 'PP06489' });
    expect(q).toContain('Subject: PP06489 — clarification request: Visit 3');
    expect(q).toContain('"Visit 3 Day 15 (±2 days)"');
    expect(q).toContain('The Schedule of Assessments (Schedule of Assessments) states:');
    expect(q).toContain('was recorded by extraction as'); // non-verbatim honestly labeled
    expect(q).toContain('the scheduling window for Visit 3');
    expect(q).toContain('Could you confirm which reading governs');
    // position-free: the draft never says which reading is right
    expect(q).not.toMatch(/should be|is correct|is wrong|error\b/i);
  });

  it('is deterministic (re-derivable in audit)', () => {
    expect(draftClarificationQuery(record, { protocolCode: 'PP06489' })).toBe(
      draftClarificationQuery(record, { protocolCode: 'PP06489' }),
    );
  });
});
