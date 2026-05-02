-- =============================================================================
-- Audit Mode — Stage 1 (Intake) mutation RPCs
--
-- ProtocolRiskObject is technically reference data — RLS allows authenticated
-- SELECT but no INSERT/UPDATE/DELETE policies (per the Phase 1 RLS migration).
-- Mutations therefore must go through SECURITY DEFINER RPCs that:
--   1. Verify the caller can write to this protocol_version (i.e. they're the
--      lead auditor on at least one audit using that version)
--   2. Perform the mutation
--   3. Write a state_history_delta in the same transaction
--
-- Phase 1 = MANUAL tagging only. Phase 2 PIQC-assisted ingest will append
-- suggestion_provenance via a different path (server-side, no auditor input).
-- This RPC always sets tagging_mode = 'MANUAL'; suggestion-aware variants get
-- their own RPCs when those features land.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_can_write_protocol_version (helper)
--
-- Returns TRUE iff the calling auditor leads any audit that points at this
-- protocol_version_id. Stage 1 reuses this for both create and update calls.
-- SECURITY DEFINER so it can read past RLS on the audits table.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_can_write_protocol_version(p_protocol_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM audits a
     WHERE a.protocol_version_id = p_protocol_version_id
       AND a.lead_auditor_id     = auth.uid()
  );
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_create_protocol_risk
--
-- Creates a manually-tagged ProtocolRiskObject on a protocol version the
-- caller can write to. Auto-stamps tagged_by/tagged_at and tagging_mode.
-- Returns the inserted row.
--
-- SECURITY DEFINER bypasses the absence of INSERT RLS on protocol_risk_objects
-- — but only after our explicit can_write_protocol_version() gate passes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_protocol_risk(
  p_protocol_version_id   uuid,
  p_section_identifier    text,
  p_section_title         text,
  p_endpoint_tier         endpoint_tier,
  p_impact_surface        impact_surface,
  p_time_sensitivity      boolean,
  p_vendor_dependency_flags text[],
  p_operational_domain_tag text,
  p_version_change_type   version_change_type DEFAULT 'ADDED',
  p_reason                text                DEFAULT NULL
)
RETURNS protocol_risk_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_after protocol_risk_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT audit_mode_can_write_protocol_version(p_protocol_version_id) THEN
    RAISE EXCEPTION 'Not authorised to write to protocol version %', p_protocol_version_id
      USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_section_identifier)) = 0 OR length(btrim(p_section_title)) = 0 THEN
    RAISE EXCEPTION 'section_identifier and section_title must not be empty'
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO protocol_risk_objects (
    protocol_version_id,
    section_identifier,
    section_title,
    endpoint_tier,
    impact_surface,
    time_sensitivity,
    vendor_dependency_flags,
    operational_domain_tag,
    tagging_mode,
    version_change_type,
    tagged_by,
    tagged_at
  ) VALUES (
    p_protocol_version_id,
    btrim(p_section_identifier),
    btrim(p_section_title),
    p_endpoint_tier,
    p_impact_surface,
    p_time_sensitivity,
    COALESCE(p_vendor_dependency_flags, '{}'::text[]),
    p_operational_domain_tag,
    'MANUAL',
    p_version_change_type,
    v_user,
    NOW()
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'PROTOCOL_RISK_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'section_identifier',      jsonb_build_object('from', NULL, 'to', v_after.section_identifier),
      'section_title',           jsonb_build_object('from', NULL, 'to', v_after.section_title),
      'endpoint_tier',           jsonb_build_object('from', NULL, 'to', v_after.endpoint_tier),
      'impact_surface',          jsonb_build_object('from', NULL, 'to', v_after.impact_surface),
      'time_sensitivity',        jsonb_build_object('from', NULL, 'to', v_after.time_sensitivity),
      'vendor_dependency_flags', jsonb_build_object('from', NULL, 'to', v_after.vendor_dependency_flags),
      'operational_domain_tag',  jsonb_build_object('from', NULL, 'to', v_after.operational_domain_tag),
      'tagging_mode',            jsonb_build_object('from', NULL, 'to', v_after.tagging_mode)
    ),
    v_user,
    COALESCE(p_reason, 'Initial tagging')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_protocol_risk
--
-- Updates editable fields on an existing ProtocolRiskObject. Only changed
-- fields end up in the delta. Section identifier and title are NOT editable
-- (those are anchored to the protocol structure); to retag a different
-- section, create a new risk object.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_protocol_risk(
  p_id                      uuid,
  p_endpoint_tier           endpoint_tier        DEFAULT NULL,
  p_impact_surface          impact_surface       DEFAULT NULL,
  p_time_sensitivity        boolean              DEFAULT NULL,
  p_vendor_dependency_flags text[]               DEFAULT NULL,
  p_operational_domain_tag  text                 DEFAULT NULL,
  p_version_change_type     version_change_type  DEFAULT NULL,
  p_reason                  text                 DEFAULT NULL
)
RETURNS protocol_risk_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before protocol_risk_objects;
  v_after  protocol_risk_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM protocol_risk_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ProtocolRiskObject % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT audit_mode_can_write_protocol_version(v_before.protocol_version_id) THEN
    RAISE EXCEPTION 'Not authorised to update risk on protocol version %', v_before.protocol_version_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE protocol_risk_objects SET
    endpoint_tier           = COALESCE(p_endpoint_tier,           endpoint_tier),
    impact_surface          = COALESCE(p_impact_surface,          impact_surface),
    time_sensitivity        = COALESCE(p_time_sensitivity,        time_sensitivity),
    vendor_dependency_flags = COALESCE(p_vendor_dependency_flags, vendor_dependency_flags),
    operational_domain_tag  = COALESCE(p_operational_domain_tag,  operational_domain_tag),
    version_change_type     = COALESCE(p_version_change_type,     version_change_type)
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'endpoint_tier',           v_before.endpoint_tier,
      'impact_surface',          v_before.impact_surface,
      'time_sensitivity',        v_before.time_sensitivity,
      'vendor_dependency_flags', v_before.vendor_dependency_flags,
      'operational_domain_tag',  v_before.operational_domain_tag,
      'version_change_type',     v_before.version_change_type
    ),
    jsonb_build_object(
      'endpoint_tier',           v_after.endpoint_tier,
      'impact_surface',          v_after.impact_surface,
      'time_sensitivity',        v_after.time_sensitivity,
      'vendor_dependency_flags', v_after.vendor_dependency_flags,
      'operational_domain_tag',  v_after.operational_domain_tag,
      'version_change_type',     v_after.version_change_type
    )
  );

  PERFORM audit_mode_write_delta(
    'PROTOCOL_RISK_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Note: there is no `delete_protocol_risk` RPC.
-- ProtocolRiskObjects are reference data with downstream references
-- (vendor_service_mapping_objects, audit_workspace_entry_objects). They are
-- corrected via update or marked with version_change_type = 'MODIFIED' on a
-- new amendment ingest, not deleted.


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_can_write_protocol_version(uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_create_protocol_risk(
  uuid, text, text, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_update_protocol_risk(
  uuid, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text
) TO authenticated;
