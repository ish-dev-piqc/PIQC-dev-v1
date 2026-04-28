// =============================================================================
// State-history client helpers
//
// Thin TS wrappers around the audit-mode Postgres functions defined in
// supabase/migrations/20260427120200_audit_mode_state_history_helpers.sql.
//
// Phase B per-mutation RPCs (e.g. update_audit_stage) are responsible for
// writing deltas server-side inside a transaction — the client should never
// call write_delta directly. The exports here are read-only (history) plus a
// small client-side diff utility for cases where a Phase B RPC wants the
// caller to pass a pre-computed ChangedFields payload.
// =============================================================================

import { supabase } from '../supabase';
import type {
  ChangedFields,
  HistoryEntry,
  TrackedObjectType,
} from '../../types/audit';

// -----------------------------------------------------------------------------
// getObjectHistory — fetch the change history of one tracked object.
// Returns newest-first, capped at 100 rows. Empty array if the caller cannot
// see the underlying object (RLS-enforced).
// -----------------------------------------------------------------------------
export async function getObjectHistory(
  objectType: TrackedObjectType,
  objectId: string,
): Promise<HistoryEntry[]> {
  const { data, error } = await supabase.rpc('audit_mode_get_object_history', {
    p_object_type: objectType,
    p_object_id: objectId,
  });

  if (error) throw error;
  return (data ?? []) as HistoryEntry[];
}

// -----------------------------------------------------------------------------
// diffFields — compute a ChangedFields payload from two object snapshots.
//
// Mirrors the rv1_code Prisma helper. Only keys present in `after` are
// considered (caller controls the keyset). Comparison uses JSON.stringify so
// arrays and nested objects diff correctly without deep-equal libs.
//
// Use this when calling a Phase B RPC that takes a pre-computed delta. RPCs
// that compute their own deltas server-side (via audit_mode_diff_jsonb) do not
// need this.
// -----------------------------------------------------------------------------
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): ChangedFields {
  const delta: ChangedFields = {};
  for (const key of Object.keys(after) as Array<keyof T>) {
    const prev = before[key];
    const next = after[key];
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      delta[key as string] = { from: prev, to: next };
    }
  }
  return delta;
}
