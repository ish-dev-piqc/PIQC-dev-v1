import { describe, expect, it } from 'vitest';
import {
  adaptDeliverablePacket,
  adaptDeliverablePacketBlock,
} from '../deliverablesAdapter';
import type { DeliverablePacketBlock } from '../../../types/deliverables';

// =============================================================================
// deliverablesAdapter — pure mapper over the deliverable_get_packet JSON.
// Round-trip fidelity, null tolerance, malformed-block skipping, and the
// display_text fallback (current_text wins over derived_text, else '').
// =============================================================================

/** A fully-populated protocol_fact block as the RPC emits it. */
const factBlock = {
  id: 'blk-1',
  section_key: 'eligibility_verification',
  block_type: 'checklist_item',
  content_origin: 'protocol_fact',
  display_text: 'Verify: Age 18-75 at screening',
  derived_text: 'Verify: Age 18-75 at screening',
  current_text: null,
  source_evidence_id: 'ev-1',
  source_quote: 'Participants must be aged 18 to 75 years, inclusive.',
  source_page_number: 24,
  source_section: '5.1 Inclusion Criteria',
  confidence_state: 'high',
  review_state: 'draft',
  review_note: null,
  version: 1,
  sort_order: 1,
};

/** A framing block — no evidence, no confidence (never false provenance). */
const framingBlock = {
  id: 'blk-2',
  section_key: 'site_questions',
  block_type: 'site_question',
  content_origin: 'derived_operational_framing',
  display_text: 'Have there been any staffing changes since the last monitoring visit?',
  derived_text: 'Have there been any staffing changes since the last monitoring visit?',
  current_text: null,
  source_evidence_id: null,
  source_quote: null,
  source_page_number: null,
  source_section: null,
  confidence_state: null,
  review_state: 'draft',
  review_note: null,
  version: 1,
  sort_order: 12,
};

const basePacket = {
  deliverable_id: 'del-1',
  protocol_id: 'prot-1',
  artifact_type: 'monitoring_prep_checklist',
  title: 'Monitoring Preparation Checklist',
  protocol_version: 'v2.0',
  generated_at: '2026-07-03T10:00:00+00:00',
  regenerated_at: null,
  blocks: [factBlock, framingBlock],
};

describe('adaptDeliverablePacket — round trip', () => {
  it('adapts a well-formed packet field-for-field', () => {
    const out = adaptDeliverablePacket(basePacket);
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.deliverable_id).toBe('del-1');
    expect(out.protocol_id).toBe('prot-1');
    expect(out.artifact_type).toBe('monitoring_prep_checklist');
    expect(out.title).toBe('Monitoring Preparation Checklist');
    expect(out.protocol_version).toBe('v2.0');
    expect(out.generated_at).toBe('2026-07-03T10:00:00+00:00');
    expect(out.regenerated_at).toBeNull();
    expect(out.blocks).toHaveLength(2);
    // Fact block keeps its full evidence passthrough.
    expect(out.blocks[0]).toEqual(factBlock as DeliverablePacketBlock);
    // Framing block keeps its all-null evidence + confidence.
    expect(out.blocks[1]).toEqual(framingBlock as DeliverablePacketBlock);
  });

  it('preserves a human edit overlay (current_text + edited state)', () => {
    const out = adaptDeliverablePacket({
      ...basePacket,
      blocks: [
        {
          ...factBlock,
          current_text: 'Verify: Age 18-75 (site uses date-of-consent)',
          display_text: 'Verify: Age 18-75 (site uses date-of-consent)',
          review_state: 'edited',
          version: 2,
        },
      ],
    });
    expect(out?.blocks[0].current_text).toBe('Verify: Age 18-75 (site uses date-of-consent)');
    expect(out?.blocks[0].derived_text).toBe('Verify: Age 18-75 at screening');
    expect(out?.blocks[0].review_state).toBe('edited');
    expect(out?.blocks[0].version).toBe(2);
  });
});

