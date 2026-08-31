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
