-- =============================================================================
-- Audit Mode — Stage 1 risk → SOTR protocol source link
--
-- Adds an optional nullable FK on protocol_risk_objects pointing at the SOTR
-- protocol_extracted_item that anchored the risk. Turns a manual risk tag
-- into an evidence-backed claim: "this risk traces back to §X of the parsed
-- protocol PDF."
--
-- Backward compat:
--   - Column is nullable; all existing risks remain valid with NULL.
--   - ON DELETE SET NULL: if a reviewer hard-deletes the source item upstream
--     (SOTR), the risk survives with the link cleared rather than cascading.
--
-- Cross-protocol gate:
--   The RPCs verify that the picked extracted item belongs to the SAME
--   protocols.id as the risk's protocol_version. Path:
--     extracted_item.document_id → documents.protocol_id
--     risk.protocol_version_id    → protocol_versions.protocol_id
--   Mismatch raises (23514). Keeps a risk on Protocol A from citing a parsed
--   item from Protocol B.
--
-- Delta:
--   source_extracted_item_id changes are written as their own field in the
--   PROTOCOL_RISK_OBJECT delta. History drawer surfaces "Source linked /
--   Source cleared" transitions automatically (no client changes needed).
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema
-- -----------------------------------------------------------------------------
ALTER TABLE protocol_risk_objects
  ADD COLUMN source_extracted_item_id UUID
    REFERENCES protocol_extracted_items(id) ON DELETE SET NULL;

CREATE INDEX idx_protocol_risk_objects_source_extracted_item
  ON protocol_risk_objects(source_extracted_item_id)
  WHERE source_extracted_item_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- Helper: cross-protocol membership check
--
-- Returns TRUE iff p_extracted_item_id belongs (via documents.protocol_id) to
-- the same protocol as p_protocol_version_id. NULL extracted_item is always OK
-- (it's the "no link" case). NULL protocol_version is never OK (data bug).
--
-- SECURITY DEFINER so it can read past RLS on documents / extracted_items —
-- callers are already gated by audit_mode_can_write_protocol_version().
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_extracted_item_matches_protocol(
  p_extracted_item_id    uuid,
  p_protocol_version_id  uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_extracted_item_id IS NULL
    OR EXISTS (
      SELECT 1
        FROM protocol_extracted_items ei
        JOIN documents          d  ON d.id  = ei.document_id
        JOIN protocol_versions  pv ON pv.id = p_protocol_version_id
       WHERE ei.id = p_extracted_item_id
         AND d.protocol_id IS NOT NULL
         AND d.protocol_id = pv.protocol_id
    );
$$;


-- -----------------------------------------------------------------------------
-- Replace audit_mode_create_protocol_risk to accept the new optional param.
--
-- DROP first because adding a parameter (even with DEFAULT) creates a new
-- function signature; without the drop, the old signature would linger and
-- silently shadow the new one for clients calling positionally.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_create_protocol_risk(
  uuid, text, text, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text
);

CREATE OR REPLACE FUNCTION audit_mode_create_protocol_risk(
  p_protocol_version_id      uuid,
  p_section_identifier       text,
  p_section_title            text,
  p_endpoint_tier            endpoint_tier,
  p_impact_surface           impact_surface,
  p_time_sensitivity         boolean,
  p_vendor_dependency_flags  text[],
  p_operational_domain_tag   text,
  p_version_change_type      version_change_type DEFAULT 'ADDED',
  p_reason                   text                DEFAULT NULL,
  p_source_extracted_item_id uuid                DEFAULT NULL
)
RETURNS protocol_risk_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user  uuid := auth.uid();
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

  IF NOT audit_mode_extracted_item_matches_protocol(
           p_source_extracted_item_id, p_protocol_version_id) THEN
    RAISE EXCEPTION 'Source extracted item does not belong to this protocol'
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
    tagged_at,
    source_extracted_item_id
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
    NOW(),
    p_source_extracted_item_id
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'PROTOCOL_RISK_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'section_identifier',       jsonb_build_object('from', NULL, 'to', v_after.section_identifier),
      'section_title',            jsonb_build_object('from', NULL, 'to', v_after.section_title),
      'endpoint_tier',            jsonb_build_object('from', NULL, 'to', v_after.endpoint_tier),
      'impact_surface',           jsonb_build_object('from', NULL, 'to', v_after.impact_surface),
      'time_sensitivity',         jsonb_build_object('from', NULL, 'to', v_after.time_sensitivity),
      'vendor_dependency_flags',  jsonb_build_object('from', NULL, 'to', v_after.vendor_dependency_flags),
      'operational_domain_tag',   jsonb_build_object('from', NULL, 'to', v_after.operational_domain_tag),
      'tagging_mode',             jsonb_build_object('from', NULL, 'to', v_after.tagging_mode),
      'source_extracted_item_id', jsonb_build_object('from', NULL, 'to', v_after.source_extracted_item_id)
    ),
    v_user,
    COALESCE(p_reason, 'Initial tagging')
  );

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Replace audit_mode_update_protocol_risk to accept the new optional param.
--
-- Three-way semantics on source_extracted_item_id are needed because NULL
-- already means "don't change" in this RPC's COALESCE-based update pattern.
-- So we accept BOTH p_source_extracted_item_id (the new value) and
-- p_clear_source_extracted_item_id (boolean — explicitly set to NULL).
--   - p_clear = TRUE     → set to NULL (auditor unlinked)
--   - p_clear = FALSE/NULL + p_source IS NOT NULL → set to p_source
--   - p_clear = FALSE/NULL + p_source IS NULL     → unchanged
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_update_protocol_risk(
  uuid, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text
);

