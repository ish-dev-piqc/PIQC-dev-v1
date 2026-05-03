-- =============================================================================
-- Audit Mode — Stage 5 (Pre-Audit Drafting) mutation RPCs
--
-- Three structurally identical deliverable tables (confirmation_letter_objects,
-- agenda_objects, checklist_objects), each 1:1 with audit. We expose:
--   - upsert_<deliverable>(audit_id, content, reason?)
--   - approve_<deliverable>(id, reason?)
--
-- Per D-010 step 7: editing an APPROVED deliverable demotes it back to DRAFT
-- and clears approved_at/by. The upsert RPCs handle that automatically when
-- content actually changes.
--
-- Each table maps to its own tracked_object_type:
--   confirmation_letter_objects → CONFIRMATION_LETTER_OBJECT
--   agenda_objects              → AGENDA_OBJECT
--   checklist_objects           → CHECKLIST_OBJECT
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Confirmation Letter
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_confirmation_letter(
  p_audit_id uuid,
  p_content  jsonb,
  p_reason   text DEFAULT NULL
)
RETURNS confirmation_letter_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_before         confirmation_letter_objects;
  v_after          confirmation_letter_objects;
  v_diff           jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM confirmation_letter_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO confirmation_letter_objects (audit_id, content, approval_status)
    VALUES (p_audit_id, p_content, 'DRAFT')
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'CONFIRMATION_LETTER_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'content',         jsonb_build_object('from', NULL, 'to', v_after.content),
        'approval_status', jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Confirmation letter created')
    );
    RETURN v_after;
  END IF;

  v_content_changed := v_before.content IS DISTINCT FROM p_content;

  UPDATE confirmation_letter_objects SET
    content         = p_content,
    approval_status = CASE WHEN v_content_changed THEN 'DRAFT'::deliverable_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN v_content_changed THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN v_content_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'content',         v_before.content,
      'approval_status', v_before.approval_status
    ),
    jsonb_build_object(
      'content',         v_after.content,
      'approval_status', v_after.approval_status
    )
  );

  PERFORM audit_mode_write_delta(
    'CONFIRMATION_LETTER_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_content_changed THEN 'Confirmation letter edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_approve_confirmation_letter(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS confirmation_letter_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before confirmation_letter_objects;
  v_after  confirmation_letter_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM confirmation_letter_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Confirmation letter % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE confirmation_letter_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'CONFIRMATION_LETTER_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Confirmation letter approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Agenda
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_agenda(
  p_audit_id uuid,
  p_content  jsonb,
  p_reason   text DEFAULT NULL
)
RETURNS agenda_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_before         agenda_objects;
  v_after          agenda_objects;
  v_diff           jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM agenda_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO agenda_objects (audit_id, content, approval_status)
    VALUES (p_audit_id, p_content, 'DRAFT')
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'AGENDA_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'content',         jsonb_build_object('from', NULL, 'to', v_after.content),
        'approval_status', jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Agenda created')
    );
    RETURN v_after;
  END IF;

  v_content_changed := v_before.content IS DISTINCT FROM p_content;

  UPDATE agenda_objects SET
    content         = p_content,
    approval_status = CASE WHEN v_content_changed THEN 'DRAFT'::deliverable_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN v_content_changed THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN v_content_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('content', v_before.content, 'approval_status', v_before.approval_status),
    jsonb_build_object('content', v_after.content,  'approval_status', v_after.approval_status)
  );

  PERFORM audit_mode_write_delta(
    'AGENDA_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_content_changed THEN 'Agenda edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_approve_agenda(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS agenda_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before agenda_objects;
  v_after  agenda_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM agenda_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Agenda % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE agenda_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'AGENDA_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Agenda approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Checklist
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_checklist(
  p_audit_id uuid,
  p_content  jsonb,
  p_reason   text DEFAULT NULL
)
RETURNS checklist_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user           uuid := auth.uid();
  v_before         checklist_objects;
  v_after          checklist_objects;
  v_diff           jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM checklist_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO checklist_objects (audit_id, content, approval_status)
    VALUES (p_audit_id, p_content, 'DRAFT')
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'CHECKLIST_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'content',         jsonb_build_object('from', NULL, 'to', v_after.content),
        'approval_status', jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Checklist created')
    );
    RETURN v_after;
  END IF;

  v_content_changed := v_before.content IS DISTINCT FROM p_content;

  UPDATE checklist_objects SET
    content         = p_content,
    approval_status = CASE WHEN v_content_changed THEN 'DRAFT'::deliverable_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN v_content_changed THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN v_content_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('content', v_before.content, 'approval_status', v_before.approval_status),
    jsonb_build_object('content', v_after.content,  'approval_status', v_after.approval_status)
  );

  PERFORM audit_mode_write_delta(
    'CHECKLIST_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_content_changed THEN 'Checklist edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_approve_checklist(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS checklist_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before checklist_objects;
  v_after  checklist_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM checklist_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Checklist % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE checklist_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'CHECKLIST_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Checklist approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_upsert_confirmation_letter(uuid, jsonb, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_confirmation_letter(uuid, text)         TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_upsert_agenda(uuid, jsonb, text)                TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_agenda(uuid, text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_upsert_checklist(uuid, jsonb, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_checklist(uuid, text)                   TO authenticated;
