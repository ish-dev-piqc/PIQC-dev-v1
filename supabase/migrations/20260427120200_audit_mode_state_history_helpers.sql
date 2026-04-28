-- =============================================================================
-- Audit Mode — state-delta infrastructure helpers
--
-- Provides three Postgres functions:
--
--   audit_mode_write_delta(...)        — internal helper used by per-mutation
--                                         RPCs to insert a state_history_deltas
--                                         row in the same transaction as the
--                                         mutation.
--   audit_mode_diff_jsonb(...)         — computes a ChangedFields-shaped JSONB
--                                         from before/after objects.
--   audit_mode_get_object_history(...) — public RPC, returns hydrated history
--                                         (actor name resolved from
--                                         user_profiles).
--
-- Phase B mutations get their own per-table RPCs (e.g. update_audit_stage,
-- create_protocol_risk_object, …). Those RPCs do mutation + write_delta
-- atomically inside one PL/pgSQL function; the client never calls write_delta
-- directly.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_write_delta
--
-- Used by per-mutation RPCs (Phase B) immediately after the mutation that
-- produced the changed fields. Skips the write when changed_fields is empty
-- (no actual change).
--
-- The RLS INSERT policy on state_history_deltas validates:
--   - p_actor_id = auth.uid()  (no spoofing)
--   - audit_mode_can_view_tracked_object(p_object_type, p_object_id)
-- so callers MUST pass the real auth.uid() as p_actor_id. Per-mutation RPCs
-- typically capture auth.uid() once and pass it through.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_write_delta(
  p_object_type    tracked_object_type,
  p_object_id      uuid,
  p_changed_fields jsonb,
  p_actor_id       uuid,
  p_reason         text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  v_id uuid;
BEGIN
  -- No-op if there are no changes.
  IF p_changed_fields IS NULL OR p_changed_fields = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  INSERT INTO state_history_deltas (
    object_type,
    object_id,
    changed_fields,
    actor_id,
    reason
  )
  VALUES (
    p_object_type,
    p_object_id,
    p_changed_fields,
    p_actor_id,
    p_reason
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_diff_jsonb
--
-- Computes a ChangedFields-shaped JSONB from two object snapshots.
-- Output: { "fieldName": { "from": <before>, "to": <after> } }
--
-- Only includes keys that exist in p_after (caller controls the keyset).
-- Compares by JSONB value identity, so arrays and nested objects diff correctly.
-- IMMUTABLE — same inputs always produce the same output.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_diff_jsonb(
  p_before jsonb,
  p_after  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_key    text;
  v_from   jsonb;
  v_to     jsonb;
BEGIN
  IF p_after IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_after) LOOP
    v_from := p_before -> v_key;
    v_to   := p_after  -> v_key;
    IF v_from IS DISTINCT FROM v_to THEN
      v_result := v_result || jsonb_build_object(
        v_key,
        jsonb_build_object('from', v_from, 'to', v_to)
      );
    END IF;
  END LOOP;

  RETURN v_result;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_get_object_history
--
-- Public RPC (called from React via supabase.rpc). Returns the change history
-- for one tracked object, newest-first, capped at 100 rows.
--
-- Joins user_profiles to resolve the actor name. INVOKER rights — RLS on
-- state_history_deltas enforces visibility. If the caller can't see the
-- underlying object, this returns an empty set.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_get_object_history(
  p_object_type tracked_object_type,
  p_object_id   uuid
)
RETURNS TABLE (
  id             uuid,
  object_type    tracked_object_type,
  object_id      uuid,
  changed_fields jsonb,
  actor_name     text,
  reason         text,
  created_at     timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    d.id,
    d.object_type,
    d.object_id,
    d.changed_fields,
    COALESCE(p.name, '(unknown user)') AS actor_name,
    d.reason,
    d.created_at
  FROM state_history_deltas d
  LEFT JOIN user_profiles p ON p.id = d.actor_id
  WHERE d.object_type = p_object_type
    AND d.object_id   = p_object_id
  ORDER BY d.created_at DESC
  LIMIT 100;
$$;


-- -----------------------------------------------------------------------------
-- Grant execute on the public RPC to authenticated users.
-- write_delta and diff_jsonb are internal helpers — not exposed to the client.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_get_object_history(tracked_object_type, uuid)
  TO authenticated;
