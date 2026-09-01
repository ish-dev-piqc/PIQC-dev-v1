import { describe, expect, it } from 'vitest';
import { normalizeRegister } from '../evidenceRegister';

// =============================================================================
// normalizeRegister — the engine half of the evidence-kind invariant: the
// register the deliverable engine grounds in contains AUDIT_EVIDENCE
// documents only. First engine-side unit test (the parked PR-P seam,
// absorbed into PR-D4); the client half lives in evidenceApi's mapper.
// =============================================================================

function row(
  documentId: string,
  doc: Record<string, unknown> | Record<string, unknown>[] | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    document_id: documentId,
    source_type: 'SOP',
    include_in_generation: true,
    documents: doc,
    ...overrides,
  };
}

const evidenceDoc = (overrides: Record<string, unknown> = {}) => ({
  title: 'Training log Q2',
  status: 'ready',
  content_hash: 'hash-1',
  kind: 'AUDIT_EVIDENCE',
  ...overrides,
});

describe('normalizeRegister', () => {
  it('keeps AUDIT_EVIDENCE rows and drops every other kind', () => {
    const out = normalizeRegister([
      row('d1', evidenceDoc()),
      row('d2', evidenceDoc({ kind: 'PROTOCOL' })),
      row('d3', evidenceDoc({ kind: undefined })),
      row('d4', null),
    ]);
    expect(out.map((d) => d.document_id)).toEqual(['d1']);
  });

  it('unwraps both embed shapes PostgREST can return (object and array)', () => {
    const out = normalizeRegister([
      row('obj', evidenceDoc()),
      row('arr', [evidenceDoc({ title: 'Array-shaped embed' })]),
    ]);
    expect(out.map((d) => d.title)).toEqual(['Training log Q2', 'Array-shaped embed']);
  });

  it('normalizes fields: untitled fallback, unknown status, null hash, withhold lever', () => {
    const [d] = normalizeRegister([
      row('d1', evidenceDoc({ title: '   ', status: undefined, content_hash: undefined }), {
        include_in_generation: false,
      }),
    ]);
    expect(d).toEqual({
      document_id: 'd1',
      source_type: 'SOP',
      title: '(untitled)',
      status: 'unknown',
      content_hash: null,
      included: false,
    });
  });

  it('treats null/absent input as an empty register', () => {
    expect(normalizeRegister(null)).toEqual([]);
    expect(normalizeRegister([])).toEqual([]);
  });

  it('only include_in_generation === true counts as included', () => {
    const out = normalizeRegister([
      row('d1', evidenceDoc(), { include_in_generation: 'yes' }),
      row('d2', evidenceDoc(), { include_in_generation: true }),
    ]);
    expect(out.map((d) => [d.document_id, d.included])).toEqual([
      ['d1', false],
      ['d2', true],
    ]);
  });
});
