-- =============================================================================
-- Audit Mode — Stage 6 (Audit Conduct) mutation RPCs
--
-- AuditWorkspaceEntryObject — auditor's structured observations during
-- audit-day. Anchored optionally to a ProtocolRiskObject so risk attributes
-- inherit at write time (snapshot — not live-tracking).
--
-- D-008: only human-governed fields are exposed (provisional_impact +
-- provisional_classification). No coherence proposals, no automated flags.
--
-- Risk attribute inheritance:
--   When p_protocol_risk_id is supplied, endpoint_tier / impact_surface /
--   time_sensitivity are copied from the matching ProtocolRiskObject and
--   risk_attrs_inherited is set TRUE. These are stable snapshots — they do
--   not update if the upstream protocol_risk_object is later edited. The
--   amendment ingestion path (Phase 2) is what flips risk_context_outdated.
--
-- D-004: checkpoint_ref is plain text in Phase 1.
--
-- All mutations write deltas under tracked_object_type = AUDIT_WORKSPACE_ENTRY_OBJECT.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- audit_mode_create_workspace_entry
--
-- Creates a workspace entry for the active audit. If p_protocol_risk_id is
-- non-null, the corresponding risk's attribute snapshot is inherited.
-- Returns the inserted row.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_create_workspace_entry(
  p_audit_id                  uuid,
  p_vendor_domain             text,
  p_observation_text          text,
  p_provisional_impact        provisional_impact         DEFAULT 'NONE',
  p_provisional_classification provisional_classification DEFAULT 'NOT_YET_CLASSIFIED',
  p_checkpoint_ref            text  DEFAULT NULL,
  p_protocol_risk_id          uuid  DEFAULT NULL,
  p_vendor_service_mapping_id uuid  DEFAULT NULL,
  p_questionnaire_response_id uuid  DEFAULT NULL,
  p_reason                    text  DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user                       uuid := auth.uid();
  v_after                      audit_workspace_entry_objects;
  v_risk_attrs_inherited       boolean := FALSE;
  v_inherited_endpoint_tier    endpoint_tier;
  v_inherited_impact_surface   impact_surface;
  v_inherited_time_sensitivity boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF length(btrim(p_vendor_domain)) = 0 THEN
    RAISE EXCEPTION 'vendor_domain must not be empty' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(p_observation_text)) = 0 THEN
    RAISE EXCEPTION 'observation_text must not be empty' USING ERRCODE = '23514';
  END IF;

  -- Optional risk-attr inheritance snapshot
  IF p_protocol_risk_id IS NOT NULL THEN
    SELECT
      TRUE,
      pr.endpoint_tier,
      pr.impact_surface,
      pr.time_sensitivity
      INTO v_risk_attrs_inherited,
           v_inherited_endpoint_tier,
           v_inherited_impact_surface,
           v_inherited_time_sensitivity
      FROM protocol_risk_objects pr
     WHERE pr.id = p_protocol_risk_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'ProtocolRiskObject % not found', p_protocol_risk_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  INSERT INTO audit_workspace_entry_objects (
    audit_id,
    protocol_risk_id,
    vendor_service_mapping_id,
    questionnaire_response_id,
    checkpoint_ref,
    vendor_domain,
    observation_text,
    provisional_impact,
    provisional_classification,
    risk_attrs_inherited,
    inherited_endpoint_tier,
    inherited_impact_surface,
    inherited_time_sensitivity,
    created_by
  ) VALUES (
    p_audit_id,
    p_protocol_risk_id,
    p_vendor_service_mapping_id,
    p_questionnaire_response_id,
    p_checkpoint_ref,
    btrim(p_vendor_domain),
    btrim(p_observation_text),
    p_provisional_impact,
    p_provisional_classification,
    v_risk_attrs_inherited,
    v_inherited_endpoint_tier,
    v_inherited_impact_surface,
    v_inherited_time_sensitivity,
    v_user
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT_WORKSPACE_ENTRY_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'vendor_domain',              jsonb_build_object('from', NULL, 'to', v_after.vendor_domain),
      'observation_text',           jsonb_build_object('from', NULL, 'to', v_after.observation_text),
      'provisional_impact',         jsonb_build_object('from', NULL, 'to', v_after.provisional_impact),
      'provisional_classification', jsonb_build_object('from', NULL, 'to', v_after.provisional_classification),
      'checkpoint_ref',             jsonb_build_object('from', NULL, 'to', v_after.checkpoint_ref),
      'protocol_risk_id',           jsonb_build_object('from', NULL, 'to', v_after.protocol_risk_id),
      'risk_attrs_inherited',       jsonb_build_object('from', NULL, 'to', v_after.risk_attrs_inherited)
    ),
    v_user,
    COALESCE(p_reason, 'Workspace entry created')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- audit_mode_update_workspace_entry
