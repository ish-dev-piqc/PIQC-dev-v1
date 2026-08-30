-- =============================================================================
-- Audit Mode — grounded generation fan-out: agenda + confirmation letter (PR-C2)
--
-- Mirrors 20260831000000 (checklist slice) for the other two Stage-5
-- deliverables. Same three provenance columns, same apply-RPC shape: content
-- goes through the EXISTING upsert (create/update deltas + content-changed →
-- DRAFT demotion reused, never duplicated), then the generation stamp lands in
-- the same transaction.
--
-- Letter note: the /audit-deliverable-draft edge function never sees
-- recipients (personnel names must not reach the model); the client merges the
-- current recipients into p_content before calling the apply RPC. The RPC
-- itself is shape-agnostic — content validity is the upsert's concern.
-- =============================================================================

ALTER TABLE agenda_objects
  ADD COLUMN generation_refs    JSONB
    CONSTRAINT agenda_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  ADD COLUMN grounding_snapshot JSONB
    CONSTRAINT agenda_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  ADD COLUMN generated_at       TIMESTAMPTZ;

ALTER TABLE confirmation_letter_objects
  ADD COLUMN generation_refs    JSONB
    CONSTRAINT confirmation_letter_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  ADD COLUMN grounding_snapshot JSONB
    CONSTRAINT confirmation_letter_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  ADD COLUMN generated_at       TIMESTAMPTZ;


CREATE OR REPLACE FUNCTION audit_mode_apply_agenda_generation(
  p_audit_id           uuid,
  p_content            jsonb,
  p_generation_refs    jsonb,
  p_grounding_snapshot jsonb,
  p_reason             text DEFAULT NULL
)
RETURNS agenda_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after agenda_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_generation_refs IS NULL OR jsonb_typeof(p_generation_refs) <> 'array' THEN
    RAISE EXCEPTION 'generation_refs must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF p_grounding_snapshot IS NULL OR jsonb_typeof(p_grounding_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'grounding_snapshot must be a JSON object' USING ERRCODE = '23514';
  END IF;

  v_after := audit_mode_upsert_agenda(
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Agenda drafted by PIQC from protocol + evidence')
  );

  UPDATE agenda_objects SET
    generation_refs    = p_generation_refs,
    grounding_snapshot = p_grounding_snapshot,
    generated_at       = NOW()
  WHERE id = v_after.id
  RETURNING * INTO v_after;

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_apply_confirmation_letter_generation(
  p_audit_id           uuid,
  p_content            jsonb,
  p_generation_refs    jsonb,
  p_grounding_snapshot jsonb,
  p_reason             text DEFAULT NULL
)
RETURNS confirmation_letter_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after confirmation_letter_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_generation_refs IS NULL OR jsonb_typeof(p_generation_refs) <> 'array' THEN
    RAISE EXCEPTION 'generation_refs must be a JSON array' USING ERRCODE = '23514';
  END IF;
  IF p_grounding_snapshot IS NULL OR jsonb_typeof(p_grounding_snapshot) <> 'object' THEN
    RAISE EXCEPTION 'grounding_snapshot must be a JSON object' USING ERRCODE = '23514';
  END IF;

  v_after := audit_mode_upsert_confirmation_letter(
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Confirmation letter drafted by PIQC from protocol + evidence')
  );

  UPDATE confirmation_letter_objects SET
    generation_refs    = p_generation_refs,
    grounding_snapshot = p_grounding_snapshot,
    generated_at       = NOW()
  WHERE id = v_after.id
  RETURNING * INTO v_after;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_apply_agenda_generation(uuid, jsonb, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_apply_confirmation_letter_generation(uuid, jsonb, jsonb, jsonb, text) TO authenticated;
