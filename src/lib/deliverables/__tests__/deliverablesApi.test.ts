import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the supabase client BEFORE importing the module under test so the
// import sees the stub. Avoid the live client entirely in unit tests.
const rpcMock = vi.fn();
vi.mock('../../supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

import {
  generateDeliverable,
  fetchDeliverablePacket,
  fetchChangeSummary,
} from '../deliverablesApi';

// =============================================================================
// deliverablesApi — DeliverablesResult<T> contract for the generate/read
// layer: exact RPC argument shapes, the "null packet = no deliverable yet,
// NOT an error" semantic, malformed-payload defense, and error passthrough.
// =============================================================================

const packetPayload = {
  deliverable_id: 'del-1',
  protocol_id: 'prot-1',
  artifact_type: 'monitoring_prep_checklist',
  title: 'Monitoring Preparation Checklist',
  protocol_version: 'v2.0',
  generated_at: '2026-07-03T12:00:00Z',
  regenerated_at: null,
  blocks: [
    {
      id: 'blk-1',
      section_key: 'eligibility_verification',
      block_type: 'checklist_item',
      content_origin: 'protocol_fact',
      display_text: 'Verify: Age ≥ 18 years',
      derived_text: 'Verify: Age ≥ 18 years',
      current_text: null,
      source_evidence_id: 'ev-1',
      source_quote: 'Participants must be at least 18 years of age',
      source_page_number: 24,
      source_section: '5.1 Inclusion Criteria',
      confidence_state: 'high',
      review_state: 'draft',
      review_note: null,
      version: 1,
      sort_order: 1,
    },
  ],
};

beforeEach(() => {
  rpcMock.mockReset();
});

describe('generateDeliverable', () => {
  it('calls deliverable_generate with p_protocol_id + p_artifact_type', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { deliverable_id: 'del-1', blocks_created: 27, blocks_preserved: 3 },
      error: null,
    });
    const r = await generateDeliverable('prot-1', 'monitoring_prep_checklist');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_generate', {
      p_protocol_id: 'prot-1',
      p_artifact_type: 'monitoring_prep_checklist',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        deliverable_id: 'del-1',
        blocks_created: 27,
        blocks_preserved: 3,
      });
    }
  });

  it('surfaces the RPC error message on failure', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'insufficient_privilege' },
    });
    const r = await generateDeliverable('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('insufficient_privilege');
  });

  it('rejects a malformed payload (missing deliverable_id) as ok:false', async () => {
    rpcMock.mockResolvedValueOnce({ data: { blocks_created: 5 }, error: null });
    const r = await generateDeliverable('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });

  it('defaults missing counters to 0 when deliverable_id is present', async () => {
    rpcMock.mockResolvedValueOnce({
      data: { deliverable_id: 'del-1' },
      error: null,
    });
    const r = await generateDeliverable('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.blocks_created).toBe(0);
      expect(r.data.blocks_preserved).toBe(0);
    }
  });
});

describe('fetchDeliverablePacket', () => {
  it('calls deliverable_get_packet with p_protocol_id + p_artifact_type', async () => {
    rpcMock.mockResolvedValueOnce({ data: packetPayload, error: null });
    const r = await fetchDeliverablePacket('prot-1', 'monitoring_prep_checklist');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_get_packet', {
      p_protocol_id: 'prot-1',
      p_artifact_type: 'monitoring_prep_checklist',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.deliverable_id).toBe('del-1');
      expect(r.data?.blocks).toHaveLength(1);
      expect(r.data?.blocks[0].display_text).toBe('Verify: Age ≥ 18 years');
    }
  });

  it('treats a SQL NULL payload as ok:true with data null (no deliverable yet)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await fetchDeliverablePacket('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });

  it('surfaces the RPC error message on failure', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });
    const r = await fetchDeliverablePacket('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('permission denied');
  });

  it('rejects a non-null payload the adapter cannot shape as malformed — distinct from "no deliverable"', async () => {
    rpcMock.mockResolvedValueOnce({ data: 42, error: null });
    const r = await fetchDeliverablePacket('prot-1', 'monitoring_prep_checklist');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});

describe('fetchChangeSummary', () => {
  const summaryPayload = {
    log: {
      id: 'log-1',
      deliverable_id: 'del-1',
      generation_seq: 2,
      protocol_version: 'v2.0',
      generated_by: 'user-1',
      generated_at: '2026-07-05T09:00:00Z',
      blocks_created: 3,
      blocks_matched: 24,
      blocks_kept_flagged: 2,
      blocks_deleted: 1,
      removed_blocks: [
        {
          section_key: 'visit_window_verification',
          block_type: 'checklist_item',
          derived_text: 'Verify: Week 4 visit within ±3 days',
        },
      ],
    },
    new_blocks: [
      {
        id: 'blk-9',
        section_key: 'amendment_sensitive',
        display_text: 'Verify: New washout period of 14 days',
      },
    ],
    flagged_blocks: [],
    removed_blocks: [
      {
        section_key: 'visit_window_verification',
        block_type: 'checklist_item',
        derived_text: 'Verify: Week 4 visit within ±3 days',
      },
    ],
  };

  it('calls deliverable_get_change_summary with p_deliverable_id', async () => {
    rpcMock.mockResolvedValueOnce({ data: summaryPayload, error: null });
    const r = await fetchChangeSummary('del-1');
    expect(rpcMock).toHaveBeenCalledWith('deliverable_get_change_summary', {
      p_deliverable_id: 'del-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data?.log?.generation_seq).toBe(2);
      expect(r.data?.new_blocks).toHaveLength(1);
      expect(r.data?.removed_blocks).toHaveLength(1);
    }
  });

  it('treats a SQL NULL payload as ok:true with data null (nothing to summarize / not visible)', async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: null });
    const r = await fetchChangeSummary('del-1');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toBeNull();
  });

  it('surfaces the RPC error message on failure', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied' },
    });
    const r = await fetchChangeSummary('del-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('permission denied');
  });

  it('rejects a non-null payload the adapter cannot shape as malformed', async () => {
    rpcMock.mockResolvedValueOnce({ data: 'junk', error: null });
    const r = await fetchChangeSummary('del-1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('malformed RPC response');
  });
});
