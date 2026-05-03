-- =============================================================================
-- Audit Mode — Stage 2 (Vendor Enrichment) mutation RPCs
--
-- Per-mutation RPCs for vendor_service_objects, vendor_service_mapping_objects,
-- and trust_assessment_objects. Each RPC performs the mutation AND writes a
-- state_history_deltas row in the same transaction, using
-- audit_mode_write_delta + audit_mode_diff_jsonb.
--
-- Calling convention for updates: NULL parameter = "don't change this field".
-- Nullable fields that need to be cleared (e.g. service_description, notes)
-- are not currently clearable via these RPCs — UI doesn't expose that gesture.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_derive_criticality
--
-- Deterministic, explainable criticality derivation from a protocol risk's
-- endpoint_tier × impact_surface, with a one-level bump if time_sensitive.
-- IMMUTABLE — same inputs always produce the same output.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_derive_criticality(
  p_endpoint_tier    endpoint_tier,
  p_impact_surface   impact_surface,
  p_time_sensitivity boolean
)
RETURNS derived_criticality
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_base derived_criticality;
BEGIN
  IF p_endpoint_tier = 'SUPPORTIVE' THEN
    v_base := 'LOW';
  ELSIF p_endpoint_tier = 'SECONDARY' THEN
    v_base := CASE p_impact_surface
      WHEN 'DATA_INTEGRITY' THEN 'MODERATE'::derived_criticality
      ELSE 'HIGH'::derived_criticality
    END;
  ELSIF p_endpoint_tier = 'SAFETY' THEN
    v_base := CASE p_impact_surface
      WHEN 'BOTH' THEN 'CRITICAL'::derived_criticality
      ELSE 'HIGH'::derived_criticality
    END;
  ELSE -- PRIMARY
    v_base := CASE p_impact_surface
      WHEN 'DATA_INTEGRITY' THEN 'HIGH'::derived_criticality
      ELSE 'CRITICAL'::derived_criticality
    END;
  END IF;

  IF NOT p_time_sensitivity THEN
    RETURN v_base;
  END IF;

  -- Bump up one level (CRITICAL stays at ceiling)
  RETURN CASE v_base
    WHEN 'LOW'      THEN 'MODERATE'::derived_criticality
    WHEN 'MODERATE' THEN 'HIGH'::derived_criticality
    WHEN 'HIGH'     THEN 'CRITICAL'::derived_criticality
    ELSE 'CRITICAL'::derived_criticality
  END;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_build_default_rationale
--
-- Human-readable explanation of the derivation, used as the default
-- criticality_rationale on mapping create when the caller doesn't supply one.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_build_default_rationale(
  p_endpoint_tier    endpoint_tier,
  p_impact_surface   impact_surface,
  p_time_sensitivity boolean
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'Derived from: '
      || lower(p_endpoint_tier::text) || ' endpoint, '
      || replace(lower(p_impact_surface::text), '_', ' ') || ' impact'
      || CASE WHEN p_time_sensitivity THEN ', time sensitive' ELSE '' END
      || '.';
$$;


