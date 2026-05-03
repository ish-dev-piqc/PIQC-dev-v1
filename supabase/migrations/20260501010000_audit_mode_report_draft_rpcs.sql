-- =============================================================================
-- Audit Mode — Stage 7-8 (Report Drafting / Final Review Export) RPCs
--
-- Four mutation RPCs on report_draft_objects:
--   audit_mode_upsert_report_draft   — create or edit the draft (Stage 7)
--   audit_mode_approve_report_draft  — approve the draft (Stage 7 gate)
--   audit_mode_final_sign_off_report — lock the audit (Stage 8)
--   audit_mode_mark_report_exported  — record export timestamp (Stage 8)
--
-- All mutations write state_history_deltas atomically in the same transaction.
-- Also updates audit_mode_can_view_tracked_object to handle the new type.
-- =============================================================================


-- =============================================================================
-- Update audit_mode_can_view_tracked_object to handle REPORT_DRAFT_OBJECT.
-- Must run before the RPCs below so state_history_deltas INSERT RLS passes.
-- =============================================================================

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
  ELSE
    RETURN FALSE;
  END IF;

  RETURN v_lead IS NOT NULL AND v_lead = auth.uid();
END;
$$;


-- =============================================================================
-- audit_mode_upsert_report_draft
--
-- Creates the report draft if none exists for the audit, or updates the
-- executive_summary and conclusions. Editing demotes an APPROVED draft back to
-- DRAFT and clears approved_at/by — matching the pre-audit deliverable pattern.
-- Returns the full updated row.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_upsert_report_draft(
  p_audit_id            uuid,
  p_executive_summary   text,
  p_conclusions         text,
  p_reason              text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          report_draft_objects;
  v_after           report_draft_objects;
  v_diff            jsonb;
  v_text_changed    boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO report_draft_objects (audit_id, executive_summary, conclusions, approval_status)
    VALUES (p_audit_id, p_executive_summary, p_conclusions, 'DRAFT')
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'executive_summary', jsonb_build_object('from', NULL, 'to', v_after.executive_summary),
        'conclusions',       jsonb_build_object('from', NULL, 'to', v_after.conclusions),
        'approval_status',   jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Report draft created')
    );
    RETURN v_after;
  END IF;

  v_text_changed := (v_before.executive_summary IS DISTINCT FROM p_executive_summary)
                 OR (v_before.conclusions IS DISTINCT FROM p_conclusions);

  UPDATE report_draft_objects SET
    executive_summary = p_executive_summary,
    conclusions       = p_conclusions,
    approval_status   = CASE WHEN v_text_changed THEN 'DRAFT'::deliverable_approval_status
                             ELSE approval_status END,
    approved_at       = CASE WHEN v_text_changed THEN NULL ELSE approved_at END,
    approved_by       = CASE WHEN v_text_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'executive_summary', v_before.executive_summary,
      'conclusions',       v_before.conclusions,
      'approval_status',   v_before.approval_status
    ),
    jsonb_build_object(
      'executive_summary', v_after.executive_summary,
      'conclusions',       v_after.conclusions,
      'approval_status',   v_after.approval_status
    )
  );

  IF v_diff <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      v_diff,
      v_user,
      p_reason
    );
  END IF;

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_upsert_report_draft(uuid, text, text, text)
  TO authenticated;


-- =============================================================================
-- audit_mode_approve_report_draft
--
-- Sets approval_status = APPROVED and stamps approved_at/by.
-- Called from Stage 7 after the auditor reviews the full draft.
-- Returns the updated row.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_approve_report_draft(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before report_draft_objects;
  v_after  report_draft_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE report_draft_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Report draft approved')
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_approve_report_draft(uuid, text)
  TO authenticated;


-- =============================================================================
-- audit_mode_final_sign_off_report
--
-- Stamps final_signed_off_at/by. Called from Stage 8 once all pre-export
-- gates pass. This is the GxP-significant lock action.
-- Returns the updated row.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_final_sign_off_report(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before report_draft_objects;
  v_after  report_draft_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_before.final_signed_off_at IS NOT NULL THEN
    RETURN v_before;
  END IF;

  UPDATE report_draft_objects SET
    final_signed_off_at = NOW(),
    final_signed_off_by = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('final_signed_off_at', v_before.final_signed_off_at),
    jsonb_build_object('final_signed_off_at', v_after.final_signed_off_at)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Audit final sign-off')
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_final_sign_off_report(uuid, text)
  TO authenticated;


-- =============================================================================
-- audit_mode_mark_report_exported
--
-- Stamps exported_at. Called when the auditor triggers a download from
-- Stage 8. Export itself is handled client-side; this records the timestamp.
-- Returns the updated row.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_mark_report_exported(
  p_id uuid
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_before report_draft_objects;
  v_after report_draft_objects;
  v_diff  jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report draft not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE report_draft_objects SET
    exported_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('exported_at', v_before.exported_at),
    jsonb_build_object('exported_at', v_after.exported_at)
  );

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    'Report exported'
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_mark_report_exported(uuid)
  TO authenticated;
