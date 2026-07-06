// =============================================================================
// deliverablesApi — Protocol Deliverable Engine read/generate layer.
//
// DeliverablesResult<T> wrappers around the engine RPCs (defined in
// supabase/migrations/20260708000100_deliverable_rpcs.sql):
//   deliverable_generate    — DEFINER; creates/regenerates the artifact.
//   deliverable_get_packet  — INVOKER; self-contained DeliverablePacket JSON
//                             (the client never joins SOTR tables).
//
// The adapter is invoked here (not in components) so the UI only ever sees
// the typed packet. No throw outside programmer-error guards; RPC errors and
// malformed payloads surface as ok:false. Error strings carry the RPC
// message only — never row content (source_quote / notes are SENSITIVE).
// =============================================================================

import { supabase } from '../supabase';
import type {
  DeliverableArtifactType,
  DeliverableChangeSummary,
  DeliverableGenerateResult,
  DeliverablePacket,
  DeliverablePortfolioEntry,
  DeliverableSummary,
  DeliverablesResult,
} from '../../types/deliverables';
import {
  adaptChangeSummary,
  adaptDeliverablePacket,
  adaptDeliverablePortfolio,
  adaptDeliverableSummaries,
} from './deliverablesAdapter';

/**
 * Generate (or regenerate) a deliverable for a protocol. Regeneration
 * preserves human work server-side — human_editorial blocks and any block
 * with a text overlay survive; see the RPC's regenerate semantics.
 */
export async function generateDeliverable(
  protocolId: string,
  artifactType: DeliverableArtifactType,
): Promise<DeliverablesResult<DeliverableGenerateResult>> {
  const { data, error } = await supabase.rpc('deliverable_generate', {
    p_protocol_id: protocolId,
    p_artifact_type: artifactType,
  });

  if (error) return { ok: false, error: error.message };

  // Defensive narrowing: if the JSON isn't the shape the RPC contracts,
  // fail the Result rather than crash the caller.
  const payload = data as Partial<DeliverableGenerateResult> | null;
  if (!payload || typeof payload.deliverable_id !== 'string') {
    return { ok: false, error: 'malformed RPC response' };
  }

  return {
    ok: true,
    data: {
      deliverable_id: payload.deliverable_id,
      blocks_created:
        typeof payload.blocks_created === 'number' ? payload.blocks_created : 0,
      blocks_preserved:
        typeof payload.blocks_preserved === 'number' ? payload.blocks_preserved : 0,
    },
  };
}

/**
 * Fetch the packet for a protocol's deliverable. A null RPC payload means
 * "no deliverable exists yet" (or the caller can't see it — RLS makes the
 * two indistinguishable on purpose) and is ok:true with data null, NOT an
 * error: the UI renders the generate call-to-action from it.
 */
export async function fetchDeliverablePacket(
  protocolId: string,
  artifactType: DeliverableArtifactType,
): Promise<DeliverablesResult<DeliverablePacket | null>> {
  const { data, error } = await supabase.rpc('deliverable_get_packet', {
    p_protocol_id: protocolId,
    p_artifact_type: artifactType,
  });

  if (error) return { ok: false, error: error.message };
  if (data === null || data === undefined) return { ok: true, data: null };

  // Non-null payload that doesn't adapt is malformed — distinct from "no
  // deliverable", which the RPC signals with SQL NULL.
  const packet = adaptDeliverablePacket(data);
  if (packet === null) return { ok: false, error: 'malformed RPC response' };

  return { ok: true, data: packet };
}

/**
 * Fetch the change summary for a deliverable (latest generation-log row +
 * new / flagged / removed lists). A SQL NULL payload means "no deliverable /
 * not visible" — ok:true with data null, same semantic as
 * fetchDeliverablePacket; the UI simply shows no banner.
 */
export async function fetchChangeSummary(
  deliverableId: string,
): Promise<DeliverablesResult<DeliverableChangeSummary | null>> {
  const { data, error } = await supabase.rpc('deliverable_get_change_summary', {
    p_deliverable_id: deliverableId,
  });

  if (error) return { ok: false, error: error.message };
  if (data === null || data === undefined) return { ok: true, data: null };

  // Non-null payload that doesn't adapt is malformed — distinct from the
  // RPC's SQL-NULL "nothing to summarize" answer.
  const summary = adaptChangeSummary(data);
  if (summary === null) return { ok: false, error: 'malformed RPC response' };

  return { ok: true, data: summary };
}

/**
 * Fetch the protocol's deliverable status board (one entry per existing
 * deliverable). An empty protocol — or one the caller can't access — returns
 * ok:true with an empty array (the RPC yields '[]', no existence leak). The
 * adapter runs here so the component only ever sees typed summaries.
 */
export async function fetchDeliverableSummaries(
  protocolId: string,
): Promise<DeliverablesResult<DeliverableSummary[]>> {
  const { data, error } = await supabase.rpc('deliverable_list_summary', {
    p_protocol_id: protocolId,
  });

  if (error) return { ok: false, error: error.message };

  // The RPC always returns a JSON array (COALESCE to '[]'); null/undefined
  // only on an unexpected shape — the adapter degrades either to [].
  return { ok: true, data: adaptDeliverableSummaries(data) };
}

/**
 * Fetch the cross-protocol portfolio digest (one entry per protocol the caller
 * can access that has deliverables). No arg — RLS scopes the result. A caller
 * with no accessible deliverables gets ok:true with an empty array.
 */
export async function fetchDeliverablePortfolio(): Promise<
  DeliverablesResult<DeliverablePortfolioEntry[]>
> {
  const { data, error } = await supabase.rpc('deliverable_portfolio_summary');

  if (error) return { ok: false, error: error.message };

  // Always a JSON array (COALESCE to '[]'); the adapter degrades any other
  // shape to [].
  return { ok: true, data: adaptDeliverablePortfolio(data) };
}
