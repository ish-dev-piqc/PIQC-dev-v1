-- =============================================================================
-- Visit Prep: let coordinators ADD and DELETE requirements on a visit.
--
-- Until now the only way to create a requirement was promoting an AI
-- completeness signal; there was no way to add an arbitrary requirement or
-- remove a wrong one. These two RPCs fill that gap.
--
-- SECURITY INVOKER: both run under the caller's RLS. The existing
-- `visit_requirements_owner` policy (FOR ALL, owner/owner-org gated through
-- protocol_visit_templates -> protocols) already restricts insert/delete to
-- the caller's own protocols, so no extra access gate is needed here.
--
-- Added rows get origin='human_added' so the export worksheet (which already
-- branches on `origin`) marks coordinator-added items distinctly. Because the
-- export + get_workspace both read straight from visit_requirements, adds and
-- deletes flow into the workspace and the PDF automatically.
-- =============================================================================

CREATE OR REPLACE FUNCTION visit_execution_add_requirement(
  p_visit_template_id UUID,
  p_text TEXT,
  p_phase execution_phase DEFAULT 'assessment',
  p_role_hint TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_text TEXT := btrim(p_text);
  v_ordinal INTEGER;
  v_id UUID;
BEGIN
  IF v_text IS NULL OR v_text = '' THEN
    RAISE EXCEPTION 'requirement text is required' USING ERRCODE = '22023';
  END IF;

  -- Append after the visit's current items.
  SELECT COALESCE(MAX(ordinal), -1) + 1
    INTO v_ordinal
    FROM visit_requirements
   WHERE visit_template_id = p_visit_template_id;

  INSERT INTO visit_requirements (
    visit_template_id, ordinal, phase, classification, origin,
    derived_text, role_hint, review_status
  )
  VALUES (
    p_visit_template_id, v_ordinal, p_phase, 'required', 'human_added',
    v_text, NULLIF(btrim(coalesce(p_role_hint, '')), ''), 'not_reviewed'
  )
  RETURNING id INTO v_id;

  RETURN json_build_object(
    'id', v_id,
    'visit_template_id', p_visit_template_id,
    'ordinal', v_ordinal,
    'phase', p_phase,
    'origin', 'human_added'
  );
END;
$$;

CREATE OR REPLACE FUNCTION visit_execution_delete_requirement(
  p_requirement_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- Child rows (conditional/timing/source_fields) cascade on the FK.
  DELETE FROM visit_requirements WHERE id = p_requirement_id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN json_build_object('deleted', v_count, 'requirement_id', p_requirement_id);
END;
$$;

GRANT EXECUTE ON FUNCTION visit_execution_add_requirement(UUID, TEXT, execution_phase, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION visit_execution_delete_requirement(UUID) TO authenticated;
