-- =============================================================================
-- Audit Mode — Stage 3 (Questionnaire Review) mutation RPCs
--
-- RPCs for questionnaire_instances and questionnaire_response_objects.
-- Each mutation writes a state_history_deltas row in the same transaction.
--
-- Calling convention: NULL = "don't change". Lifecycle transitions stamp the
-- corresponding timestamp field (sent_to_vendor_at, vendor_responded_at, etc.)
-- on the new status.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_create_questionnaire_instance
--
-- One instance per audit (UNIQUE on audit_id). If template_version_id is NULL,
-- picks the most recent template_version (single seeded template in dev).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_questionnaire_instance(
  p_audit_id            uuid,
  p_template_version_id uuid DEFAULT NULL
)
RETURNS questionnaire_instances
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_tv_id   uuid := p_template_version_id;
  v_row     questionnaire_instances;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_tv_id IS NULL THEN
    SELECT id INTO v_tv_id
      FROM questionnaire_template_versions
     ORDER BY published_at DESC
     LIMIT 1;
    IF v_tv_id IS NULL THEN
      RAISE EXCEPTION 'No questionnaire template version available'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO questionnaire_instances (audit_id, template_version_id, status)
  VALUES (p_audit_id, v_tv_id, 'DRAFT')
  RETURNING * INTO v_row;

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_INSTANCE'::tracked_object_type,
    v_row.id,
    jsonb_build_object(
      'audit_id',            jsonb_build_object('from', NULL, 'to', v_row.audit_id),
      'template_version_id', jsonb_build_object('from', NULL, 'to', v_row.template_version_id),
      'status',              jsonb_build_object('from', NULL, 'to', v_row.status)
    ),
    v_user,
    'Questionnaire instance created'
  );

  RETURN v_row;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_transition_questionnaire_status
