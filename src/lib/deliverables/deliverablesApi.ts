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
  DeliverableGenerateResult,
  DeliverablePacket,
  DeliverablesResult,
} from '../../types/deliverables';
import { adaptDeliverablePacket } from './deliverablesAdapter';

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
