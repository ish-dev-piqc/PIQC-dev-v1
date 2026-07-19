// Shared row fixture for the divergence unit tests. Shaped exactly like a
// protocol_divergences row as it comes back from PostgREST (snake_case, `class`
// not yet renamed to `divergence_class`) so the adapter is exercised against
// the real wire shape, not against its own output type.

export const validDivergenceRow = {
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