CREATE OR REPLACE FUNCTION audit_mode_update_protocol_risk(
  p_id                              uuid,
  p_endpoint_tier                   endpoint_tier        DEFAULT NULL,
  p_impact_surface                  impact_surface       DEFAULT NULL,
  p_time_sensitivity                boolean              DEFAULT NULL,
  p_vendor_dependency_flags         text[]               DEFAULT NULL,
  p_operational_domain_tag          text                 DEFAULT NULL,
  p_version_change_type             version_change_type  DEFAULT NULL,
  p_reason                          text                 DEFAULT NULL,
  p_source_extracted_item_id        uuid                 DEFAULT NULL,
  p_clear_source_extracted_item_id  boolean              DEFAULT NULL
)
RETURNS protocol_risk_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user             uuid := auth.uid();
  v_before           protocol_risk_objects;
  v_after            protocol_risk_objects;
  v_diff             jsonb;
  v_new_source       uuid;
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

  -- Resolve the new source value under three-way semantics.
  v_new_source := CASE
    WHEN COALESCE(p_clear_source_extracted_item_id, FALSE) THEN NULL
    WHEN p_source_extracted_item_id IS NOT NULL           THEN p_source_extracted_item_id
    ELSE v_before.source_extracted_item_id
  END;

  IF NOT audit_mode_extracted_item_matches_protocol(
           v_new_source, v_before.protocol_version_id) THEN
    RAISE EXCEPTION 'Source extracted item does not belong to this protocol'
      USING ERRCODE = '23514';
  END IF;

  UPDATE protocol_risk_objects SET
    endpoint_tier            = COALESCE(p_endpoint_tier,           endpoint_tier),
    impact_surface           = COALESCE(p_impact_surface,          impact_surface),
    time_sensitivity         = COALESCE(p_time_sensitivity,        time_sensitivity),
    vendor_dependency_flags  = COALESCE(p_vendor_dependency_flags, vendor_dependency_flags),
    operational_domain_tag   = COALESCE(p_operational_domain_tag,  operational_domain_tag),
    version_change_type      = COALESCE(p_version_change_type,     version_change_type),
    source_extracted_item_id = v_new_source
  WHERE id = p_id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'endpoint_tier',            v_before.endpoint_tier,
      'impact_surface',           v_before.impact_surface,
      'time_sensitivity',         v_before.time_sensitivity,
      'vendor_dependency_flags',  v_before.vendor_dependency_flags,
      'operational_domain_tag',   v_before.operational_domain_tag,
      'version_change_type',      v_before.version_change_type,
      'source_extracted_item_id', v_before.source_extracted_item_id
    ),
    jsonb_build_object(
      'endpoint_tier',            v_after.endpoint_tier,
      'impact_surface',           v_after.impact_surface,
      'time_sensitivity',         v_after.time_sensitivity,
      'vendor_dependency_flags',  v_after.vendor_dependency_flags,
      'operational_domain_tag',   v_after.operational_domain_tag,
      'version_change_type',      v_after.version_change_type,
      'source_extracted_item_id', v_after.source_extracted_item_id
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
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_extracted_item_matches_protocol(uuid, uuid) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_create_protocol_risk(
  uuid, text, text, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text, uuid
) TO authenticated;

GRANT EXECUTE ON FUNCTION audit_mode_update_protocol_risk(
  uuid, endpoint_tier, impact_surface, boolean, text[], text, version_change_type, text, uuid, boolean
) TO authenticated;
