-- =============================================================================
-- Audit Mode — stage advancement (replaces the broken 20260430120000 RPC)
--
-- D-010 transition rules (mirrors rv1_code/lib/audit-stage.ts):
--   Forward: must move exactly +1 stage. Gates may block.
--   Backward: any distance allowed. No gate. Auditors revisit prior stages.
--
-- Gates (forward only):
--   PRE_AUDIT_DRAFTING ← questionnaire.approved_at IS NOT NULL
--                        AND vendor_risk_summary.approval_status = 'APPROVED'
--   AUDIT_CONDUCT      ← all three deliverables (letter, agenda, checklist)
--                        approval_status = 'APPROVED'
--   Other transitions are ungated for now.
--
-- The previous migration (20260430120000_stage_advancement_rpc.sql) referenced
-- non-existent tables/columns (`risk_summary_objects`, custom delta column
-- names) and would have failed on first invocation. We DROP it explicitly
-- here rather than editing the historical migration so live deployments
-- replay cleanly. The tracked_object_type 'AUDIT' is used for the delta.
-- =============================================================================


DROP FUNCTION IF EXISTS advance_audit_stage(uuid, text);


-- -----------------------------------------------------------------------------
-- audit_mode_stage_index — small helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_stage_index(p_stage audit_stage)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'INTAKE'                 THEN 0
    WHEN 'VENDOR_ENRICHMENT'      THEN 1
    WHEN 'QUESTIONNAIRE_REVIEW'   THEN 2
    WHEN 'SCOPE_AND_RISK_REVIEW'  THEN 3
    WHEN 'PRE_AUDIT_DRAFTING'     THEN 4
    WHEN 'AUDIT_CONDUCT'          THEN 5
    WHEN 'REPORT_DRAFTING'        THEN 6
    WHEN 'FINAL_REVIEW_EXPORT'    THEN 7
  END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_advance_audit_stage
