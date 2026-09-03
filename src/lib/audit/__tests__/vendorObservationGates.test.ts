import { describe, it, expect } from 'vitest';
// The gates are a pure module that lives with the edge function (Deno) but
// is unit-tested from here (isaFindingGates.test.ts precedent) — the
// guarantees they encode ARE the product: cite-or-drop over notes OR filed
// evidence, verbatim protocol quotes, and the schema-level absence of any
// severity / classification on a candidate.
import { gateCandidates } from '../../../../supabase/functions/audit-observation-draft/gates';
import { labelCandidates } from '../../../../supabase/functions/_shared/protocolCandidates';

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const PHANTOM = 'ffffffff-0000-0000-0000-00000000000f';

const live = () => new Set([NOTE_A, NOTE_B]);

// Evidence passages carry the filed document's version (content_hash) so an
// accepted citation names WHICH filing it quotes.
const EVIDENCE = labelCandidates(
  [
    {
      id: 'chunk-e1',
      document_id: 'doc-e',
      content: 'Temperature excursions shall be recorded in the excursion log within 24 hours.',
      section_heading: '4.2 Excursions',
      page_start: 3,
      page_end: 3,
    },
    {
      id: 'chunk-e2',
      document_id: 'doc-e',
      content: 'The QA manager reviews the excursion log monthly.',
      section_heading: '4.3 Review',
      page_start: 4,
      page_end: 4,
    },
  ],
  'E',
).map((c) => ({ ...c, content_hash: 'sha-e' }));

const PROTOCOL = labelCandidates(
  [
    {
      id: 'chunk-p1',
      document_id: 'doc-p',
      content:
        'Investigational product must be stored between 2 and 8 degrees Celsius and any excursion documented and reported to the sponsor.',
      section_heading: '6.3 Storage',
      page_start: 47,
      page_end: 47,
    },
  ],
  'P',
);

function validCandidate(overrides: Record<string, unknown> = {}) {
  return {
    vendor_domain: 'Data integrity',
    observation_text: 'Temperature excursions were not documented within the required window.',
    checkpoint_ref: 'SOP-014 rev 3 §4.2',
    evidence: [
      {
        text: 'Two excursions on 03 Sep 2026 were logged five days later.',
        source_note_ids: [NOTE_A],
        source_passages: [],
      },
    ],
    protocol_ref: null,
    ...overrides,
  };
}

