// =============================================================================
// divergenceApi — Result<T> per CLAUDE.md API convention. Reads are a direct
// RLS-gated table select (same posture as protocol_cohorts); the ONLY write is
// the protocol_divergence_set_status RPC (DEFINER, access-gated, appends to
// the dispositions trail). No throw outside programmer-error guards.
// =============================================================================

import { supabase } from '../supabase';
import type { Result } from '../site/siteApi';
import type { DivergenceRecord, DivergenceStatus } from '../../types/divergence';
import { adaptDivergenceRow, sortDivergences } from './divergenceAdapter';

export async function fetchProtocolDivergences(
  protocolId: string,
): Promise<Result<DivergenceRecord[]>> {
  try {
    const { data, error } = await supabase
      .from('protocol_divergences')
      .select('*')
      .eq('protocol_id', protocolId);
    if (error) return { ok: false, error: error.message };
    const records = (Array.isArray(data) ? data : [])
      .map(adaptDivergenceRow)
      .filter((r): r is DivergenceRecord => r !== null);
    return { ok: true, data: sortDivergences(records) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to load divergences' };
  }
}

/**
 * Transition a divergence's lifecycle status. The RPC enforces: valid status,
 * a REQUIRED note for resolved/dismissed (closability with accountability),
 * and appends — never rewrites — the disposition trail.
 */
export async function updateDivergenceStatus(
  divergenceId: string,
  status: DivergenceStatus,
  note: string | null,
): Promise<Result<DivergenceRecord>> {
  try {
    const { data, error } = await supabase.rpc('protocol_divergence_set_status', {
      p_divergence_id: divergenceId,
      p_status: status,
      p_note: note,
    });
    if (error) return { ok: false, error: error.message };
    const record = adaptDivergenceRow(data);
    if (!record) return { ok: false, error: 'Unexpected response shape from status update' };
    return { ok: true, data: record };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to update divergence' };
  }
}
