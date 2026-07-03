-- =============================================================================
-- Audit Mode — Issues & CAPA mutation RPCs (Phase 3)
--
-- Separate file from the schema migration: the ISSUE_OBJECT / CAPA_OBJECT
-- tracked_object_type values added there cannot be referenced in the same
-- transaction that created them.
--
-- All functions SECURITY INVOKER — the via-audit RLS policies on
-- issue_objects / capa_objects do the gating. Every mutation writes a
-- state_history delta atomically (same transaction).
--
-- Draft-only contract enforced server-side:
--   - CAPA status moves only within DRAFT / NEEDS_REVISION / ACCEPTED.
--   - Editing an ACCEPTED CAPA's text demotes it to DRAFT (re-review required)
--     and stamps the demotion in the same delta.
--   - Any auditor text edit flips piqc_prefilled -> FALSE (provenance honesty).
--   - Export requires ACCEPTED. Export never changes status — "exported" is
--     bookkeeping, not a stronger approval state.
--   - Exported CAPAs are immutable: update_capa and set_capa_status reject a
--     CAPA whose exported_at is set. The exported artifact lives in the QMS;
--     letting the in-app record drift from it would be a silent divergence.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_create_issue — triage an issue, usually from a Stage 6 finding.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_issue(
  p_audit_id              uuid,
  p_title                 text,
  p_severity              provisional_impact,
  p_description           text    DEFAULT '',
  p_workspace_entry_id    uuid    DEFAULT NULL,
  p_regulatory_reportable boolean DEFAULT FALSE,
  p_sponsor_reportable    boolean DEFAULT FALSE,
  p_reason                text    DEFAULT NULL
)
RETURNS issue_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
  v_after issue_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_title)) = 0 THEN
    RAISE EXCEPTION 'title must not be empty' USING ERRCODE = '23514';
  END IF;

  -- The triage source, when given, must belong to the same audit — an issue
  -- must never cite another audit's finding.
  IF p_workspace_entry_id IS NOT NULL THEN
    PERFORM 1 FROM audit_workspace_entry_objects we
      WHERE we.id = p_workspace_entry_id AND we.audit_id = p_audit_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Workspace entry does not belong to this audit'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO issue_objects (
    audit_id, workspace_entry_id, title, description, severity,
    regulatory_reportable, sponsor_reportable, created_by
  ) VALUES (
    p_audit_id, p_workspace_entry_id, btrim(p_title), COALESCE(p_description, ''), p_severity,
    p_regulatory_reportable, p_sponsor_reportable, v_user
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'ISSUE_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'title',                 jsonb_build_object('from', NULL, 'to', v_after.title),
      'severity',              jsonb_build_object('from', NULL, 'to', v_after.severity),
      'workspace_entry_id',    jsonb_build_object('from', NULL, 'to', v_after.workspace_entry_id),
      'regulatory_reportable', jsonb_build_object('from', NULL, 'to', v_after.regulatory_reportable),
      'sponsor_reportable',    jsonb_build_object('from', NULL, 'to', v_after.sponsor_reportable)
    ),
    v_user,
    COALESCE(p_reason, 'Issue raised')
  );

  RETURN v_after;
END;
$$;



