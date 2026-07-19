-- =============================================================================
-- Audit Mode — ISA notes pad mutation RPCs
--
-- Create / update / soft-delete for audit_note_objects. Each mutation writes a
-- state_history_delta atomically under tracked_object_type = AUDIT_NOTE_OBJECT
-- (same contract as every other audit mutation). SECURITY INVOKER — RLS on
-- audit_note_objects / audits scopes everything to the lead auditor.
--
-- Delete is SOFT (deleted_at) — see the schema migration header for why hard
-- delete is forbidden. The delete RPC is idempotent-guarded: deleting an
-- already-deleted note raises, so a stale UI can't silently double-log.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_create_isa_note
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_isa_note(
  p_audit_id    uuid,
  p_body        text,
  p_isa_domain  isa_domain DEFAULT NULL,
  p_is_positive boolean    DEFAULT FALSE,
  p_reason      text       DEFAULT NULL
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

  -- Notes are an ISA surface; a vendor audit never has a pad. RLS already
  -- hides other auditors' audits, so NOT FOUND covers both missing and
  -- inaccessible ids.
  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'Notes are only available on investigator site audits'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO audit_note_objects (audit_id, body, isa_domain, is_positive, created_by)
  VALUES (p_audit_id, btrim(p_body), p_isa_domain, p_is_positive, v_user)
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT_NOTE_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'body',        jsonb_build_object('from', NULL, 'to', v_after.body),
      'isa_domain',  jsonb_build_object('from', NULL, 'to', v_after.isa_domain),
      'is_positive', jsonb_build_object('from', NULL, 'to', v_after.is_positive)
    ),
    v_user,
    COALESCE(p_reason, 'Note captured')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_isa_note
--
-- Field semantics mirror audit_mode_update_workspace_entry: NULL params leave
-- the field alone; p_clear_isa_domain=TRUE clears the domain tag (applied
-- before p_isa_domain if both are somehow supplied).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_isa_note(
  p_id               uuid,
  p_body             text       DEFAULT NULL,
  p_isa_domain       isa_domain DEFAULT NULL,
  p_clear_isa_domain boolean    DEFAULT FALSE,
  p_is_positive      boolean    DEFAULT NULL,
  p_reason           text       DEFAULT NULL
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
         isa_domain  = CASE
                         WHEN p_clear_isa_domain THEN NULL
                         ELSE COALESCE(p_isa_domain, isa_domain)
                       END,
         is_positive = COALESCE(p_is_positive, is_positive)
   WHERE id = p_id
  RETURNING * INTO v_after;

  IF v_before.body IS DISTINCT FROM v_after.body THEN
    v_delta := v_delta || jsonb_build_object(
      'body', jsonb_build_object('from', v_before.body, 'to', v_after.body));
  END IF;
  IF v_before.isa_domain IS DISTINCT FROM v_after.isa_domain THEN
    v_delta := v_delta || jsonb_build_object(
      'isa_domain', jsonb_build_object('from', v_before.isa_domain, 'to', v_after.isa_domain));
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
-- audit_mode_delete_isa_note  (soft delete)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_delete_isa_note(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS audit_note_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after audit_note_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  UPDATE audit_note_objects
     SET deleted_at = NOW()
   WHERE id = p_id AND deleted_at IS NULL
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Note % not found', p_id USING ERRCODE = 'P0002';
  END IF;

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
-- audit_mode_can_view_tracked_object — full replacement adding the
-- AUDIT_NOTE_OBJECT branch (precedent: 20260707000300 for ISSUE/CAPA).
-- Note the branch does NOT filter deleted_at: deltas of soft-deleted notes
-- stay readable — that is the point of soft delete.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_can_view_tracked_object(
  obj_type tracked_object_type,
  obj_id   UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;

  IF obj_type = 'PROTOCOL_RISK_OBJECT' THEN
    RETURN TRUE;
  END IF;

  IF obj_type = 'AUDIT' THEN
    SELECT lead_auditor_id INTO v_lead FROM audits WHERE id = obj_id;
  ELSIF obj_type = 'VENDOR_SERVICE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_service_objects vs
      JOIN audits a ON a.id = vs.audit_id
     WHERE vs.id = obj_id;
  ELSIF obj_type = 'VENDOR_SERVICE_MAPPING_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_service_mapping_objects vm
      JOIN vendor_service_objects vs ON vs.id = vm.vendor_service_id
      JOIN audits a ON a.id = vs.audit_id
     WHERE vm.id = obj_id;
  ELSIF obj_type = 'TRUST_ASSESSMENT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM trust_assessment_objects t
      JOIN audits a ON a.id = t.audit_id
     WHERE t.id = obj_id;
  ELSIF obj_type = 'VENDOR_RISK_SUMMARY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM vendor_risk_summary_objects r
      JOIN audits a ON a.id = r.audit_id
     WHERE r.id = obj_id;
  ELSIF obj_type = 'QUESTIONNAIRE_INSTANCE' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM questionnaire_instances qi
      JOIN audits a ON a.id = qi.audit_id
     WHERE qi.id = obj_id;
  ELSIF obj_type = 'QUESTIONNAIRE_RESPONSE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM questionnaire_response_objects qr
      JOIN audits a ON a.id = qr.audit_id
     WHERE qr.id = obj_id;
  ELSIF obj_type = 'AUDIT_WORKSPACE_ENTRY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM audit_workspace_entry_objects we
      JOIN audits a ON a.id = we.audit_id
     WHERE we.id = obj_id;
  ELSIF obj_type = 'AUDIT_NOTE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM audit_note_objects n
      JOIN audits a ON a.id = n.audit_id
     WHERE n.id = obj_id;
  ELSIF obj_type = 'AMENDMENT_ALERT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM amendment_alerts al
      JOIN audits a ON a.id = al.audit_id
     WHERE al.id = obj_id;
  ELSIF obj_type = 'CONFIRMATION_LETTER_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM confirmation_letter_objects cl
      JOIN audits a ON a.id = cl.audit_id
     WHERE cl.id = obj_id;
  ELSIF obj_type = 'AGENDA_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM agenda_objects ag
      JOIN audits a ON a.id = ag.audit_id
     WHERE ag.id = obj_id;
  ELSIF obj_type = 'CHECKLIST_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM checklist_objects ch
      JOIN audits a ON a.id = ch.audit_id
     WHERE ch.id = obj_id;
  ELSIF obj_type = 'REPORT_DRAFT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM report_draft_objects rd
      JOIN audits a ON a.id = rd.audit_id
     WHERE rd.id = obj_id;
  ELSIF obj_type = 'ISSUE_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM issue_objects iss
      JOIN audits a ON a.id = iss.audit_id
     WHERE iss.id = obj_id;
  ELSIF obj_type = 'CAPA_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM capa_objects cp
      JOIN audits a ON a.id = cp.audit_id
     WHERE cp.id = obj_id;
  ELSE
    RETURN FALSE;
  END IF;

  RETURN v_lead IS NOT NULL AND v_lead = auth.uid();
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_isa_note(uuid, text, isa_domain, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_update_isa_note(uuid, text, isa_domain, boolean, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_delete_isa_note(uuid, text) TO authenticated;
