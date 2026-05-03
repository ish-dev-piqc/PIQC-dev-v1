-- =============================================================================
-- Audit Mode — Stage 4 (Scope & Risk Review) mutation RPCs
--
-- RPCs for vendor_risk_summary_objects (1:1 with audit) and the
-- vendor_risk_summary_protocol_risks junction.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_upsert_risk_summary
--
-- Creates a risk summary for an audit if none exists, or updates the existing
-- one. study_context, narrative, focus_areas use NULL = "don't change" on
-- update; on create, NULL narrative defaults to '' (column is NOT NULL).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_upsert_risk_summary(
  p_audit_id      uuid,
  p_study_context jsonb DEFAULT NULL,
  p_narrative     text  DEFAULT NULL,
  p_focus_areas   text[] DEFAULT NULL,
  p_reason        text  DEFAULT NULL
)
RETURNS vendor_risk_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before vendor_risk_summary_objects;
  v_after  vendor_risk_summary_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO vendor_risk_summary_objects (
      audit_id, study_context, vendor_relevance_narrative, focus_areas, approval_status
    ) VALUES (
      p_audit_id,
      COALESCE(p_study_context, '{}'::jsonb),
      COALESCE(p_narrative, ''),
      COALESCE(p_focus_areas, '{}'),
      'DRAFT'
    )
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'study_context',              jsonb_build_object('from', NULL, 'to', v_after.study_context),
        'vendor_relevance_narrative', jsonb_build_object('from', NULL, 'to', v_after.vendor_relevance_narrative),
        'focus_areas',                jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.focus_areas)),
        'approval_status',            jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Risk summary created')
    );

    RETURN v_after;
  END IF;

  UPDATE vendor_risk_summary_objects SET
    study_context              = COALESCE(p_study_context, study_context),
    vendor_relevance_narrative = COALESCE(p_narrative,     vendor_relevance_narrative),
    focus_areas                = COALESCE(p_focus_areas,   focus_areas)
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'study_context',              v_before.study_context,
      'vendor_relevance_narrative', v_before.vendor_relevance_narrative,
      'focus_areas',                to_jsonb(v_before.focus_areas)
    ),
    jsonb_build_object(
      'study_context',              v_after.study_context,
      'vendor_relevance_narrative', v_after.vendor_relevance_narrative,
      'focus_areas',                to_jsonb(v_after.focus_areas)
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_approve_risk_summary
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_approve_risk_summary(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS vendor_risk_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_now    timestamptz := NOW();
  v_before vendor_risk_summary_objects;
  v_after  vendor_risk_summary_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk summary % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE vendor_risk_summary_objects SET
    approval_status = 'APPROVED',
    approved_at     = v_now,
    approved_by     = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'approval_status', v_before.approval_status,
      'approved_at',     v_before.approved_at,
      'approved_by',     v_before.approved_by
    ),
    jsonb_build_object(
      'approval_status', v_after.approval_status,
      'approved_at',     v_after.approved_at,
      'approved_by',     v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Risk summary approved')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_revoke_risk_summary_approval
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_revoke_risk_summary_approval(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS vendor_risk_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before vendor_risk_summary_objects;
  v_after  vendor_risk_summary_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk summary % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE vendor_risk_summary_objects SET
    approval_status = 'DRAFT',
    approved_at     = NULL,
    approved_by     = NULL
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'approval_status', v_before.approval_status,
      'approved_at',     v_before.approved_at,
      'approved_by',     v_before.approved_by
    ),
    jsonb_build_object(
      'approval_status', v_after.approval_status,
      'approved_at',     v_after.approved_at,
      'approved_by',     v_after.approved_by
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Risk summary approval revoked')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_link_protocol_risk_to_summary
-- audit_mode_unlink_protocol_risk_from_summary
--
-- Junction-table mutations. Recorded as deltas on the summary so the audit
-- trail captures which risks were in scope at any point in time.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_link_protocol_risk_to_summary(
  p_summary_id      uuid,
  p_protocol_risk_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO vendor_risk_summary_protocol_risks (risk_summary_id, protocol_risk_id)
  VALUES (p_summary_id, p_protocol_risk_id)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN FALSE; -- already linked
  END IF;

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    p_summary_id,
    jsonb_build_object(
      'linked_protocol_risk',
      jsonb_build_object('from', NULL, 'to', p_protocol_risk_id)
    ),
    v_user,
    COALESCE(p_reason, 'Protocol risk linked')
  );

  RETURN TRUE;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_unlink_protocol_risk_from_summary(
  p_summary_id      uuid,
  p_protocol_risk_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_deleted integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  DELETE FROM vendor_risk_summary_protocol_risks
   WHERE risk_summary_id = p_summary_id
     AND protocol_risk_id = p_protocol_risk_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN FALSE;
  END IF;

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    p_summary_id,
    jsonb_build_object(
      'unlinked_protocol_risk',
      jsonb_build_object('from', p_protocol_risk_id, 'to', NULL)
    ),
    v_user,
    COALESCE(p_reason, 'Protocol risk unlinked')
  );

  RETURN TRUE;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_upsert_risk_summary(uuid, jsonb, text, text[], text)         TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_approve_risk_summary(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_revoke_risk_summary_approval(uuid, text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_link_protocol_risk_to_summary(uuid, uuid, text)               TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_unlink_protocol_risk_from_summary(uuid, uuid, text)           TO authenticated;