-- -----------------------------------------------------------------------------
-- audit_mode_create_capa — one CAPA per issue (UNIQUE enforces 1:1).
-- audit_id derives from the issue; p_piqc_prefilled marks a templated skeleton.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_capa(
  p_issue_id               uuid,
  p_root_cause_text        text    DEFAULT '',
  p_corrective_action_text text    DEFAULT '',
  p_preventive_action_text text    DEFAULT '',
  p_piqc_prefilled         boolean DEFAULT FALSE,
  p_reason                 text    DEFAULT NULL
)
RETURNS capa_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user     uuid := auth.uid();
  v_audit_id uuid;
  v_after    capa_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT audit_id INTO v_audit_id FROM issue_objects WHERE id = p_issue_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'IssueObject % not found', p_issue_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO capa_objects (
    issue_id, audit_id, root_cause_text, corrective_action_text,
    preventive_action_text, piqc_prefilled, created_by
  ) VALUES (
    p_issue_id, v_audit_id, COALESCE(p_root_cause_text, ''),
    COALESCE(p_corrective_action_text, ''), COALESCE(p_preventive_action_text, ''),
    p_piqc_prefilled, v_user
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CAPA_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'issue_id',       jsonb_build_object('from', NULL, 'to', v_after.issue_id),
      'status',         jsonb_build_object('from', NULL, 'to', v_after.status),
      'piqc_prefilled', jsonb_build_object('from', NULL, 'to', v_after.piqc_prefilled)
    ),
    v_user,
    COALESCE(p_reason, CASE WHEN p_piqc_prefilled THEN 'CAPA drafted (PIQC prefill)' ELSE 'CAPA drafted' END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_capa — text edits. Editing an ACCEPTED CAPA demotes it to
-- DRAFT in the same transaction; any auditor edit flips piqc_prefilled FALSE.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_capa(
  p_id                     uuid,
  p_root_cause_text        text DEFAULT NULL,
  p_corrective_action_text text DEFAULT NULL,
  p_preventive_action_text text DEFAULT NULL,
  p_reason                 text DEFAULT NULL
)
RETURNS capa_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before capa_objects;
  v_after  capa_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM capa_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CapaObject % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Exported CAPAs are immutable — the exported artifact lives in the QMS;
  -- mutating the in-app record after export would silently diverge from it.
  IF v_before.exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'CAPA has been exported and can no longer be modified'
      USING ERRCODE = '23514';
  END IF;

  UPDATE capa_objects SET
    root_cause_text        = COALESCE(p_root_cause_text,        root_cause_text),
    corrective_action_text = COALESCE(p_corrective_action_text, corrective_action_text),
    preventive_action_text = COALESCE(p_preventive_action_text, preventive_action_text),
    -- Draft-only contract: text edits invalidate a prior acceptance.
    status      = CASE WHEN v_before.status = 'ACCEPTED' THEN 'DRAFT'::capa_status ELSE v_before.status END,
    accepted_at = CASE WHEN v_before.status = 'ACCEPTED' THEN NULL ELSE accepted_at END,
    accepted_by = CASE WHEN v_before.status = 'ACCEPTED' THEN NULL ELSE accepted_by END,
    -- Provenance honesty: it is no longer a pure PIQC skeleton.
    piqc_prefilled = FALSE
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CAPA_OBJECT'::tracked_object_type,
    v_after.id,
    audit_mode_diff_jsonb(
      jsonb_build_object(
        'root_cause_text',        v_before.root_cause_text,
        'corrective_action_text', v_before.corrective_action_text,
        'preventive_action_text', v_before.preventive_action_text,
        'status',                 v_before.status,
        'piqc_prefilled',         v_before.piqc_prefilled
      ),
      jsonb_build_object(
        'root_cause_text',        v_after.root_cause_text,
        'corrective_action_text', v_after.corrective_action_text,
        'preventive_action_text', v_after.preventive_action_text,
        'status',                 v_after.status,
        'piqc_prefilled',         v_after.piqc_prefilled
      )
    ),
    v_user,
    COALESCE(p_reason,
      CASE WHEN v_before.status = 'ACCEPTED' THEN 'CAPA edited — demoted to draft for re-review'
           ELSE 'CAPA edited' END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_set_capa_status — the review verdicts. ACCEPTED stamps
-- accepted_at/by; moving off ACCEPTED clears them.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_set_capa_status(
  p_id     uuid,
  p_status capa_status,
  p_reason text DEFAULT NULL
)
RETURNS capa_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before capa_objects;
  v_after  capa_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM capa_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CapaObject % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Exported CAPAs are immutable — the exported artifact lives in the QMS;
  -- mutating the in-app record after export would silently diverge from it.
  IF v_before.exported_at IS NOT NULL THEN
    RAISE EXCEPTION 'CAPA has been exported and can no longer be modified'
      USING ERRCODE = '23514';
  END IF;

  UPDATE capa_objects SET
    status      = p_status,
    accepted_at = CASE WHEN p_status = 'ACCEPTED' THEN NOW() ELSE NULL END,
    accepted_by = CASE WHEN p_status = 'ACCEPTED' THEN v_user ELSE NULL END
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CAPA_OBJECT'::tracked_object_type,
    v_after.id,
    audit_mode_diff_jsonb(
      jsonb_build_object('status', v_before.status, 'accepted_at', v_before.accepted_at),
      jsonb_build_object('status', v_after.status,  'accepted_at', v_after.accepted_at)
    ),
    v_user,
    COALESCE(p_reason,
      CASE p_status
        WHEN 'ACCEPTED'       THEN 'CAPA accepted (ready to export)'
        WHEN 'NEEDS_REVISION' THEN 'CAPA sent back for revision'
        ELSE 'CAPA returned to draft'
      END)
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_mark_capa_exported — bookkeeping only; requires ACCEPTED.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_mark_capa_exported(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS capa_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before capa_objects;
  v_after  capa_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM capa_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CapaObject % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'CAPA must be ACCEPTED before export' USING ERRCODE = '23514';
  END IF;

  UPDATE capa_objects SET exported_at = NOW()
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'CAPA_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'exported_at', jsonb_build_object('from', v_before.exported_at, 'to', v_after.exported_at)
    ),
    v_user,
    COALESCE(p_reason, 'CAPA exported for QMS finalization')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Extend the polymorphic history-visibility function with the two new types.
-- Full replacement: this body is the 20260501010000 version plus the
-- ISSUE_OBJECT / CAPA_OBJECT branches.
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
GRANT EXECUTE ON FUNCTION audit_mode_create_issue(
  uuid, text, provisional_impact, text, uuid, boolean, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_create_capa(
  uuid, text, text, text, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_update_capa(
  uuid, text, text, text, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_set_capa_status(uuid, capa_status, text) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_mark_capa_exported(uuid, text) TO authenticated;
