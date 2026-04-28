// =============================================================================
// Audit Mode — state history delta types
//
// state_history_deltas is the append-only audit trail. Every mutation to a
// tracked object writes one of these in the same DB transaction (enforced by
// RPC functions, not the client).
// =============================================================================

import type { TrackedObjectType } from './enums';

// One field's before/after pair, stored inside changed_fields JSONB.
export interface FieldDelta {
  from: unknown;
  to: unknown;
}

// changed_fields JSONB shape: only changed fields included, never a full snapshot.
export type ChangedFields = Record<string, FieldDelta>;

// Raw DB row shape (matches Postgres column names).
export interface StateHistoryDelta {
  id: string;
  object_type: TrackedObjectType;
  object_id: string;                            // polymorphic — no DB FK
  changed_fields: ChangedFields;
  actor_id: string;                             // auth.users.id
  reason: string | null;
  created_at: string;
}

// Hydrated history entry for UI rendering: actor name resolved via a JOIN to
// user_profiles. Returned by the getObjectHistory helper (Phase A task #27).
export interface HistoryEntry {
  id: string;
  object_type: TrackedObjectType;
  object_id: string;
  changed_fields: ChangedFields;
  actor_name: string;
  reason: string | null;
  created_at: string;
}