--
-- Updates the editable fields on a workspace entry. Risk-attr snapshot fields
-- are NOT editable here — those are written once at create time and only
-- modified by the amendment-ingestion path. To re-link to a different risk,
-- delete and recreate the entry.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_update_workspace_entry(
  p_id                         uuid,
  p_vendor_domain              text                       DEFAULT NULL,
  p_observation_text           text                       DEFAULT NULL,
  p_provisional_impact         provisional_impact         DEFAULT NULL,
  p_provisional_classification provisional_classification DEFAULT NULL,
  p_checkpoint_ref             text                       DEFAULT NULL,
  p_clear_checkpoint_ref       boolean                    DEFAULT FALSE,
  p_reason                     text                       DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before audit_workspace_entry_objects;
  v_after  audit_workspace_entry_objects;
  v_diff   jsonb;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audit_workspace_entry_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WorkspaceEntry % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE audit_workspace_entry_objects SET
    vendor_domain              = COALESCE(NULLIF(btrim(p_vendor_domain), ''), vendor_domain),
    observation_text           = COALESCE(NULLIF(btrim(p_observation_text), ''), observation_text),
    provisional_impact         = COALESCE(p_provisional_impact, provisional_impact),
    provisional_classification = COALESCE(p_provisional_classification, provisional_classification),
    checkpoint_ref             = CASE
                                   WHEN p_clear_checkpoint_ref THEN NULL
                                   WHEN p_checkpoint_ref IS NOT NULL THEN btrim(p_checkpoint_ref)
                                   ELSE checkpoint_ref
                                 END
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'vendor_domain',              v_before.vendor_domain,
      'observation_text',           v_before.observation_text,
      'provisional_impact',         v_before.provisional_impact,
      'provisional_classification', v_before.provisional_classification,
      'checkpoint_ref',             v_before.checkpoint_ref
    ),
    jsonb_build_object(
      'vendor_domain',              v_after.vendor_domain,
      'observation_text',           v_after.observation_text,
      'provisional_impact',         v_after.provisional_impact,
      'provisional_classification', v_after.provisional_classification,
      'checkpoint_ref',             v_after.checkpoint_ref
    )
  );

  PERFORM audit_mode_write_delta(
    'AUDIT_WORKSPACE_ENTRY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;


-- NOTE: There is no `delete_workspace_entry` RPC. Audit observations are
-- corrected (via update) or annotated, never deleted. This matches the
-- rv1_code reference and the GxP-trail invariant that history is append-only.
-- If a true tombstone is ever needed, model it as a soft-delete column rather
-- than dropping the row (the state_history visibility check would otherwise
-- orphan its own delta).


-- -----------------------------------------------------------------------------
-- audit_mode_confirm_workspace_entry_risk_context
--
-- Auditor explicitly re-confirms an entry whose linked ProtocolRiskObject was
-- modified by a protocol amendment. Clears risk_context_outdated and stamps
-- risk_context_confirmed_{at,by}.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_confirm_workspace_entry_risk_context(
  p_id     uuid,
  p_reason text DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before audit_workspace_entry_objects;
  v_after  audit_workspace_entry_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audit_workspace_entry_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WorkspaceEntry % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE audit_workspace_entry_objects SET
    risk_context_outdated     = FALSE,
    risk_context_confirmed_at = NOW(),
    risk_context_confirmed_by = v_user
  WHERE id = p_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT_WORKSPACE_ENTRY_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'risk_context_outdated',     jsonb_build_object('from', v_before.risk_context_outdated,     'to', v_after.risk_context_outdated),
      'risk_context_confirmed_at', jsonb_build_object('from', v_before.risk_context_confirmed_at, 'to', v_after.risk_context_confirmed_at),
      'risk_context_confirmed_by', jsonb_build_object('from', v_before.risk_context_confirmed_by, 'to', v_after.risk_context_confirmed_by)
    ),
    v_user,
    COALESCE(p_reason, 'Risk context re-confirmed after amendment')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, uuid, uuid, uuid, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_update_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, boolean, text
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_confirm_workspace_entry_risk_context(uuid, text) TO authenticated;
