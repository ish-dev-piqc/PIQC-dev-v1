-- =============================================================================
-- Audit Mode — evidence gap summary: RPC slice (PR-D3)
--
-- Companion to 20260905000000 (which added the enum value + table). Split so
-- the new tracked_object_type value is never referenced in the transaction
-- that added it (20260707000200 precedent).
--
-- Clones the internal-notification lifecycle (20260904000100) exactly:
--   - upsert:  demote-on-edit (content change → DRAFT, approval cleared),
--     readable 'AUDIT'-family deltas via audit_mode_write_delta; approved_at/
--     approved_by in the demote diff (the D1 improvement, kept)
--   - approve: CAS on updated_at with MISSING_EXPECTED_VERSION / STALE_CONTENT
--     hints
--   - apply-generation: content through the upsert (latch reused, never
--     duplicated), provenance stamped in the same transaction
--
-- Plus the audit_mode_can_view_tracked_object full replacement adding the
-- EVIDENCE_GAP_SUMMARY_OBJECT branch (keeps every branch from its latest
-- version in 20260904000100). Behavior for existing types is unchanged.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_can_view_tracked_object — full replacement adding the
-- EVIDENCE_GAP_SUMMARY_OBJECT branch.
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
  ELSIF obj_type = 'INTERNAL_NOTIFICATION_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM internal_notification_objects intn
      JOIN audits a ON a.id = intn.audit_id
     WHERE intn.id = obj_id;
  ELSIF obj_type = 'EVIDENCE_GAP_SUMMARY_OBJECT' THEN
    SELECT a.lead_auditor_id INTO v_lead
      FROM evidence_gap_summary_objects egs
      JOIN audits a ON a.id = egs.audit_id
     WHERE egs.id = obj_id;
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
-- Upsert — demote-on-edit
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_evidence_gap_summary(
  p_audit_id uuid,
  p_content  jsonb,
  p_reason   text DEFAULT NULL
)
RETURNS evidence_gap_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          evidence_gap_summary_objects;
  v_after           evidence_gap_summary_objects;
  v_diff            jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM evidence_gap_summary_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO evidence_gap_summary_objects (audit_id, content, approval_status)
    VALUES (p_audit_id, p_content, 'DRAFT')
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'EVIDENCE_GAP_SUMMARY_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'content',         jsonb_build_object('from', NULL, 'to', v_after.content),
        'approval_status', jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Evidence gap summary created')
    );
    RETURN v_after;
  END IF;

  v_content_changed := v_before.content IS DISTINCT FROM p_content;

  UPDATE evidence_gap_summary_objects SET
    content         = p_content,
    approval_status = CASE WHEN v_content_changed THEN 'DRAFT'::deliverable_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN v_content_changed THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN v_content_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  -- approved_at/approved_by in the demote diff (20260904000100 precedent):
  -- when a demote voids an approval, the trail records WHOSE approval cleared.
  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'content',         v_before.content,
      'approval_status', v_before.approval_status,
      'approved_at',     v_before.approved_at,
      'approved_by',     v_before.approved_by
    ),
    jsonb_build_object(
      'content',         v_after.content,
      'approval_status', v_after.approval_status,
      'approved_at',     v_after.approved_at,
      'approved_by',     v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'EVIDENCE_GAP_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_content_changed THEN 'Evidence gap summary edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Approve — CAS on updated_at (the version the reviewer actually saw)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_approve_evidence_gap_summary(
  p_id                  uuid,
  p_reason              text        DEFAULT NULL,
  p_expected_updated_at timestamptz DEFAULT NULL
)
RETURNS evidence_gap_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before evidence_gap_summary_objects;
  v_after  evidence_gap_summary_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_expected_updated_at IS NULL THEN
    RAISE EXCEPTION 'Approve requires the version being reviewed (expected_updated_at)'
      USING ERRCODE = '22023', HINT = 'MISSING_EXPECTED_VERSION';
  END IF;

  SELECT * INTO v_before FROM evidence_gap_summary_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence gap summary % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Atomic CAS in the UPDATE predicate (see approve_confirmation_letter).
  UPDATE evidence_gap_summary_objects SET
    approval_status = 'APPROVED',
    approved_at     = NOW(),
    approved_by     = v_user
  WHERE id = p_id
    AND updated_at = p_expected_updated_at
  RETURNING * INTO v_after;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidence gap summary changed since it was last reviewed'
      USING ERRCODE = '40001', HINT = 'STALE_CONTENT';
  END IF;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object('approval_status', v_before.approval_status, 'approved_at', v_before.approved_at, 'approved_by', v_before.approved_by),
    jsonb_build_object('approval_status', v_after.approval_status,  'approved_at', v_after.approved_at,  'approved_by', v_after.approved_by)
  );

  PERFORM audit_mode_write_delta(
    'EVIDENCE_GAP_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Evidence gap summary approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Apply generation — content through the upsert (demote latch reused), then
-- the provenance stamp in the same transaction.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_apply_evidence_gap_summary_generation(
  p_audit_id           uuid,
  p_content            jsonb,
  p_generation_refs    jsonb,
  p_grounding_snapshot jsonb,
  p_reason             text DEFAULT NULL
)
RETURNS evidence_gap_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after evidence_gap_summary_objects;
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

  v_after := audit_mode_upsert_evidence_gap_summary(
    p_audit_id,
    p_content,
    COALESCE(p_reason, 'Evidence gap summary drafted by PIQC from the register + protocol')
  );

  UPDATE evidence_gap_summary_objects SET
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
GRANT EXECUTE ON FUNCTION audit_mode_upsert_evidence_gap_summary(uuid, jsonb, text)                          TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_evidence_gap_summary(uuid, text, timestamptz)                   TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_apply_evidence_gap_summary_generation(uuid, jsonb, jsonb, jsonb, text)  TO authenticated;
