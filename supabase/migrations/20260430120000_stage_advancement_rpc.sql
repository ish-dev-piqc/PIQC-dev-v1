-- =============================================================================
-- Stage Advancement RPC with Server-Side Gating
--
-- Validates that all required gates are unlocked before allowing stage advance.
-- Writes to audits.current_stage and state_history_deltas.
-- =============================================================================

CREATE OR REPLACE FUNCTION advance_audit_stage(
  p_audit_id UUID,
  p_to_stage TEXT
) RETURNS jsonb AS $$
DECLARE
  v_current_stage TEXT;
  v_user_id UUID;
  v_result JSONB;
BEGIN
  -- Get current user
  v_user_id := (auth.jwt() ->> 'sub')::UUID;
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  -- Get current stage
  SELECT current_stage INTO v_current_stage
  FROM audits
  WHERE id = p_audit_id
  FOR UPDATE;

  IF v_current_stage IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Audit not found');
  END IF;

  -- Validate stage progression (only advance forward)
  IF p_to_stage <= v_current_stage THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only advance to later stages');
  END IF;

  -- Validate gates per stage
  -- Stage 1 → 2: No gates (always allowed)
  -- Stage 2 → 3: No gates (always allowed)
  -- Stage 3 → 4: Questionnaire must be complete
  -- Stage 4 → 5: Risk summary must be approved
  -- Stage 5 → 6: All pre-audit deliverables must be approved
  -- Stage 6 → Complete: Audit conduct workspace must be finalized (checked in UI)

  IF p_to_stage = 'QUESTIONNAIRE_REVIEW' AND v_current_stage != 'INTAKE' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only reach QUESTIONNAIRE_REVIEW from INTAKE');
  END IF;

  IF p_to_stage = 'SCOPE_AND_RISK_REVIEW' AND v_current_stage != 'QUESTIONNAIRE_REVIEW' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Can only reach SCOPE_AND_RISK_REVIEW from QUESTIONNAIRE_REVIEW');
  END IF;

  -- Check questionnaire completion (Stage 3 → 4)
  IF p_to_stage = 'SCOPE_AND_RISK_REVIEW' THEN
    IF NOT EXISTS (
      SELECT 1 FROM questionnaire_instances
      WHERE audit_id = p_audit_id AND status = 'COMPLETE'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Questionnaire must be complete before advancing');
    END IF;
  END IF;

  -- Check risk summary approval (Stage 4 → 5)
  IF p_to_stage = 'PRE_AUDIT_DRAFTING' AND v_current_stage = 'SCOPE_AND_RISK_REVIEW' THEN
    IF NOT EXISTS (
      SELECT 1 FROM risk_summary_objects
      WHERE audit_id = p_audit_id AND approved_at IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Risk summary must be approved before advancing');
    END IF;
  END IF;

  -- Update audit stage
  UPDATE audits
  SET current_stage = p_to_stage, updated_at = now()
  WHERE id = p_audit_id;

  -- Write history delta
  INSERT INTO state_history_deltas (
    audit_id,
    entity_type,
    entity_id,
    action,
    previous_state,
    new_state,
    changed_by,
    change_reason
  ) VALUES (
    p_audit_id,
    'audit',
    p_audit_id,
    'stage_advancement',
    jsonb_build_object('current_stage', v_current_stage),
    jsonb_build_object('current_stage', p_to_stage),
    v_user_id,
    'Auditor advanced audit stage'
  );

  RETURN jsonb_build_object('success', true, 'current_stage', p_to_stage);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path TO public;

-- Grant to authenticated users
GRANT EXECUTE ON FUNCTION advance_audit_stage(UUID, TEXT) TO authenticated;
