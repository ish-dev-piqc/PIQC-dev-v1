import { describe, it, expect } from 'vitest';
// The gates are a pure, dependency-light module that lives with the edge
// function (Deno) but is unit-tested from here — the guarantees they encode
// (cite-or-drop, closed-world citation) are the product, so they get direct
// coverage rather than only end-to-end faith.
import { gateDrafts } from '../../../../supabase/functions/isa-finding-draft/gates';
import { CITATION_MAP } from '../../../../supabase/functions/isa-finding-draft/citationMap';
import { labelCandidates } from '../../../../supabase/functions/_shared/protocolCandidates';

const NOTE_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const NOTE_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const PHANTOM = 'ffffffff-0000-0000-0000-00000000000f';

const live = () => new Set([NOTE_A, NOTE_B]);

function validDraft(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Delegation of authority documentation incomplete',
    isa_domain: 'INVESTIGATOR_OVERSIGHT_DELEGATION',
    subcategory: 'Delegation of Authority log',
    severity: 'MAJOR',
    severity_rule: 'Compliance deficiency with regulatory liability if uncorrected',
    observation:
      'Delegation of trial-related activities was not consistently documented on the delegation log.',
    evidence: [
      { text: 'Two staff performing consent were absent from the log.', source_note_ids: [NOTE_A] },
      { text: 'One entry was not signed by the PI.', source_note_ids: [NOTE_B] },
    ],
    reference: 'ICH E6(R3) 2.3.3',
    ...overrides,
  };
}

describe('gateDrafts — gate 1: cite-or-drop', () => {
  it('accepts a fully-traced draft', () => {
    const res = gateDrafts([validDraft()], live());
    expect(res.accepted).toHaveLength(1);
    expect(res.withheldCount).toBe(0);
    expect(res.accepted[0].evidence[0].source_note_ids).toEqual([NOTE_A]);
  });

  it('withholds a draft with no evidence at all', () => {
    const res = gateDrafts([validDraft({ evidence: [] })], live());
    expect(res.accepted).toHaveLength(0);
    expect(res.withheldCount).toBe(1);
  });

  it('withholds the whole draft when one evidence item only cites phantom notes', () => {
    const res = gateDrafts(
      [
        validDraft({
          evidence: [
            { text: 'Real instance.', source_note_ids: [NOTE_A] },
            { text: 'Fabricated instance.', source_note_ids: [PHANTOM] },
          ],
        }),
      ],
      live(),
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.withheldCount).toBe(1);
  });

  it('filters phantom ids but keeps the item when a real citation remains', () => {
    const res = gateDrafts(
      [
        validDraft({
          evidence: [
            { text: 'Mixed citations.', source_note_ids: [PHANTOM, NOTE_A] },
          ],
        }),
      ],
      live(),
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0].evidence[0].source_note_ids).toEqual([NOTE_A]);
  });

  it('withholds structurally broken drafts (bad domain / severity / missing text)', () => {
    const res = gateDrafts(
      [
        validDraft({ isa_domain: 'NOT_A_DOMAIN' }),
        validDraft({ severity: 'SEVERE' }),
        validDraft({ title: '' }),
        'not even an object',
      ],
      live(),
    );
    expect(res.accepted).toHaveLength(0);
    expect(res.withheldCount).toBe(4);
  });

  it('returns empty on non-array input without throwing', () => {
    expect(gateDrafts(undefined, live()).accepted).toHaveLength(0);
    expect(gateDrafts({ not: 'array' }, live()).accepted).toHaveLength(0);
  });
});

