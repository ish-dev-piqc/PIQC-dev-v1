// Shared row fixture for the divergence unit tests. Shaped exactly like a
// protocol_divergences row as it comes back from PostgREST (snake_case, `class`
// not yet renamed to `divergence_class`) so the adapter is exercised against
// the real wire shape, not against its own output type.
//
// The nullable columns are annotated as such: tests override them with null to
// exercise the visit-less / procedure-less cases, and inference from the sample
// value alone would type them too narrowly to allow it.

export const validDivergenceRow = {
  id: 'd1',
  protocol_id: 'p1',
  class: 'window_mismatch',
  locus_key: 'w:visit 3',
  visit_name: 'Visit 3' as string | null,
  procedure_label: null as string | null,
  reading_a: {
    source: 'soa_grid',
    quote: 'Visit 3 Day 15 (±2 days)',
    verbatim: true,
    section: 'Schedule of Assessments' as string | null,
    page: null as number | null,
  },
  reading_b: {
    source: 'narrative',
    quote: 'extraction recorded a ±3 day(s) scheduling window for this visit',
    verbatim: false,
    section: null as string | null,
    page: null as number | null,
  },
  detail: 'Two readings differ.',
  status: 'open',
  dispositions: [
    { status: 'open', note: null as string | null, actor: 'u1', at: '2026-07-18T00:00:00Z' },
  ],
  created_at: '2026-07-18T00:00:00Z',
};
