-- =============================================================================
-- Audit Mode — Stage 6 finding → SOTR protocol source link (B2)
--
-- Mirrors PR #57 (20260515010000_audit_mode_risk_source_link.sql) applied to
-- audit_workspace_entry_objects. Adds an optional nullable FK pointing at the
-- SOTR protocol_extracted_item that motivated the observation/finding. Turns
-- a Stage 6 entry into evidence-anchored audit work: "this finding traces
-- back to §X of the parsed protocol PDF."
--
-- Why this earns its weight beyond Stage 1:
--   - Stage 7's prefill (PR #62) synthesizes the executive summary from
--     workspace entries. A linked source item lets future Stage 7
--     enhancements cite the exact protocol section in the report. Even
--     without that, the provenance chain Stage 1 → Stage 6 makes the audit
--     trail GxP-defensible end-to-end, not just at the risk-tagging boundary.
--
-- Backward compat:
--   - Column is nullable; all existing workspace entries remain valid with NULL.
--   - ON DELETE SET NULL: if the source item disappears upstream (SOTR
--     re-parse, amendment ingest), the entry survives with the link cleared.
--
-- Cross-protocol gate:
--   The RPCs verify that the picked extracted item belongs to the SAME
--   protocols.id as the audit's protocol_version. Audit's protocol_version_id
--   is fetched first, then the existing helper from PR #57 runs:
--     extracted_item.document_id → documents.protocol_id
--     audit.protocol_version_id  → protocol_versions.protocol_id
--   Mismatch raises (23514).
--
-- Decision Debt (deferred):
--   No source_context_outdated flag mirroring risk_context_outdated. If the
--   linked extracted item disappears, ON DELETE SET NULL silently clears the
--   link with no proactive warning. Triggers for revisiting:
--     1. First customer report of "I linked a source and it disappeared"
--     2. Amendment-ingest feature ships and re-parses can null links in bulk
--     3. Stage 7 prefill begins referencing a workspace entry whose source
--        link silently nulled (user-visible degradation path)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
ALTER TABLE audit_workspace_entry_objects
  ADD COLUMN source_extracted_item_id UUID
    REFERENCES protocol_extracted_items(id) ON DELETE SET NULL;

CREATE INDEX idx_audit_workspace_entry_objects_source_extracted_item
  ON audit_workspace_entry_objects(source_extracted_item_id)
  WHERE source_extracted_item_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Replace audit_mode_create_workspace_entry to accept the new optional param.
--
-- DROP first because adding a parameter (even with DEFAULT) creates a new
-- function signature; without the drop, the old signature would linger and
-- silently shadow the new one for clients calling positionally.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_create_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, uuid, uuid, uuid, text
);

CREATE OR REPLACE FUNCTION audit_mode_create_workspace_entry(
  p_audit_id                   uuid,
  p_vendor_domain              text,
  p_observation_text           text,
  p_provisional_impact         provisional_impact         DEFAULT 'NONE',
  p_provisional_classification provisional_classification DEFAULT 'NOT_YET_CLASSIFIED',
  p_checkpoint_ref             text  DEFAULT NULL,
  p_protocol_risk_id           uuid  DEFAULT NULL,
  p_vendor_service_mapping_id  uuid  DEFAULT NULL,
  p_questionnaire_response_id  uuid  DEFAULT NULL,
  p_reason                     text  DEFAULT NULL,
  p_source_extracted_item_id   uuid  DEFAULT NULL
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
  v_protocol_version_id        uuid;
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

  -- Cross-protocol gate — only runs when a source link is actually being
  -- attached. Matches the update RPC's IS DISTINCT FROM short-circuit
  -- pattern; saves a protocol-version lookup on the common "create entry
  -- without source link" path. NB: this means we no longer validate the
  -- audit row's existence as a side effect of the gate — but the INSERT
  -- below would FK-fail on a bogus p_audit_id anyway, so behaviour is
  -- preserved (just with a different error code).
  IF p_source_extracted_item_id IS NOT NULL THEN
    SELECT protocol_version_id INTO v_protocol_version_id
      FROM audits
     WHERE id = p_audit_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
    END IF;

    IF NOT audit_mode_extracted_item_matches_protocol(
             p_source_extracted_item_id, v_protocol_version_id) THEN
      RAISE EXCEPTION 'Source extracted item does not belong to this audit''s protocol'
        USING ERRCODE = '23514';
    END IF;
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
    source_extracted_item_id,
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
    p_source_extracted_item_id,
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
      'risk_attrs_inherited',       jsonb_build_object('from', NULL, 'to', v_after.risk_attrs_inherited),
      'source_extracted_item_id',   jsonb_build_object('from', NULL, 'to', v_after.source_extracted_item_id)
    ),
    v_user,
    COALESCE(p_reason, 'Workspace entry created')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Replace audit_mode_update_workspace_entry with three-way source-link
