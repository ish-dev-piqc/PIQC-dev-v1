-- =============================================================================
-- Audit Mode — ISA stage-gate fail-closed hardening
--
-- Fixes FA-eecb2f2-eecb2f2-1d86c21f9518-AUD-M1 (confirmed high, workflow +
-- clinical-integrity).
--
-- audit_mode_stage_index (20260430200000) maps only the 8 VENDOR_AUDIT stages
-- (INTAKE..FINAL_REVIEW_EXPORT) and has no ELSE, so it returns NULL for all 7
-- ISA_* stages added later (20260709000000). In audit_mode_advance_audit_stage
-- the forward guard `IF v_to_idx > v_from_idx` evaluates to NULL — treated as
-- FALSE in PL/pgSQL — whenever either index is NULL, so the entire ordering +
-- gate block is skipped and execution falls through to an unconditional UPDATE.
-- That is a fail-OPEN transition for any pair involving an ISA_* stage, and it
-- becomes reachable the moment a Phase-2 ISA workspace wires an advance call to
-- the shared RPC (rows are already created at ISA_SITE_INTAKE by
-- audit_mode_create_audit / 20260709000100).
--
-- Fix: make the RPC fail CLOSED. If either stage is not in the advancement map,
-- RAISE rather than silently permit. We deliberately do NOT assign ISA stages
-- indices here: ISA is a separate 0..6 pipeline whose gate semantics are not yet
-- designed, and slotting ISA values into the shared vendor index would instead
-- open a *cross-workflow* hole (e.g. a vendor stage "advancing" into an ISA
-- stage as a +1 neighbour). Until ISA-specific gating lands, ISA advances are
-- rejected outright — safe, because Phase 1 ships ISA placeholders with no
-- advance caller. Only the function body changes (an added NULL guard); the
-- gate logic, delta write, and signature are otherwise identical to
-- 20260430200000. Append-only: CREATE OR REPLACE, historical migration untouched.
--
-- Owner: @rv61.
-- =============================================================================

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

  -- Fail closed: an unmapped stage (any ISA_* value — audit_mode_stage_index
  -- does not map these) must never bypass the ordering/gate checks by making the
  -- forward comparison NULL. Reject rather than fall through to the UPDATE.
  IF v_from_idx IS NULL OR v_to_idx IS NULL THEN
    RAISE EXCEPTION 'Stage transition not permitted: % → % is not in the advancement map',
      v_before.current_stage, p_to_stage
      USING ERRCODE = '22023', HINT = 'STAGE_NOT_IN_ADVANCEMENT_MAP';
  END IF;

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

GRANT EXECUTE ON FUNCTION audit_mode_advance_audit_stage(uuid, audit_stage, text) TO authenticated;