--
-- Moves through the lifecycle: DRAFT → PREFILL_IN_PROGRESS → READY_TO_SEND →
-- SENT_TO_VENDOR → VENDOR_RESPONDED → COMPLETE. Stamps the corresponding
-- timestamp on the new status. Allows arbitrary transitions in Phase B
-- (the UI exposes a free-form transition); we'll add gate checks later.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_transition_questionnaire_status(
  p_instance_id uuid,
  p_to_status   questionnaire_instance_status,
  p_reason      text DEFAULT NULL
)
RETURNS questionnaire_instances
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_now    timestamptz := NOW();
  v_before questionnaire_instances;
  v_after  questionnaire_instances;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM questionnaire_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionnaire instance % not found', p_instance_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE questionnaire_instances SET
    status              = p_to_status,
    sent_to_vendor_at   = CASE WHEN p_to_status = 'SENT_TO_VENDOR'    AND sent_to_vendor_at   IS NULL THEN v_now ELSE sent_to_vendor_at   END,
    vendor_responded_at = CASE WHEN p_to_status = 'VENDOR_RESPONDED'  AND vendor_responded_at IS NULL THEN v_now ELSE vendor_responded_at END,
    completed_at        = CASE WHEN p_to_status = 'COMPLETE'          AND completed_at        IS NULL THEN v_now ELSE completed_at        END
  WHERE id = p_instance_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'status',              v_before.status,
      'sent_to_vendor_at',   v_before.sent_to_vendor_at,
      'vendor_responded_at', v_before.vendor_responded_at,
      'completed_at',        v_before.completed_at
    ),
    jsonb_build_object(
      'status',              v_after.status,
      'sent_to_vendor_at',   v_after.sent_to_vendor_at,
      'vendor_responded_at', v_after.vendor_responded_at,
      'completed_at',        v_after.completed_at
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_INSTANCE'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_approve_questionnaire
--
-- Sets status = COMPLETE, stamps approved_at + approved_by + completed_at.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_approve_questionnaire(
  p_instance_id uuid,
  p_reason      text DEFAULT NULL
)
RETURNS questionnaire_instances
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_now    timestamptz := NOW();
  v_before questionnaire_instances;
  v_after  questionnaire_instances;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM questionnaire_instances WHERE id = p_instance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Questionnaire instance % not found', p_instance_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE questionnaire_instances SET
    status       = 'COMPLETE',
    completed_at = COALESCE(completed_at, v_now),
    approved_at  = v_now,
    approved_by  = v_user
  WHERE id = p_instance_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'status',       v_before.status,
      'completed_at', v_before.completed_at,
      'approved_at',  v_before.approved_at,
      'approved_by',  v_before.approved_by
    ),
    jsonb_build_object(
      'status',       v_after.status,
      'completed_at', v_after.completed_at,
      'approved_at',  v_after.approved_at,
      'approved_by',  v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_INSTANCE'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Questionnaire approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_upsert_questionnaire_response
--
-- Creates or updates a response by (instance_id, question_id). Sets
-- responded_by/responded_at when response_text is non-null. Derives
-- response_status if not explicitly provided.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_questionnaire_response(
  p_instance_id     uuid,
  p_question_id     uuid,
  p_response_text   text             DEFAULT NULL,
  p_response_status response_status  DEFAULT NULL,
  p_source          response_source  DEFAULT NULL,
  p_source_reference text            DEFAULT NULL,
  p_reason          text             DEFAULT NULL
)
RETURNS questionnaire_response_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user      uuid := auth.uid();
  v_audit_id  uuid;
  v_status    response_status;
  v_before    questionnaire_response_objects;
  v_after     questionnaire_response_objects;
  v_diff      jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Look up audit_id from the instance (denormalized onto response).
  SELECT audit_id INTO v_audit_id
    FROM questionnaire_instances
   WHERE id = p_instance_id;
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'Questionnaire instance % not found', p_instance_id
      USING ERRCODE = 'P0002';
  END IF;

  v_status := COALESCE(
    p_response_status,
    CASE
      WHEN p_response_text IS NULL OR length(trim(p_response_text)) = 0 THEN 'UNANSWERED'::response_status
      ELSE 'ANSWERED'::response_status
    END
  );

  SELECT * INTO v_before
    FROM questionnaire_response_objects
   WHERE instance_id = p_instance_id AND question_id = p_question_id;

  IF NOT FOUND THEN
    INSERT INTO questionnaire_response_objects (
      instance_id, question_id, audit_id,
      response_text, response_status, source, source_reference,
      responded_by, responded_at
    ) VALUES (
      p_instance_id, p_question_id, v_audit_id,
      p_response_text, v_status, COALESCE(p_source, 'AUDITOR_AUTHORED'::response_source), p_source_reference,
      CASE WHEN p_response_text IS NOT NULL THEN v_user ELSE NULL END,
      CASE WHEN p_response_text IS NOT NULL THEN NOW()  ELSE NULL END
    )
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'QUESTIONNAIRE_RESPONSE_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'question_id',      jsonb_build_object('from', NULL, 'to', v_after.question_id),
        'response_text',    jsonb_build_object('from', NULL, 'to', v_after.response_text),
        'response_status',  jsonb_build_object('from', NULL, 'to', v_after.response_status),
        'source',           jsonb_build_object('from', NULL, 'to', v_after.source),
        'source_reference', jsonb_build_object('from', NULL, 'to', v_after.source_reference)
      ),
      v_user,
      COALESCE(p_reason, 'Response created')
    );

    RETURN v_after;
  END IF;

  UPDATE questionnaire_response_objects SET
    response_text    = COALESCE(p_response_text,    response_text),
    response_status  = v_status,
    source           = COALESCE(p_source,           source),
    source_reference = COALESCE(p_source_reference, source_reference),
    responded_by     = CASE WHEN p_response_text IS NOT NULL THEN v_user ELSE responded_by END,
    responded_at     = CASE WHEN p_response_text IS NOT NULL THEN NOW()  ELSE responded_at END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'response_text',    v_before.response_text,
      'response_status',  v_before.response_status,
      'source',           v_before.source,
      'source_reference', v_before.source_reference
    ),
    jsonb_build_object(
      'response_text',    v_after.response_text,
      'response_status',  v_after.response_status,
      'source',           v_after.source,
      'source_reference', v_after.source_reference
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_RESPONSE_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_set_questionnaire_inconsistency
--
-- Allows the auditor to flag a response as inconsistent with prior evidence
-- (UI checkbox + note). Inconsistency is part of the audit narrative — gets
-- its own delta entry so reviewers can see when it was raised/cleared.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_set_questionnaire_inconsistency(
  p_response_id uuid,
  p_flag        boolean,
  p_note        text DEFAULT NULL,
  p_reason      text DEFAULT NULL
)
RETURNS questionnaire_response_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before questionnaire_response_objects;
  v_after  questionnaire_response_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM questionnaire_response_objects WHERE id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Response % not found', p_response_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE questionnaire_response_objects SET
    inconsistency_flag = p_flag,
    inconsistency_note = CASE WHEN p_flag THEN p_note ELSE NULL END
  WHERE id = p_response_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'inconsistency_flag', v_before.inconsistency_flag,
      'inconsistency_note', v_before.inconsistency_note
    ),
    jsonb_build_object(
      'inconsistency_flag', v_after.inconsistency_flag,
      'inconsistency_note', v_after.inconsistency_note
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_RESPONSE_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN p_flag THEN 'Inconsistency flagged' ELSE 'Inconsistency cleared' END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_questionnaire_instance(uuid, uuid)                                                  TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_transition_questionnaire_status(uuid, questionnaire_instance_status, text)                  TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_questionnaire(uuid, text)                                                           TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_upsert_questionnaire_response(uuid, uuid, text, response_status, response_source, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_set_questionnaire_inconsistency(uuid, boolean, text, text)                                  TO authenticated;
