-- =============================================================================
-- Questionnaire approval lock (latch-integrity follow-up to 20260826000000).
--
-- audit_mode_upsert_questionnaire_response (20260430150000) could edit answers
-- after audit_mode_approve_questionnaire stamped approved_at/approved_by, and
-- the PRE_AUDIT_DRAFTING advance gate (20260430200000) checks only
-- qi.approved_at IS NULL — so post-approval edits left the gate green while
-- the approval attested to answers the approver never saw.
--
-- Unlike the risk summary (whose panel promises "Saving demotes to Draft"),
-- the questionnaire UI renders an approved instance read-only — the workflow
-- decision (2026-08-26, see plans/sixonelabs-piqc/audit-approval-latch-
-- followups.md) is that the DB enforces that lock rather than silently
-- demoting on a direct RPC call:
--
--   1. upsert_questionnaire_response and set_questionnaire_inconsistency
--      raise APPROVAL_LOCKED while the instance is approved. The instance row
--      is read FOR UPDATE so a concurrent approve can't stamp between the
--      check and the response write.
--   2. Reopening is the explicit, delta-logged status transition:
--      transition_questionnaire_status away from COMPLETE now also clears
--      approved_at/approved_by (previously it left them set, so a regressed
--      instance still passed the gate — the same latch lie by another door).
--
-- All three signatures are unchanged from 20260430150000 → plain CREATE OR
-- REPLACE (no PostgREST overload risk, existing grants preserved).
--
-- Deliberately NOT addressed here (named in the plan MD): response edits
-- before approval still don't bump questionnaire_instances.updated_at, so the
-- approve CAS (20260730000000) can't see mid-review answer edits. Closing
-- that needs the workspace to refetch the instance after each save — a
-- UI + context slice.
--
-- No type impact: no schema/column change.
-- =============================================================================


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
    completed_at        = CASE WHEN p_to_status = 'COMPLETE'          AND completed_at        IS NULL THEN v_now ELSE completed_at        END,
    -- Leaving COMPLETE revokes the approval: the stamps attest to a reviewed,
    -- final answer set, and the PRE_AUDIT_DRAFTING gate reads approved_at.
    approved_at         = CASE WHEN p_to_status <> 'COMPLETE' THEN NULL ELSE approved_at END,
    approved_by         = CASE WHEN p_to_status <> 'COMPLETE' THEN NULL ELSE approved_by END
  WHERE id = p_instance_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'status',              v_before.status,
      'sent_to_vendor_at',   v_before.sent_to_vendor_at,
      'vendor_responded_at', v_before.vendor_responded_at,
      'completed_at',        v_before.completed_at,
      'approved_at',         v_before.approved_at,
      'approved_by',         v_before.approved_by
    ),
    jsonb_build_object(
      'status',              v_after.status,
      'sent_to_vendor_at',   v_after.sent_to_vendor_at,
      'vendor_responded_at', v_after.vendor_responded_at,
      'completed_at',        v_after.completed_at,
      'approved_at',         v_after.approved_at,
      'approved_by',         v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'QUESTIONNAIRE_INSTANCE'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_before.approved_at IS NOT NULL AND p_to_status <> 'COMPLETE'
                            THEN 'Questionnaire reopened (approval revoked)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


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
  v_user        uuid := auth.uid();
  v_audit_id    uuid;
  v_approved_at timestamptz;
  v_status      response_status;
  v_before      questionnaire_response_objects;
  v_after       questionnaire_response_objects;
  v_diff        jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Look up audit_id from the instance (denormalized onto response).
  -- FOR UPDATE: holds the instance row so a concurrent approve serializes
  -- against this write — no window where an edit lands under a fresh stamp.
  SELECT audit_id, approved_at INTO v_audit_id, v_approved_at
    FROM questionnaire_instances
   WHERE id = p_instance_id
   FOR UPDATE;
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'Questionnaire instance % not found', p_instance_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Questionnaire is approved; responses are locked. Transition the instance out of COMPLETE to reopen it.'
      USING ERRCODE = '42501', HINT = 'APPROVAL_LOCKED';
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
  v_user        uuid := auth.uid();
  v_approved_at timestamptz;
  v_before      questionnaire_response_objects;
  v_after       questionnaire_response_objects;
  v_diff        jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM questionnaire_response_objects WHERE id = p_response_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Response % not found', p_response_id USING ERRCODE = 'P0002';
  END IF;

  -- Same lock as upsert_questionnaire_response: the inconsistency flag/note is
  -- part of the reviewed narrative the approval attests to.
  SELECT approved_at INTO v_approved_at
    FROM questionnaire_instances
   WHERE id = v_before.instance_id
   FOR UPDATE;

  IF v_approved_at IS NOT NULL THEN
    RAISE EXCEPTION 'Questionnaire is approved; responses are locked. Transition the instance out of COMPLETE to reopen it.'
      USING ERRCODE = '42501', HINT = 'APPROVAL_LOCKED';
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
