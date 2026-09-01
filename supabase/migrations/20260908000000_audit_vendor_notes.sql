-- =============================================================================
-- Audit Mode — vendor-audit notes pad (fieldwork lane, slice 1)
--
-- Vendor audits get the fieldwork notes pad the ISA lane already has, on the
-- SAME table (audit_note_objects — it has no stage/workflow constraint) with
-- ADDITIVE sibling RPCs: the applied ISA RPCs (20260723000100) raise on any
-- non-ISA workflow ("a vendor audit never has a pad") and are load-bearing
-- in prod, so they are not replaced — the vendor trio below mirrors their
-- bodies with the inverted guard.
--
-- Promotion target: slice 2 promotes accepted AI candidates into
-- audit_workspace_entry_objects, so a note needs a second, lane-specific
-- backlink next to promoted_finding_id (which FKs to isa_finding_objects).
-- A note is consumed by exactly one record in exactly one lane — the CHECK
-- makes that invariant structural.
--
-- Vendor notes carry body + is_positive only; isa_domain stays NULL
-- (vendor_domain is proposed by the drafting engine on candidates, never
-- forced at capture). Positive notes are excluded from drafting (slice 2),
-- same filter as the ISA engine.
--
-- Soft delete, delta-trailed under AUDIT_NOTE_OBJECT — the tracked type,
-- can_view branch, and delta contract already exist. Delete refuses a
-- promoted note (either backlink set): a note cited by a record must stay
-- resolvable for the trail (20260724000100 precedent).
-- =============================================================================

ALTER TABLE audit_note_objects
  ADD COLUMN promoted_entry_id UUID REFERENCES audit_workspace_entry_objects(id);

ALTER TABLE audit_note_objects
  ADD CONSTRAINT audit_note_objects_single_promotion
  CHECK (promoted_finding_id IS NULL OR promoted_entry_id IS NULL);

CREATE INDEX idx_audit_note_objects_promoted_entry
  ON audit_note_objects (promoted_entry_id)
  WHERE promoted_entry_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- audit_mode_create_vendor_note
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_vendor_note(
  p_audit_id    uuid,
  p_body        text,
  p_is_positive boolean DEFAULT FALSE,
  p_reason      text    DEFAULT NULL
)
RETURNS audit_note_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_after    audit_note_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'body must not be empty' USING ERRCODE = '23514';
  END IF;

  -- Inverted guard of the ISA create: this pad is the vendor-audit surface.
  -- RLS already hides other auditors' audits, so NOT FOUND covers both
  -- missing and inaccessible ids.
  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'VENDOR_AUDIT' THEN
    RAISE EXCEPTION 'Vendor notes are only available on vendor audits'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO audit_note_objects (audit_id, body, is_positive, created_by)
  VALUES (p_audit_id, btrim(p_body), p_is_positive, v_user)
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT_NOTE_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'body',        jsonb_build_object('from', NULL, 'to', v_after.body),
      'is_positive', jsonb_build_object('from', NULL, 'to', v_after.is_positive)
    ),
    v_user,
    COALESCE(p_reason, 'Note captured')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_vendor_note — NULL params leave the field alone
-- (audit_mode_update_workspace_entry semantics).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_vendor_note(
  p_id          uuid,
  p_body        text    DEFAULT NULL,
  p_is_positive boolean DEFAULT NULL,
  p_reason      text    DEFAULT NULL
)
RETURNS audit_note_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before audit_note_objects;
  v_after  audit_note_objects;
  v_delta  jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audit_note_objects WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF p_body IS NOT NULL AND length(btrim(p_body)) = 0 THEN
    RAISE EXCEPTION 'body must not be empty' USING ERRCODE = '23514';
  END IF;

  UPDATE audit_note_objects
     SET body        = COALESCE(btrim(p_body), body),
         is_positive = COALESCE(p_is_positive, is_positive)
   WHERE id = p_id
  RETURNING * INTO v_after;

  IF v_before.body IS DISTINCT FROM v_after.body THEN
    v_delta := v_delta || jsonb_build_object(
      'body', jsonb_build_object('from', v_before.body, 'to', v_after.body));
  END IF;
  IF v_before.is_positive IS DISTINCT FROM v_after.is_positive THEN
    v_delta := v_delta || jsonb_build_object(
      'is_positive', jsonb_build_object('from', v_before.is_positive, 'to', v_after.is_positive));
  END IF;

  IF v_delta <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'AUDIT_NOTE_OBJECT'::tracked_object_type,
      v_after.id,
      v_delta,
      v_user,
      COALESCE(p_reason, 'Note updated')
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_delete_vendor_note (soft delete; refuses a promoted note)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_delete_vendor_note(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS audit_note_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before audit_note_objects;
  v_after  audit_note_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audit_note_objects WHERE id = p_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found', p_id USING ERRCODE = 'P0002';
  END IF;
  IF v_before.promoted_entry_id IS NOT NULL OR v_before.promoted_finding_id IS NOT NULL THEN
    RAISE EXCEPTION 'Note is cited by an observation and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  UPDATE audit_note_objects
     SET deleted_at = NOW()
   WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT_NOTE_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'deleted_at', jsonb_build_object('from', NULL, 'to', v_after.deleted_at)
    ),
    v_user,
    COALESCE(p_reason, 'Note deleted')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants — anon revoked per the 20260727000000 precedent.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION audit_mode_create_vendor_note(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_update_vendor_note(uuid, text, boolean, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION audit_mode_delete_vendor_note(uuid, text)                FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION audit_mode_create_vendor_note(uuid, text, boolean, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION audit_mode_update_vendor_note(uuid, text, boolean, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION audit_mode_delete_vendor_note(uuid, text)                TO authenticated;