describe('gateCandidates — Gate 1 cite-or-drop', () => {
  it('passes a candidate whose evidence cites live notes, mapping every field', () => {
    const { accepted, withheldCount, strippedProtocolRefCount } = gateCandidates(
      [validCandidate()],
      live(),
      EVIDENCE,
      PROTOCOL,
    );
    expect(withheldCount).toBe(0);
    expect(strippedProtocolRefCount).toBe(0);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toEqual({
      vendor_domain: 'Data integrity',
      observation_text: 'Temperature excursions were not documented within the required window.',
      checkpoint_ref: 'SOP-014 rev 3 §4.2',
      evidence: [
        {
          text: 'Two excursions on 03 Sep 2026 were logged five days later.',
          source_note_ids: [NOTE_A],
          source_passages: [],
        },
      ],
      protocol_ref: null,
    });
  });

  it('never passes severity, impact, or classification through — the shape cannot carry them', () => {
    const { accepted } = gateCandidates(
      [
        validCandidate({
          severity: 'MAJOR',
          provisional_impact: 'CRITICAL',
          provisional_classification: 'FINDING',
          classification: 'FINDING',
        }),
      ],
      live(),
    );
    expect(accepted).toHaveLength(1);
    expect(Object.keys(accepted[0]).sort()).toEqual(
      ['checkpoint_ref', 'evidence', 'observation_text', 'protocol_ref', 'vendor_domain'].sort(),
    );
  });

  it('drops phantom note ids but keeps the item when a live id remains', () => {
    const { accepted, withheldCount } = gateCandidates(
      [
        validCandidate({
          evidence: [{ text: 'fact', source_note_ids: [PHANTOM, NOTE_B, NOTE_B], source_passages: [] }],
        }),
      ],
      live(),
    );
    expect(withheldCount).toBe(0);
    expect(accepted[0].evidence[0].source_note_ids).toEqual([NOTE_B]);
  });

  it('withholds a candidate whose evidence item cites nothing verifiable', () => {
    const { accepted, withheldCount } = gateCandidates(
      [
        validCandidate({
          evidence: [
            { text: 'traceable', source_note_ids: [NOTE_A], source_passages: [] },
            { text: 'untraceable', source_note_ids: [PHANTOM], source_passages: [] },
          ],
        }),
      ],
      live(),
    );
    expect(accepted).toHaveLength(0);
    expect(withheldCount).toBe(1);
  });

  it('evidence-only: a valid E-label keeps the item and materializes the passage to row facts', () => {
    const { accepted, withheldCount } = gateCandidates(
      [
        validCandidate({
          evidence: [{ text: 'Log entries were late.', source_note_ids: [], source_passages: ['E1', ' E1 ', 'E2'] }],
        }),
      ],
      live(),
      EVIDENCE,
    );
    expect(withheldCount).toBe(0);
    expect(accepted[0].evidence[0].source_note_ids).toEqual([]);
    // Deduped by chunk; the label itself never leaves the function; the
    // document version rides along.
    expect(accepted[0].evidence[0].source_passages).toEqual([
      { chunk_id: 'chunk-e1', document_id: 'doc-e', content_hash: 'sha-e', section_heading: '4.2 Excursions', page_start: 3, page_end: 3 },
      { chunk_id: 'chunk-e2', document_id: 'doc-e', content_hash: 'sha-e', section_heading: '4.3 Review', page_start: 4, page_end: 4 },
    ]);
  });

  it('withholds when the only citations are an unknown E-label or a protocol P-label', () => {
    const { accepted, withheldCount } = gateCandidates(
      [
        validCandidate({
          evidence: [{ text: 'x', source_note_ids: [], source_passages: ['E9', 'P1', 7] }],
        }),
      ],
      live(),
      EVIDENCE,
      PROTOCOL,
    );
    expect(accepted).toHaveLength(0);
    expect(withheldCount).toBe(1);
  });

  it('withholds on missing evidence, missing domain, or missing observation', () => {
    const { accepted, withheldCount } = gateCandidates(
      [
        validCandidate({ evidence: [] }),
        validCandidate({ evidence: 'nope' }),
        validCandidate({ vendor_domain: '   ' }),
        validCandidate({ observation_text: null }),
        null,
        'string',
      ],
      live(),
    );
    expect(accepted).toHaveLength(0);
    expect(withheldCount).toBe(6);
  });

  it('normalizes checkpoint_ref: blank or non-string → null, otherwise trimmed', () => {
    const { accepted } = gateCandidates(
      [
        validCandidate({ checkpoint_ref: '  SOP-1 §2  ' }),
        validCandidate({ checkpoint_ref: '' }),
        validCandidate({ checkpoint_ref: 42 }),
      ],
      live(),
    );
    expect(accepted.map((c) => c.checkpoint_ref)).toEqual(['SOP-1 §2', null, null]);
  });

  it('caps at 15 candidates and returns nothing for a non-array', () => {
    const many = Array.from({ length: 16 }, () => validCandidate());
    expect(gateCandidates(many, live()).accepted).toHaveLength(15);
    expect(gateCandidates({ candidates: [] }, live())).toEqual({
      accepted: [],
      withheldCount: 0,
      strippedProtocolRefCount: 0,
    });
  });
});

describe('gateCandidates — Gate 3 protocol citation', () => {
  it('keeps a verbatim quote of a sent passage as a materialized snapshot', () => {
    const { accepted, strippedProtocolRefCount } = gateCandidates(
      [
        validCandidate({
          protocol_ref: { passage: 'P1', quote: 'any excursion documented and reported to the sponsor' },
        }),
      ],
      live(),
      EVIDENCE,
      PROTOCOL,
    );
    expect(strippedProtocolRefCount).toBe(0);
    expect(accepted[0].protocol_ref).toEqual({
      chunk_id: 'chunk-p1',
      document_id: 'doc-p',
      quote: 'any excursion documented and reported to the sponsor',
      section_heading: '6.3 Storage',
      page_start: 47,
      page_end: 47,
    });
  });

  it('strips (never withholds) a paraphrase, an unknown label, or an E-label used as a protocol ref', () => {
    const { accepted, withheldCount, strippedProtocolRefCount } = gateCandidates(
      [
        validCandidate({ protocol_ref: { passage: 'P1', quote: 'excursions must be reported to sponsor' } }),
        validCandidate({ protocol_ref: { passage: 'P7', quote: 'any excursion documented' } }),
        validCandidate({ protocol_ref: { passage: 'E1', quote: 'Temperature excursions shall be recorded' } }),
      ],
      live(),
      EVIDENCE,
      PROTOCOL,
    );
    expect(withheldCount).toBe(0);
    expect(accepted).toHaveLength(3);
    expect(accepted.every((c) => c.protocol_ref === null)).toBe(true);
    expect(strippedProtocolRefCount).toBe(3);
  });

  it('with no protocol passages sent, any volunteered ref is stripped', () => {
    const { accepted, strippedProtocolRefCount } = gateCandidates(
      [validCandidate({ protocol_ref: { passage: 'P1', quote: 'anything' } })],
      live(),
    );
    expect(accepted[0].protocol_ref).toBeNull();
    expect(strippedProtocolRefCount).toBe(1);
  });
});