describe('gateDrafts — gate 2: closed-world citation', () => {
  it('keeps an exact citation-map string for the draft domain', () => {
    const res = gateDrafts([validDraft()], live());
    expect(res.accepted[0].reference).toBe('ICH E6(R3) 2.3.3');
    expect(res.strippedReferenceCount).toBe(0);
  });

  it('strips a free-composed citation but keeps the draft', () => {
    const res = gateDrafts(
      [validDraft({ reference: 'ICH GCP E6(R2) 4.1.5' })],
      live(),
    );
    expect(res.accepted).toHaveLength(1);
    expect(res.accepted[0].reference).toBeNull();
    expect(res.strippedReferenceCount).toBe(1);
  });

  it('strips a real map citation attached to the WRONG domain', () => {
    // 21 CFR 50.25 is valid for INFORMED_CONSENT but not for the delegation
    // domain — domain-scoped checking catches cross-domain miscites.
    expect(CITATION_MAP.INFORMED_CONSENT).toContain('21 CFR 50.25');
    const res = gateDrafts(
      [validDraft({ reference: '21 CFR 50.25' })],
      live(),
    );
    expect(res.accepted[0].reference).toBeNull();
    expect(res.strippedReferenceCount).toBe(1);
  });

  it('accepts a null reference without counting a strip', () => {
    const res = gateDrafts([validDraft({ reference: null })], live());
    expect(res.accepted[0].reference).toBeNull();
    expect(res.strippedReferenceCount).toBe(0);
  });
});

describe('gateDrafts — gate 3: protocol citation (S4 bridge)', () => {
  const CANDIDATES = labelCandidates([
    {
      id: 'chunk-1',
      document_id: 'doc-1',
      content:
        'Investigational product accountability records must be maintained for each dispensing event,\n   including date, quantity dispensed, and subject number.',
      section_heading: '6.3 Investigational Product',
      page_start: 47,
      page_end: 47,
    },
  ]);
  const VERBATIM =
    'accountability records must be maintained for each dispensing event, including date';

  it('materializes a valid ref: quote from the model, provenance from the DB row', () => {
    const res = gateDrafts(
      [validDraft({ protocol_ref: { passage: 'P1', quote: VERBATIM } })],
      live(),
      CANDIDATES,
    );
    expect(res.accepted[0].protocol_ref).toEqual({
      chunk_id: 'chunk-1',
      document_id: 'doc-1',
      quote: VERBATIM,
      section_heading: '6.3 Investigational Product',
      page_start: 47,
      page_end: 47,
    });
    expect(res.strippedProtocolRefCount).toBe(0);
  });

  it('strips a ref citing a passage that was never sent', () => {
    const res = gateDrafts(
      [validDraft({ protocol_ref: { passage: 'P9', quote: VERBATIM } })],
      live(),
      CANDIDATES,
    );
    expect(res.accepted).toHaveLength(1); // strip, never withhold
    expect(res.accepted[0].protocol_ref).toBeNull();
    expect(res.strippedProtocolRefCount).toBe(1);
  });

  it('strips a paraphrased quote — verbatim means verbatim', () => {
    const res = gateDrafts(
      [
        validDraft({
          protocol_ref: {
            passage: 'P1',
            quote: 'IP accountability logs should be kept for every dispensing',
          },
        }),
      ],
      live(),
      CANDIDATES,
    );
    expect(res.accepted[0].protocol_ref).toBeNull();
    expect(res.strippedProtocolRefCount).toBe(1);
  });

  it('strips any volunteered ref when the bridge sent no candidates', () => {
    const res = gateDrafts(
      [validDraft({ protocol_ref: { passage: 'P1', quote: VERBATIM } })],
      live(),
    );
    expect(res.accepted[0].protocol_ref).toBeNull();
    expect(res.strippedProtocolRefCount).toBe(1);
  });

  it('accepts a null/absent protocol_ref without counting a strip', () => {
    const res = gateDrafts(
      [validDraft({ protocol_ref: null }), validDraft()],
      live(),
      CANDIDATES,
    );
    expect(res.accepted.every((d) => d.protocol_ref === null)).toBe(true);
    expect(res.strippedProtocolRefCount).toBe(0);
  });
});