-- =============================================================================
-- VENDOR SERVICE OBJECT
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_create_vendor_service(
  p_audit_id            uuid,
  p_service_name        text,
  p_service_type        text,
  p_service_description text DEFAULT NULL
)
RETURNS vendor_service_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_row  vendor_service_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO vendor_service_objects (
    audit_id, service_name, service_type, service_description
  ) VALUES (
    p_audit_id, p_service_name, p_service_type, p_service_description
  )
  RETURNING * INTO v_row;

  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_OBJECT'::tracked_object_type,
    v_row.id,
    jsonb_build_object(
      'service_name',        jsonb_build_object('from', NULL, 'to', v_row.service_name),
      'service_type',        jsonb_build_object('from', NULL, 'to', v_row.service_type),
      'service_description', jsonb_build_object('from', NULL, 'to', v_row.service_description)
    ),
    v_user,
    'Vendor service created'
  );

  RETURN v_row;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_update_vendor_service(
  p_id                  uuid,
  p_service_name        text DEFAULT NULL,
  p_service_type        text DEFAULT NULL,
  p_service_description text DEFAULT NULL,
  p_reason              text DEFAULT NULL
)
RETURNS vendor_service_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before vendor_service_objects;
  v_after  vendor_service_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_service_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vendor service % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE vendor_service_objects SET
    service_name        = COALESCE(p_service_name,        service_name),
    service_type        = COALESCE(p_service_type,        service_type),
    service_description = COALESCE(p_service_description, service_description)
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'service_name',        v_before.service_name,
      'service_type',        v_before.service_type,
      'service_description', v_before.service_description
    ),
    jsonb_build_object(
      'service_name',        v_after.service_name,
      'service_type',        v_after.service_type,
      'service_description', v_after.service_description
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_delete_vendor_service(
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
  v_before vendor_service_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_service_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Delta first so it's recorded even if delete cascades remove related state.
  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_OBJECT'::tracked_object_type,
    v_before.id,
    jsonb_build_object(
      'service_name',        jsonb_build_object('from', v_before.service_name,        'to', NULL),
      'service_type',        jsonb_build_object('from', v_before.service_type,        'to', NULL),
      'service_description', jsonb_build_object('from', v_before.service_description, 'to', NULL)
    ),
    v_user,
    COALESCE(p_reason, 'Vendor service deleted')
  );

  DELETE FROM vendor_service_objects WHERE id = p_id;
  RETURN TRUE;
END;
$$;


-- =============================================================================
-- VENDOR SERVICE MAPPING
--
-- On create, criticality is derived from the linked protocol_risk_object.
-- The auditor can override later via update_service_mapping.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_create_service_mapping(
  p_vendor_service_id    uuid,
  p_protocol_risk_id     uuid,
  p_rationale_override   text DEFAULT NULL
)
RETURNS vendor_service_mapping_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        uuid := auth.uid();
  v_risk        protocol_risk_objects;
  v_criticality derived_criticality;
  v_rationale   text;
  v_row         vendor_service_mapping_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_risk FROM protocol_risk_objects WHERE id = p_protocol_risk_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Protocol risk % not found', p_protocol_risk_id USING ERRCODE = 'P0002';
  END IF;

  v_criticality := audit_mode_derive_criticality(
    v_risk.endpoint_tier, v_risk.impact_surface, v_risk.time_sensitivity
  );
  v_rationale := COALESCE(
    p_rationale_override,
    audit_mode_build_default_rationale(
      v_risk.endpoint_tier, v_risk.impact_surface, v_risk.time_sensitivity
    )
  );

  INSERT INTO vendor_service_mapping_objects (
    vendor_service_id, protocol_risk_id, derived_criticality, criticality_rationale
  ) VALUES (
    p_vendor_service_id, p_protocol_risk_id, v_criticality, v_rationale
  )
  RETURNING * INTO v_row;

  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_MAPPING_OBJECT'::tracked_object_type,
    v_row.id,
    jsonb_build_object(
      'protocol_risk_id',      jsonb_build_object('from', NULL, 'to', v_row.protocol_risk_id),
      'derived_criticality',   jsonb_build_object('from', NULL, 'to', v_row.derived_criticality),
      'criticality_rationale', jsonb_build_object('from', NULL, 'to', v_row.criticality_rationale)
    ),
    v_user,
    'Service mapping created'
  );

  RETURN v_row;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_update_service_mapping(
  p_id                    uuid,
  p_derived_criticality   derived_criticality DEFAULT NULL,
  p_criticality_rationale text                DEFAULT NULL,
  p_reason                text                DEFAULT NULL
)
RETURNS vendor_service_mapping_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before vendor_service_mapping_objects;
  v_after  vendor_service_mapping_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_service_mapping_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service mapping % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE vendor_service_mapping_objects SET
    derived_criticality   = COALESCE(p_derived_criticality,   derived_criticality),
    criticality_rationale = COALESCE(p_criticality_rationale, criticality_rationale)
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'derived_criticality',   v_before.derived_criticality,
      'criticality_rationale', v_before.criticality_rationale
    ),
    jsonb_build_object(
      'derived_criticality',   v_after.derived_criticality,
      'criticality_rationale', v_after.criticality_rationale
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_MAPPING_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, 'Criticality updated by auditor')
  );

  RETURN v_after;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_delete_service_mapping(
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
  v_before vendor_service_mapping_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_service_mapping_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  PERFORM audit_mode_write_delta(
    'VENDOR_SERVICE_MAPPING_OBJECT'::tracked_object_type,
    v_before.id,
    jsonb_build_object(
      'protocol_risk_id',      jsonb_build_object('from', v_before.protocol_risk_id,      'to', NULL),
      'derived_criticality',   jsonb_build_object('from', v_before.derived_criticality,   'to', NULL),
      'criticality_rationale', jsonb_build_object('from', v_before.criticality_rationale, 'to', NULL)
    ),
    v_user,
    COALESCE(p_reason, 'Service mapping deleted')
  );

  DELETE FROM vendor_service_mapping_objects WHERE id = p_id;
  RETURN TRUE;
END;
$$;


-- =============================================================================
-- TRUST ASSESSMENT (1:1 with audit, upsert semantics)
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_upsert_trust_assessment(
  p_audit_id                  uuid,
  p_certifications_claimed    text[]              DEFAULT NULL,
  p_regulatory_claims         text[]              DEFAULT NULL,
  p_compliance_posture        compliance_posture  DEFAULT NULL,
  p_maturity_posture          maturity_posture    DEFAULT NULL,
  p_provisional_trust_posture trust_posture       DEFAULT NULL,
  p_risk_hypotheses           text[]              DEFAULT NULL,
  p_notes                     text                DEFAULT NULL,
  p_reason                    text                DEFAULT NULL
)
RETURNS trust_assessment_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before trust_assessment_objects;
  v_after  trust_assessment_objects;
  v_diff   jsonb;
  v_now    timestamptz := NOW();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM trust_assessment_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    -- Insert new — required NOT NULL fields must be provided.
    IF p_compliance_posture IS NULL
       OR p_maturity_posture IS NULL
       OR p_provisional_trust_posture IS NULL THEN
      RAISE EXCEPTION 'Trust assessment create requires posture fields'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO trust_assessment_objects (
      audit_id,
      certifications_claimed,
      regulatory_claims,
      compliance_posture,
      maturity_posture,
      provisional_trust_posture,
      risk_hypotheses,
      notes,
      assessed_by,
      assessed_at
    ) VALUES (
      p_audit_id,
      COALESCE(p_certifications_claimed, '{}'),
      COALESCE(p_regulatory_claims,      '{}'),
      p_compliance_posture,
      p_maturity_posture,
      p_provisional_trust_posture,
      COALESCE(p_risk_hypotheses, '{}'),
      p_notes,
      v_user,
      v_now
    )
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'TRUST_ASSESSMENT_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'certifications_claimed',    jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.certifications_claimed)),
        'regulatory_claims',         jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.regulatory_claims)),
        'compliance_posture',        jsonb_build_object('from', NULL, 'to', v_after.compliance_posture),
        'maturity_posture',          jsonb_build_object('from', NULL, 'to', v_after.maturity_posture),
        'provisional_trust_posture', jsonb_build_object('from', NULL, 'to', v_after.provisional_trust_posture),
        'risk_hypotheses',           jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.risk_hypotheses)),
        'notes',                     jsonb_build_object('from', NULL, 'to', v_after.notes)
      ),
      v_user,
      COALESCE(p_reason, 'Trust assessment created')
    );

    RETURN v_after;
  END IF;

  -- Update existing
  UPDATE trust_assessment_objects SET
    certifications_claimed    = COALESCE(p_certifications_claimed,    certifications_claimed),
    regulatory_claims         = COALESCE(p_regulatory_claims,         regulatory_claims),
    compliance_posture        = COALESCE(p_compliance_posture,        compliance_posture),
    maturity_posture          = COALESCE(p_maturity_posture,          maturity_posture),
    provisional_trust_posture = COALESCE(p_provisional_trust_posture, provisional_trust_posture),
    risk_hypotheses           = COALESCE(p_risk_hypotheses,           risk_hypotheses),
    notes                     = COALESCE(p_notes,                     notes),
    assessed_by               = v_user,
    assessed_at               = v_now
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'certifications_claimed',    to_jsonb(v_before.certifications_claimed),
      'regulatory_claims',         to_jsonb(v_before.regulatory_claims),
      'compliance_posture',        v_before.compliance_posture,
      'maturity_posture',          v_before.maturity_posture,
      'provisional_trust_posture', v_before.provisional_trust_posture,
      'risk_hypotheses',           to_jsonb(v_before.risk_hypotheses),
      'notes',                     v_before.notes
    ),
    jsonb_build_object(
      'certifications_claimed',    to_jsonb(v_after.certifications_claimed),
      'regulatory_claims',         to_jsonb(v_after.regulatory_claims),
      'compliance_posture',        v_after.compliance_posture,
      'maturity_posture',          v_after.maturity_posture,
      'provisional_trust_posture', v_after.provisional_trust_posture,
      'risk_hypotheses',           to_jsonb(v_after.risk_hypotheses),
      'notes',                     v_after.notes
    )
  );

  PERFORM audit_mode_write_delta(
    'TRUST_ASSESSMENT_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants — RPCs are SECURITY INVOKER so the underlying RLS policies still
-- enforce visibility/edit rights. We just expose the function call.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_vendor_service(uuid, text, text, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_update_vendor_service(uuid, text, text, text, text)      TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_delete_vendor_service(uuid, text)                        TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_create_service_mapping(uuid, uuid, text)                 TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_update_service_mapping(uuid, derived_criticality, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_delete_service_mapping(uuid, text)                       TO authenticated;
GRANT EXECUTE ON FUNCTION audit_mode_upsert_trust_assessment(uuid, text[], text[], compliance_posture, maturity_posture, trust_posture, text[], text, text) TO authenticated;
