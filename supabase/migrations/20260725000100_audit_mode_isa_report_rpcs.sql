-- =============================================================================
-- Audit Mode — ISA report draft RPCs
--
-- One upsert (the row is 1:1 with the audit). NULL params leave fields alone;
-- p_clear_* flags set nullable fields back to NULL ("return the section to
-- templated"). Deltas track every change under ISA_REPORT_DRAFT_OBJECT,
-- including verdict changes — the most consequential field in the report
-- carries the most legible trail.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_upsert_isa_report_draft(
  p_audit_id                 uuid,
  p_exec_summary             text             DEFAULT NULL,
  p_clear_exec_summary       boolean          DEFAULT FALSE,
  p_auditee_background       text             DEFAULT NULL,
  p_clear_auditee_background boolean          DEFAULT FALSE,
  p_opening_meeting          text             DEFAULT NULL,
  p_clear_opening_meeting    boolean          DEFAULT FALSE,
  p_closing_meeting          text             DEFAULT NULL,
  p_clear_closing_meeting    boolean          DEFAULT FALSE,
  p_site_verdict             isa_site_verdict DEFAULT NULL,
  p_clear_site_verdict       boolean          DEFAULT FALSE,
  p_site_verdict_text        text             DEFAULT NULL,
  p_clear_site_verdict_text  boolean          DEFAULT FALSE,
  p_response_due_days        integer          DEFAULT NULL,
  p_response_due_basis       text             DEFAULT NULL,
  p_reason                   text             DEFAULT NULL
)
RETURNS isa_report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_workflow audit_workflow_type;
  v_before   isa_report_draft_objects;
  v_after    isa_report_draft_objects;
  v_delta    jsonb := '{}'::jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT workflow_type INTO v_workflow FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;
  IF v_workflow <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'ISA report drafts are only available on investigator site audits'
      USING ERRCODE = '23514';
  END IF;

  IF p_response_due_basis IS NOT NULL
     AND p_response_due_basis NOT IN ('CALENDAR', 'BUSINESS') THEN
    RAISE EXCEPTION 'response_due_basis must be CALENDAR or BUSINESS' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_before FROM isa_report_draft_objects WHERE audit_id = p_audit_id;
  IF NOT FOUND THEN
    INSERT INTO isa_report_draft_objects (audit_id, created_by)
    VALUES (p_audit_id, v_user)
    RETURNING * INTO v_before;
  END IF;

  UPDATE isa_report_draft_objects
     SET exec_summary       = CASE WHEN p_clear_exec_summary THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_exec_summary, '')), ''), exec_summary) END,
         auditee_background = CASE WHEN p_clear_auditee_background THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_auditee_background, '')), ''), auditee_background) END,
         opening_meeting    = CASE WHEN p_clear_opening_meeting THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_opening_meeting, '')), ''), opening_meeting) END,
         closing_meeting    = CASE WHEN p_clear_closing_meeting THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_closing_meeting, '')), ''), closing_meeting) END,
         site_verdict       = CASE WHEN p_clear_site_verdict THEN NULL
                                   ELSE COALESCE(p_site_verdict, site_verdict) END,
         site_verdict_text  = CASE WHEN p_clear_site_verdict_text THEN NULL
                                   ELSE COALESCE(NULLIF(btrim(COALESCE(p_site_verdict_text, '')), ''), site_verdict_text) END,
         response_due_days  = COALESCE(p_response_due_days, response_due_days),
         response_due_basis = COALESCE(p_response_due_basis, response_due_basis)
   WHERE audit_id = p_audit_id
  RETURNING * INTO v_after;

  IF v_before.exec_summary IS DISTINCT FROM v_after.exec_summary THEN
    v_delta := v_delta || jsonb_build_object('exec_summary',
      jsonb_build_object('from', v_before.exec_summary, 'to', v_after.exec_summary));
  END IF;
  IF v_before.auditee_background IS DISTINCT FROM v_after.auditee_background THEN
    v_delta := v_delta || jsonb_build_object('auditee_background',
      jsonb_build_object('from', v_before.auditee_background, 'to', v_after.auditee_background));
  END IF;
  IF v_before.opening_meeting IS DISTINCT FROM v_after.opening_meeting THEN
    v_delta := v_delta || jsonb_build_object('opening_meeting',
      jsonb_build_object('from', v_before.opening_meeting, 'to', v_after.opening_meeting));
  END IF;
  IF v_before.closing_meeting IS DISTINCT FROM v_after.closing_meeting THEN
    v_delta := v_delta || jsonb_build_object('closing_meeting',
      jsonb_build_object('from', v_before.closing_meeting, 'to', v_after.closing_meeting));
  END IF;
  IF v_before.site_verdict IS DISTINCT FROM v_after.site_verdict THEN
    v_delta := v_delta || jsonb_build_object('site_verdict',
      jsonb_build_object('from', v_before.site_verdict, 'to', v_after.site_verdict));
  END IF;
  IF v_before.site_verdict_text IS DISTINCT FROM v_after.site_verdict_text THEN
    v_delta := v_delta || jsonb_build_object('site_verdict_text',
      jsonb_build_object('from', v_before.site_verdict_text, 'to', v_after.site_verdict_text));
  END IF;
  IF v_before.response_due_days IS DISTINCT FROM v_after.response_due_days THEN
    v_delta := v_delta || jsonb_build_object('response_due_days',
      jsonb_build_object('from', v_before.response_due_days, 'to', v_after.response_due_days));
  END IF;
  IF v_before.response_due_basis IS DISTINCT FROM v_after.response_due_basis THEN
    v_delta := v_delta || jsonb_build_object('response_due_basis',
      jsonb_build_object('from', v_before.response_due_basis, 'to', v_after.response_due_basis));
  END IF;

  IF v_delta <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'ISA_REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      v_delta,
      v_user,
      COALESCE(p_reason, 'Report draft updated')
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_can_view_tracked_object — full replacement adding the
-- ISA_REPORT_DRAFT_OBJECT branch (keeps NOTE/FINDING from #498/#500 and
-- ISSUE/CAPA from 20260707000300).
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
  ELSIF obj_type = 'ISA_FINDING_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM isa_finding_objects f
      JOIN audits a ON a.id = f.audit_id
     WHERE f.id = obj_id;
  ELSIF obj_type = 'ISA_REPORT_DRAFT_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM isa_report_draft_objects rp
      JOIN audits a ON a.id = rp.audit_id
     WHERE rp.id = obj_id;
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
GRANT EXECUTE ON FUNCTION audit_mode_upsert_isa_report_draft(
  uuid, text, boolean, text, boolean, text, boolean, text, boolean,
  isa_site_verdict, boolean, text, boolean, integer, text, text
) TO authenticated;