--
-- SECURITY INVOKER — RLS on `audits` already restricts UPDATE to the lead
-- auditor. We rely on it for authorisation rather than reimplementing.
-- Returns the updated row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_advance_audit_stage(
  p_audit_id uuid,
  p_to_stage audit_stage,
  p_reason   text DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user                       uuid := auth.uid();
  v_before                     audits;
  v_after                      audits;
  v_from_idx                   integer;
  v_to_idx                     integer;
  v_questionnaire_approved_at  timestamptz;
  v_risk_summary_status        risk_summary_approval_status;
  v_letter_status              deliverable_approval_status;
  v_agenda_status              deliverable_approval_status;
  v_checklist_status           deliverable_approval_status;
  v_blocked                    text[] := ARRAY[]::text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.current_stage = p_to_stage THEN
    RAISE EXCEPTION 'Audit is already at stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  v_from_idx := audit_mode_stage_index(v_before.current_stage);
  v_to_idx   := audit_mode_stage_index(p_to_stage);

  -- Forward: must move exactly +1 and gate must pass.
  IF v_to_idx > v_from_idx THEN
    IF v_to_idx - v_from_idx <> 1 THEN
      RAISE EXCEPTION 'Forward transitions must move exactly one stage (% → %)',
        v_before.current_stage, p_to_stage USING ERRCODE = '22023';
    END IF;

    -- Gate: PRE_AUDIT_DRAFTING needs questionnaire + risk summary approved.
    IF p_to_stage = 'PRE_AUDIT_DRAFTING' THEN
      SELECT qi.approved_at  INTO v_questionnaire_approved_at FROM questionnaire_instances qi WHERE qi.audit_id = p_audit_id;
      SELECT rs.approval_status INTO v_risk_summary_status     FROM vendor_risk_summary_objects rs WHERE rs.audit_id = p_audit_id;
      IF v_questionnaire_approved_at IS NULL THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: questionnaire is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_QUESTIONNAIRE_NOT_APPROVED';
      END IF;
      IF v_risk_summary_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: vendor risk summary is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_RISK_SUMMARY_NOT_APPROVED';
      END IF;
    END IF;

    -- Gate: AUDIT_CONDUCT needs all three deliverables approved.
    IF p_to_stage = 'AUDIT_CONDUCT' THEN
      SELECT cl.approval_status INTO v_letter_status    FROM confirmation_letter_objects cl WHERE cl.audit_id = p_audit_id;
      SELECT ag.approval_status INTO v_agenda_status    FROM agenda_objects ag             WHERE ag.audit_id = p_audit_id;
      SELECT ch.approval_status INTO v_checklist_status FROM checklist_objects ch          WHERE ch.audit_id = p_audit_id;

      IF v_letter_status    IS NULL OR v_letter_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'confirmation_letter'); END IF;
      IF v_agenda_status    IS NULL OR v_agenda_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'agenda');              END IF;
      IF v_checklist_status IS NULL OR v_checklist_status <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'checklist');           END IF;
      IF array_length(v_blocked, 1) > 0 THEN
        RAISE EXCEPTION 'Cannot enter AUDIT_CONDUCT: deliverables not approved (%)', array_to_string(v_blocked, ', ')
          USING ERRCODE = '42501', HINT = 'GATE_DELIVERABLES_NOT_APPROVED';
      END IF;
    END IF;
  END IF;
  -- Backward (v_to_idx < v_from_idx): allowed, no gate.

  UPDATE audits SET current_stage = p_to_stage WHERE id = p_audit_id RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'current_stage', jsonb_build_object('from', v_before.current_stage, 'to', v_after.current_stage)
    ),
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_get_stage_readout
--
-- Returns the data the workspace shell needs to render the stage indicator,
-- the advance button, and the gate-block reason — in one round-trip. Mirrors
-- rv1_code's getStageReadout() so the UI stays the same shape.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_get_stage_readout(p_audit_id uuid)
RETURNS TABLE (
  current_stage              audit_stage,
  stage_position             integer,
  total                      integer,
  questionnaire_approved     boolean,
  risk_summary_approved      boolean,
  letter_approved            boolean,
  agenda_approved            boolean,
  checklist_approved         boolean,
  next_stage                 audit_stage,
  can_advance                boolean,
  blocked_reason             text
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_audit_row             audits;
  v_q_approved_at         timestamptz;
  v_rs_status             risk_summary_approval_status;
  v_letter_status         deliverable_approval_status;
  v_agenda_status         deliverable_approval_status;
  v_checklist_status      deliverable_approval_status;
  v_idx                   integer;
  v_next                  audit_stage;
BEGIN
  SELECT * INTO v_audit_row FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT qi.approved_at      INTO v_q_approved_at    FROM questionnaire_instances qi      WHERE qi.audit_id = p_audit_id;
  SELECT rs.approval_status  INTO v_rs_status        FROM vendor_risk_summary_objects rs  WHERE rs.audit_id = p_audit_id;
  SELECT cl.approval_status  INTO v_letter_status    FROM confirmation_letter_objects cl  WHERE cl.audit_id = p_audit_id;
  SELECT ag.approval_status  INTO v_agenda_status    FROM agenda_objects ag               WHERE ag.audit_id = p_audit_id;
  SELECT ch.approval_status  INTO v_checklist_status FROM checklist_objects ch            WHERE ch.audit_id = p_audit_id;

  v_idx := audit_mode_stage_index(v_audit_row.current_stage);
  v_next := CASE v_idx
    WHEN 0 THEN 'VENDOR_ENRICHMENT'::audit_stage
    WHEN 1 THEN 'QUESTIONNAIRE_REVIEW'::audit_stage
    WHEN 2 THEN 'SCOPE_AND_RISK_REVIEW'::audit_stage
    WHEN 3 THEN 'PRE_AUDIT_DRAFTING'::audit_stage
    WHEN 4 THEN 'AUDIT_CONDUCT'::audit_stage
    WHEN 5 THEN 'REPORT_DRAFTING'::audit_stage
    WHEN 6 THEN 'FINAL_REVIEW_EXPORT'::audit_stage
    ELSE NULL
  END;

  current_stage          := v_audit_row.current_stage;
  stage_position         := v_idx + 1;
  total                  := 8;
  questionnaire_approved := v_q_approved_at IS NOT NULL;
  risk_summary_approved  := v_rs_status = 'APPROVED';
  letter_approved        := v_letter_status   = 'APPROVED';
  agenda_approved        := v_agenda_status   = 'APPROVED';
  checklist_approved     := v_checklist_status = 'APPROVED';
  next_stage             := v_next;

  -- Compute can_advance + blocked_reason against the upcoming gate.
  IF v_next IS NULL THEN
    can_advance    := FALSE;
    blocked_reason := NULL;
  ELSIF v_next = 'PRE_AUDIT_DRAFTING' AND NOT questionnaire_approved THEN
    can_advance    := FALSE;
    blocked_reason := 'Questionnaire not approved';
  ELSIF v_next = 'PRE_AUDIT_DRAFTING' AND NOT risk_summary_approved THEN
    can_advance    := FALSE;
    blocked_reason := 'Risk summary not approved';
  ELSIF v_next = 'AUDIT_CONDUCT' AND NOT (letter_approved AND agenda_approved AND checklist_approved) THEN
    can_advance    := FALSE;
    blocked_reason := 'Deliverables not approved';
  ELSE
    can_advance    := TRUE;
    blocked_reason := NULL;
  END IF;

  RETURN NEXT;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_stage_index(audit_stage)                    TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_advance_audit_stage(uuid, audit_stage, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_get_stage_readout(uuid)                      TO authenticated;
