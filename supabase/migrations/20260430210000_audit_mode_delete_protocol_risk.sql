-- =============================================================================
-- Audit Mode — delete_protocol_risk RPC
--
-- Companion to create_protocol_risk + update_protocol_risk in 190000.
-- Deletes a protocol_risk_object and writes a PROTOCOL_RISK_OBJECT delta
-- with from-values capturing the deleted state, so the audit trail can
-- reconstruct what was removed.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_delete_protocol_risk(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before protocol_risk_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM protocol_risk_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Write the delta first so it lands even if the DELETE cascades into
  -- referencing rows that mutate other state.
  PERFORM audit_mode_write_delta(
    'PROTOCOL_RISK_OBJECT'::tracked_object_type,
    v_before.id,
    jsonb_build_object(
      'section_identifier',      jsonb_build_object('from', v_before.section_identifier,      'to', NULL),
      'section_title',           jsonb_build_object('from', v_before.section_title,           'to', NULL),
      'endpoint_tier',           jsonb_build_object('from', v_before.endpoint_tier,           'to', NULL),
      'impact_surface',          jsonb_build_object('from', v_before.impact_surface,          'to', NULL),
      'time_sensitivity',        jsonb_build_object('from', v_before.time_sensitivity,        'to', NULL),
      'vendor_dependency_flags', jsonb_build_object('from', to_jsonb(v_before.vendor_dependency_flags), 'to', NULL),
      'operational_domain_tag',  jsonb_build_object('from', v_before.operational_domain_tag,  'to', NULL)
    ),
    v_user,
    COALESCE(p_reason, 'Protocol risk deleted')
  );

  DELETE FROM protocol_risk_objects WHERE id = p_id;
  RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_delete_protocol_risk(uuid, text) TO authenticated;
