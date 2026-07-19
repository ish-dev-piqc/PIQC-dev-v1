import { describe, it, expect } from 'vitest';
// Pure Deno-side module unit-tested cross-tree, like gates.ts: the
// candidate-labeling + verbatim-quote mechanics ARE the Gate 3 guarantee.
import {
  labelCandidates,
  MAX_CANDIDATES,
  materializeRef,
  quoteInContent,
  type ProtocolChunkRow,
} from '../../../../supabase/functions/isa-finding-draft/protocolCandidates';

function row(id: string, content = `Content of ${id}.`): ProtocolChunkRow {
  return {
    id,
    document_id: 'doc-1',
    content,
    section_heading: null,
    page_start: null,
    page_end: null,
  };
}

describe('labelCandidates', () => {
  it('assigns sequential P-labels and dedupes by chunk id', () => {
    const out = labelCandidates([row('a'), row('b'), row('a')]);
    expect(out.map((c) => c.label)).toEqual(['P1', 'P2']);
    expect(out.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('caps the candidate set', () => {
    const rows = Array.from({ length: MAX_CANDIDATES + 5 }, (_, i) => row(`c${i}`));
    expect(labelCandidates(rows)).toHaveLength(MAX_CANDIDATES);
  });
});

describe('quoteInContent', () => {
  it('tolerates whitespace runs and case, nothing else', () => {
    const content = 'Records must be\n   maintained for each   Dispensing event.';
    expect(quoteInContent('must be maintained for each dispensing', content)).toBe(true);
    expect(quoteInContent('must be kept for each dispensing', content)).toBe(false);
    expect(quoteInContent('', content)).toBe(false);
  });
});

describe('materializeRef', () => {
  const candidates = labelCandidates([
    { ...row('c1', 'The protocol requires source verification of eligibility.'), section_heading: '9.1', page_start: 12, page_end: 13 },
  ]);

  it('builds the snapshot from the candidate row, quote from the claim', () => {
    expect(materializeRef('P1', 'requires source verification', candidates)).toEqual({
      chunk_id: 'c1',
      document_id: 'doc-1',
      quote: 'requires source verification',
      section_heading: '9.1',
      page_start: 12,
      page_end: 13,
    });
  });

  it('rejects unknown labels, non-strings, empty and oversized quotes', () => {
    expect(materializeRef('P2', 'requires source verification', candidates)).toBeNull();
    expect(materializeRef(1, 'requires source verification', candidates)).toBeNull();
    expect(materializeRef('P1', '   ', candidates)).toBeNull();
    expect(materializeRef('P1', 'x'.repeat(301), candidates)).toBeNull();
  });
});