describe('adaptDeliverablePacket — null / wrong-shape tolerance', () => {
  it('returns null for null raw (RPC says no deliverable exists)', () => {
    expect(adaptDeliverablePacket(null)).toBeNull();
  });

  it('returns null for undefined raw', () => {
    expect(adaptDeliverablePacket(undefined)).toBeNull();
  });

  it('returns null for non-object raw (string, number, array)', () => {
    expect(adaptDeliverablePacket('nope')).toBeNull();
    expect(adaptDeliverablePacket(42)).toBeNull();
    expect(adaptDeliverablePacket([basePacket])).toBeNull();
  });

  it('returns null when deliverable_id is missing or not a string', () => {
    expect(adaptDeliverablePacket({ ...basePacket, deliverable_id: undefined })).toBeNull();
    expect(adaptDeliverablePacket({ ...basePacket, deliverable_id: 7 })).toBeNull();
  });

  it('returns null when protocol_id is missing', () => {
    expect(adaptDeliverablePacket({ ...basePacket, protocol_id: null })).toBeNull();
  });

  it('returns null for an artifact_type outside the enum', () => {
    expect(adaptDeliverablePacket({ ...basePacket, artifact_type: 'siv_package' })).toBeNull();
    expect(adaptDeliverablePacket({ ...basePacket, artifact_type: null })).toBeNull();
  });

  it('adapts EVERY enum artifact_type — regression: a stale whitelist nulled risk_overview packets end-to-end', () => {
    for (const artifactType of ['monitoring_prep_checklist', 'risk_overview'] as const) {
      const packet = adaptDeliverablePacket({ ...basePacket, artifact_type: artifactType });
      expect(packet).not.toBeNull();
      expect(packet?.artifact_type).toBe(artifactType);
    }
  });

  it('degrades missing optional packet fields instead of failing', () => {
    const out = adaptDeliverablePacket({
      deliverable_id: 'del-1',
      protocol_id: 'prot-1',
      artifact_type: 'monitoring_prep_checklist',
      // title / protocol_version / generated_at / regenerated_at / blocks absent
    });
    expect(out).toEqual({
      deliverable_id: 'del-1',
      protocol_id: 'prot-1',
      artifact_type: 'monitoring_prep_checklist',
      title: '',
      protocol_version: null,
      generated_at: '',
      regenerated_at: null,
      blocks: [],
    });
  });

  it('coerces a non-array blocks field to an empty list', () => {
    const out = adaptDeliverablePacket({ ...basePacket, blocks: 'not-a-list' });
    expect(out?.blocks).toEqual([]);
  });
});

describe('adaptDeliverablePacket — malformed blocks are skipped, not fatal', () => {
  it('skips non-object entries but keeps valid siblings', () => {
    const out = adaptDeliverablePacket({
      ...basePacket,
      blocks: [null, 'junk', 17, [factBlock], factBlock],
    });
    expect(out?.blocks).toHaveLength(1);
    expect(out?.blocks[0].id).toBe('blk-1');
  });

  it('skips a block missing its id or section_key', () => {
    const out = adaptDeliverablePacket({
      ...basePacket,
      blocks: [{ ...factBlock, id: undefined }, { ...framingBlock, section_key: 42 }, factBlock],
    });
    expect(out?.blocks.map((b) => b.id)).toEqual(['blk-1']);
  });

  it('skips blocks with enum values outside the contract', () => {
    const out = adaptDeliverablePacket({
      ...basePacket,
      blocks: [
        { ...factBlock, id: 'bad-1', block_type: 'banner' },
        { ...factBlock, id: 'bad-2', content_origin: 'llm_generated' },
        { ...factBlock, id: 'bad-3', review_state: 'finalized' },
        framingBlock,
      ],
    });
    expect(out?.blocks.map((b) => b.id)).toEqual(['blk-2']);
  });
});

describe('adaptDeliverablePacketBlock — field tolerance', () => {
  const minimalBlock = {
    id: 'blk-min',
    section_key: 'source_doc_focus',
    block_type: 'checklist_item',
    content_origin: 'derived_operational_framing',
    review_state: 'draft',
  };

  it('tolerates missing optional fields with contract defaults', () => {
    const out = adaptDeliverablePacketBlock(minimalBlock);
    expect(out).toEqual({
      id: 'blk-min',
      section_key: 'source_doc_focus',
      block_type: 'checklist_item',
      content_origin: 'derived_operational_framing',
      display_text: '',
      derived_text: null,
      current_text: null,
      source_evidence_id: null,
      source_quote: null,
      source_page_number: null,
      source_section: null,
      confidence_state: null,
      review_state: 'draft',
      review_note: null,
      version: 1, // contract: versions start at 1
      sort_order: 0,
    });
  });

  it('falls back to current_text for a missing display_text (human edit wins)', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      derived_text: 'parser text',
      current_text: 'human overlay',
    });
    expect(out?.display_text).toBe('human overlay');
  });

  it('falls back to derived_text when there is no overlay', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      derived_text: 'parser text',
    });
    expect(out?.display_text).toBe('parser text');
  });

  it('keeps a server-resolved display_text authoritative over the fallback', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      display_text: 'server resolved',
      derived_text: 'parser text',
      current_text: 'human overlay',
    });
    expect(out?.display_text).toBe('server resolved');
  });

  it('nulls wrong-typed evidence fields instead of failing the block', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      source_evidence_id: 99,
      source_quote: { nested: true },
      source_page_number: 'twelve',
      source_section: false,
      review_note: 3,
    });
    expect(out).not.toBeNull();
    expect(out?.source_evidence_id).toBeNull();
    expect(out?.source_quote).toBeNull();
    expect(out?.source_page_number).toBeNull();
    expect(out?.source_section).toBeNull();
    expect(out?.review_note).toBeNull();
  });

  it('degrades an unknown confidence_state to null (never invents confidence)', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      confidence_state: 'certain',
    });
    expect(out).not.toBeNull();
    expect(out?.confidence_state).toBeNull();
  });

  it('defaults non-numeric version/sort_order rather than propagating NaN', () => {
    const out = adaptDeliverablePacketBlock({
      ...minimalBlock,
      version: 'two',
      sort_order: Number.NaN,
    });
    expect(out?.version).toBe(1);
    expect(out?.sort_order).toBe(0);
  });
});