-- semantics (mirror of PR #57's pattern on updateProtocolRisk).
--
-- Three-way semantics on source_extracted_item_id are needed because NULL
-- already means "don't change" in this RPC's COALESCE-based update pattern.
-- We accept BOTH p_source_extracted_item_id and p_clear_source_extracted_item_id:
--   - p_clear = TRUE                                  → set to NULL (unlink)
--   - p_clear = FALSE/NULL + p_source IS NOT NULL     → set to p_source
--   - p_clear = FALSE/NULL + p_source IS NULL         → unchanged
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_update_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, boolean, text
);

CREATE OR REPLACE FUNCTION audit_mode_update_workspace_entry(
  p_id                              uuid,
  p_vendor_domain                   text                       DEFAULT NULL,
  p_observation_text                text                       DEFAULT NULL,
  p_provisional_impact              provisional_impact         DEFAULT NULL,
  p_provisional_classification      provisional_classification DEFAULT NULL,
  p_checkpoint_ref                  text                       DEFAULT NULL,
  p_clear_checkpoint_ref            boolean                    DEFAULT FALSE,
  p_reason                          text                       DEFAULT NULL,
  p_source_extracted_item_id        uuid                       DEFAULT NULL,
  p_clear_source_extracted_item_id  boolean                    DEFAULT NULL
)
RETURNS audit_workspace_entry_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user                uuid := auth.uid();
  v_before              audit_workspace_entry_objects;
  v_after               audit_workspace_entry_objects;
  v_diff                jsonb;
  v_new_source          uuid;
  v_protocol_version_id uuid;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audit_workspace_entry_objects WHERE id = p_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WorkspaceEntry % not found', p_id USING ERRCODE = 'P0002';
  END IF;

  -- Resolve the new source value under three-way semantics.
  v_new_source := CASE
    WHEN COALESCE(p_clear_source_extracted_item_id, FALSE) THEN NULL
    WHEN p_source_extracted_item_id IS NOT NULL           THEN p_source_extracted_item_id
    ELSE v_before.source_extracted_item_id
  END;

  -- Only run the cross-protocol gate if the link actually changes — saves a
  -- join in the common "auditor edited the observation text" path.
  IF v_new_source IS DISTINCT FROM v_before.source_extracted_item_id THEN
    SELECT protocol_version_id INTO v_protocol_version_id
      FROM audits
     WHERE id = v_before.audit_id;

    IF NOT audit_mode_extracted_item_matches_protocol(
             v_new_source, v_protocol_version_id) THEN
      RAISE EXCEPTION 'Source extracted item does not belong to this audit''s protocol'
        USING ERRCODE = '23514';
    END IF;
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
                                 END,
    source_extracted_item_id   = v_new_source
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'vendor_domain',              v_before.vendor_domain,
      'observation_text',           v_before.observation_text,
      'provisional_impact',         v_before.provisional_impact,
      'provisional_classification', v_before.provisional_classification,
      'checkpoint_ref',             v_before.checkpoint_ref,
      'source_extracted_item_id',   v_before.source_extracted_item_id
    ),
    jsonb_build_object(
      'vendor_domain',              v_after.vendor_domain,
      'observation_text',           v_after.observation_text,
      'provisional_impact',         v_after.provisional_impact,
      'provisional_classification', v_after.provisional_classification,
      'checkpoint_ref',             v_after.checkpoint_ref,
      'source_extracted_item_id',   v_after.source_extracted_item_id
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


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_create_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, uuid, uuid, uuid, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_update_workspace_entry(
  uuid, text, text, provisional_impact, provisional_classification, text, boolean, text, uuid, boolean
) TO authenticated;
