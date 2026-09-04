-- 20260914000000_audit_mode_create_protocol_risk_from_candidate.sql
--
-- Audit Mode — Stage 1 (Intake): create a protocol risk from a PIQC-derived
-- candidate.
--
-- The vendor Intake stage now proposes risk candidates deterministically from
-- the parsed protocol's own structure (SOTR worksheet items: primary and
-- secondary endpoints by field_path, dosing, visits with procedures). The
-- auditor accepts a candidate by saving the existing tagging form. This RPC is
-- the write behind that accept: the same row as a manual tag, except
--
--   tagging_mode          = 'PIQC_ASSISTED'   (the deployed create hard-codes 'MANUAL')
--   suggestion_provenance = p_suggestion_provenance
--   source_extracted_item_id is REQUIRED       (a candidate always has a source)
--
-- Provenance is identifiers and the proposal only — the rule that fired, the
-- item's field_path / field_type / confidence_state / document_id, the five
-- attributes PIQC proposed, and when — never quoted protocol text. The History
-- drawer renders it through the generic delta viewer so an auditor can see
-- what PIQC proposed against what was saved.
--
-- A NEW function name rather than CREATE OR REPLACE of
-- audit_mode_create_protocol_risk (20260515010000): the deployed 11-argument
-- signature stays callable with no drift window while this migration waits
-- for `db push`, and PostgREST never has to disambiguate overloads. Until it
-- is applied the client receives PGRST202 and falls back to the manual create
-- with the source link (the row is then MANUAL; provenance is the only loss).
--
-- Body mirrors 20260515010000:86-175: same lead-auditor gate
-- (audit_mode_can_write_protocol_version), same cross-protocol check
-- (audit_mode_extracted_item_matches_protocol), same delta write with two
-- more fields. version_change_type is always 'ADDED' — amendments re-derive.
--
-- Additive: no table, column, policy or existing function changes.
-- Type mirror: src/types/audit/objects.ts (SuggestionProvenance).

CREATE OR REPLACE FUNCTION audit_mode_create_protocol_risk_from_candidate(
  p_protocol_version_id      uuid,
  p_section_identifier       text,
  p_section_title            text,
  p_endpoint_tier            endpoint_tier,
  p_impact_surface           impact_surface,
  p_time_sensitivity         boolean,
  p_vendor_dependency_flags  text[],
  p_operational_domain_tag   text,
  p_source_extracted_item_id uuid,
  p_suggestion_provenance    jsonb,
  p_reason                   text DEFAULT NULL
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

  -- A candidate is defined by its source. Without one this is a manual tag
  -- and belongs to audit_mode_create_protocol_risk.
  IF p_source_extracted_item_id IS NULL THEN
    RAISE EXCEPTION 'A candidate risk must name its source extracted item'
      USING ERRCODE = '23514';
  END IF;

  IF p_suggestion_provenance IS NULL
     OR jsonb_typeof(p_suggestion_provenance) <> 'object' THEN
    RAISE EXCEPTION 'suggestion_provenance must be a JSON object'
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
    suggestion_provenance,
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
    'PIQC_ASSISTED',
    p_suggestion_provenance,
    'ADDED',
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
      'suggestion_provenance',    jsonb_build_object('from', NULL, 'to', v_after.suggestion_provenance),
      'source_extracted_item_id', jsonb_build_object('from', NULL, 'to', v_after.source_extracted_item_id)
    ),
    v_user,
    COALESCE(p_reason, 'Accepted from PIQC candidate')
  );

  RETURN v_after;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC on creation; revoking from anon alone is a
-- no-op (20260721000000 / 20260911000000 precedent). The body gates on
-- auth.uid() and the lead-auditor check, so this is defense in depth.
REVOKE EXECUTE ON FUNCTION audit_mode_create_protocol_risk_from_candidate(
  uuid, text, text, endpoint_tier, impact_surface, boolean, text[], text, uuid, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION audit_mode_create_protocol_risk_from_candidate(
  uuid, text, text, endpoint_tier, impact_surface, boolean, text[], text, uuid, jsonb, text
) TO authenticated, service_role;
