-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (7 of 7): RPCs.
--
-- Four functions, all SECURITY INVOKER + SET search_path:
--
--   visit_execution_get_workspace(p_protocol_id)
--     Read path. Returns one row per visit template for the protocol with
--     snapshot + items + nested conditional_rules + timing + source_fields.
--     The result JSON keys mirror the TypeScript VisitExecutionWorkspace
--     type exactly so the Sprint 3 adapter can consume it without a mapper.
--
--   visit_execution_set_review_status(p_requirement_id, p_action, p_note?)
--     Write path for review-state actions: mark_reviewed, unmark_reviewed,
--     flag_for_review, add_site_note, mark_needs_clarification. Updates
--     visit_requirements.review_status and appends to
--     visit_requirement_human_edits.
--
--   visit_execution_edit_text(p_requirement_id, p_new_text, p_note?)
--     Write path for the edit_text action specifically. Bumps version,
--     sets current_text, status → 'edited'.
--
--   visit_execution_get_human_edit_log(p_requirement_id)
--     Read path for the audit timeline of one requirement.
--
-- All four follow the SOTR pattern from sotr_create_review_event:
-- auth check → row lock → action-specific update → event-log insert.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- visit_execution_get_workspace — read path.
--
-- Returns:
--   {
--     workspaces: [
--       {
--         visit_template_id, protocol_id,
--         snapshot: { visit_name, study_day, window_minus_days,
--                     window_plus_days, purpose, is_dosing_visit,
--                     has_primary_endpoint, has_safety_critical,
--                     item_count, conditional_item_count,
--                     endpoint_critical_count, needs_review_count,
--                     reviewed_count, flagged_count, amendment_version },
--         items: [
--           { id, extracted_item_id, label, description, phase,
--             classification, conditions: [...], timing: {...}|null,
--             source_fields: [...], role_hint,
--             traceability: { ... }, review_status, review_note }
--         ]
--       }
--     ]
--   }
--
-- Sorted by visit study_day ASC, then by item (phase, ordinal).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION visit_execution_get_workspace(
  p_protocol_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Protocol-level ownership gate. If the caller can't see the protocol,
  -- they get an empty result (no row-leak via existence-of-id).
  IF NOT EXISTS (
    SELECT 1
      FROM protocols p
     WHERE p.id = p_protocol_id
       AND (
         p.owner_id = v_user
         OR p.owner_org_id IN (
           SELECT org_id FROM public.org_members WHERE user_id = v_user
         )
       )
  ) THEN
    RETURN json_build_object('workspaces', '[]'::json);
  END IF;

  RETURN json_build_object(
    'workspaces',
    COALESCE(
      (
        SELECT json_agg(workspace_row ORDER BY (workspace_row->>'study_day_sort')::INTEGER)
          FROM (
            SELECT
              t.study_day AS study_day_sort,
              json_build_object(
                'visit_template_id', t.id,
                'protocol_id',       t.protocol_id,
                'snapshot',          json_build_object(
                  'visit_name',              t.visit_name,
                  'study_day',               t.study_day,
                  'window_minus_days',       t.window_minus_days,
                  'window_plus_days',        t.window_plus_days,
                  -- purpose isn't on protocol_visit_templates. Pulled from
                  -- the linked extracted item's confidence_reason when
                  -- present; otherwise honest placeholder. Sprint 3 may
                  -- promote this to its own column.
                  'purpose',                 COALESCE(
                    (SELECT ei.confidence_reason
                       FROM protocol_extracted_items ei
                      WHERE ei.id = t.extracted_item_id),
                    'Per-protocol visit. Detailed execution requirements pending structured ingest extraction.'
                  ),
                  'is_dosing_visit',         EXISTS (
                    SELECT 1 FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.phase = 'dosing'
                  ),
                  'has_primary_endpoint',    EXISTS (
                    SELECT 1 FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.classification = 'primary_endpoint'
                  ),
                  'has_safety_critical',     EXISTS (
                    SELECT 1 FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.classification = 'safety_critical'
                  ),
                  'item_count',              (SELECT COUNT(*) FROM visit_requirements r WHERE r.visit_template_id = t.id),
                  'conditional_item_count',  (
                    SELECT COUNT(DISTINCT r.id)
                      FROM visit_requirements r
                      JOIN visit_conditional_rules c ON c.requirement_id = r.id
                     WHERE r.visit_template_id = t.id
                  ),
                  'endpoint_critical_count', (
                    SELECT COUNT(*) FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.classification IN ('primary_endpoint', 'secondary_endpoint', 'safety_critical')
                  ),
                  'needs_review_count',      (
                    SELECT COUNT(*) FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.review_status IN ('not_reviewed', 'needs_review')
                  ),
                  'reviewed_count',          (
                    SELECT COUNT(*) FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.review_status = 'reviewed'
                  ),
                  'flagged_count',           (
                    SELECT COUNT(*) FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                       AND r.review_status = 'needs_review'
                  ),
                  'amendment_version',       (
                    SELECT MAX(r.amendment_version) FROM visit_requirements r
                     WHERE r.visit_template_id = t.id
                  )
                ),
                'items', COALESCE(
                  (
                    SELECT json_agg(item_row ORDER BY (item_row->>'phase_order')::INTEGER, (item_row->>'ordinal')::INTEGER)
                      FROM (
                        SELECT
                          CASE r.phase
                            WHEN 'pre_visit'         THEN 1
                            WHEN 'check_in'          THEN 2
                            WHEN 'assessment'        THEN 3
                            WHEN 'dosing'            THEN 4
                            WHEN 'post_dose'         THEN 5
                            WHEN 'safety_ae_conmed'  THEN 6
                            WHEN 'close_out'         THEN 7
                          END AS phase_order,
                          json_build_object(
                            'id',                r.id,
                            'phase_order',       CASE r.phase
                              WHEN 'pre_visit' THEN 1 WHEN 'check_in' THEN 2 WHEN 'assessment' THEN 3
                              WHEN 'dosing' THEN 4 WHEN 'post_dose' THEN 5 WHEN 'safety_ae_conmed' THEN 6
                              WHEN 'close_out' THEN 7 END,
                            'ordinal',           r.ordinal,
                            'extracted_item_id', r.extracted_item_id,
                            'label',             COALESCE(r.current_text, r.derived_text),
                            'description',       r.description,
                            'phase',             r.phase,
                            'classification',    r.classification,
                            'role_hint',         r.role_hint,
                            'review_status',     r.review_status,
                            'review_note',       r.review_note,
                            'conditions', COALESCE(
                              (SELECT json_agg(json_build_object(
                                'condition_text',   c.condition_text,
                                'consequence_text', c.consequence_text,
                                'source_section',   c.source_section,
                                'source_page',      c.source_page
                              ) ORDER BY c.ordinal)
                                FROM visit_conditional_rules c WHERE c.requirement_id = r.id),
                              '[]'::json),
                            'timing', (
                              SELECT json_build_object(
                                'label',                 ti.label,
                                'window_before_minutes', ti.window_before_minutes,
                                'window_after_minutes',  ti.window_after_minutes,
                                'is_hard_constraint',    ti.is_hard_constraint,
                                'source_section',        ti.source_section
                              ) FROM visit_timing_rules ti WHERE ti.requirement_id = r.id
                            ),
                            'source_fields', COALESCE(
                              (SELECT json_agg(json_build_object(
                                'field_label',  sf.field_label,
                                'field_type',   sf.field_type,
                                'units',        sf.units,
                                'normal_range', sf.normal_range,
                                'is_required',  sf.is_required
                              ) ORDER BY sf.ordinal)
                                FROM visit_source_fields sf WHERE sf.requirement_id = r.id),
                              '[]'::json),
                            'traceability', json_build_object(
                              'soa_column',                     r.soa_column,
                              'protocol_section',               r.protocol_section,
                              'protocol_page',                  r.protocol_page,
                              'amendment_version',              r.amendment_version,
                              'source_evidence_id',             (
                                SELECT lnk.source_evidence_id
                                  FROM protocol_item_evidence_links lnk
                                 WHERE lnk.extracted_item_id = r.extracted_item_id
                                   AND lnk.is_primary_source = TRUE
                                 LIMIT 1
                              ),
                              -- Visit-level cross-references live on protocol_visit_templates;
                              -- pass through the first one (Sprint 1 adapter convention).
                              'cross_reference_source_section', (t.cross_references->0->>'source_section'),
                              'cross_reference_page',           NULLIF(t.cross_references->0->>'page', '')::INTEGER,
                              'cross_reference_snippet',        (t.cross_references->0->>'snippet')
                            )
                          ) AS item_row
                        FROM visit_requirements r
                       WHERE r.visit_template_id = t.id
                      ) item_rows
                  ),
                  '[]'::json
                )
              ) AS workspace_row
            FROM protocol_visit_templates t
           WHERE t.protocol_id = p_protocol_id
          ) workspace_rows
      ),
      '[]'::json
    )
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- visit_execution_set_review_status — write path for review-state actions.
--
-- Per-action behaviour:
--   mark_reviewed           → review_status = 'reviewed'
--   unmark_reviewed         → review_status = 'not_reviewed'
--   flag_for_review         → review_status = 'needs_review'
--   add_site_note           → review_status = 'site_note_added', review_note set
--   mark_needs_clarification→ review_status = 'needs_review' (semantically
--                              identical to flag_for_review at DB layer; the
--                              audit log distinguishes them via action enum)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION visit_execution_set_review_status(
  p_requirement_id UUID,
  p_action         visit_requirement_edit_action,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user             UUID := auth.uid();
  v_req              visit_requirements;
  v_new_status       execution_review_status;
  v_protocol_id      UUID;
  v_amendment_ver    TEXT;
  v_event_id         UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_action = 'edit_text' THEN
    RAISE EXCEPTION 'Use visit_execution_edit_text for edit_text action'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the row + verify ownership in one shot.
  SELECT r.*
    INTO v_req
    FROM visit_requirements r
    JOIN protocol_visit_templates t ON t.id = r.visit_template_id
    JOIN protocols p ON p.id = t.protocol_id
   WHERE r.id = p_requirement_id
     AND (
       p.owner_id = v_user
       OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_user)
     )
   FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requirement not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Derive new review_status from action.
  v_new_status := CASE p_action
    WHEN 'mark_reviewed'            THEN 'reviewed'::execution_review_status
    WHEN 'unmark_reviewed'          THEN 'not_reviewed'::execution_review_status
    WHEN 'flag_for_review'          THEN 'needs_review'::execution_review_status
    WHEN 'mark_needs_clarification' THEN 'needs_review'::execution_review_status
    WHEN 'add_site_note'            THEN 'site_note_added'::execution_review_status
    ELSE v_req.review_status
  END;

  UPDATE visit_requirements
     SET review_status = v_new_status,
         review_note   = CASE WHEN p_action = 'add_site_note'
                              THEN NULLIF(btrim(COALESCE(p_note, '')), '')
                              ELSE review_note
                         END,
         updated_at    = NOW()
   WHERE id = v_req.id;

  -- Capture protocol context for the event-log snapshot.
  SELECT p.id, v_req.amendment_version
    INTO v_protocol_id, v_amendment_ver
    FROM protocol_visit_templates t
    JOIN protocols p ON p.id = t.protocol_id
   WHERE t.id = v_req.visit_template_id;

  INSERT INTO visit_requirement_human_edits (
    requirement_id, reviewer_id, action,
    reviewer_note,
    requirement_version, protocol_id, amendment_version
  )
  VALUES (
    v_req.id, v_user, p_action,
    NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_req.version, v_protocol_id, v_amendment_ver
  )
  RETURNING id INTO v_event_id;

  RETURN json_build_object(
    'requirement_id', v_req.id,
    'review_status',  v_new_status,
    'version',        v_req.version,
    'event_id',       v_event_id
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- visit_execution_edit_text — write path for the edit_text action.
--
-- Sets current_text, bumps version, sets status → 'edited'. Captures
-- previous_text into the event log so the audit timeline shows before/after.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION visit_execution_edit_text(
  p_requirement_id UUID,
  p_new_text       TEXT,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user          UUID := auth.uid();
  v_req           visit_requirements;
  v_prev_text     TEXT;
  v_new_version   INTEGER;
  v_protocol_id   UUID;
  v_amendment_ver TEXT;
  v_event_id      UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_new_text IS NULL OR length(btrim(p_new_text)) = 0 THEN
    RAISE EXCEPTION 'edit_text requires non-empty new_text' USING ERRCODE = '22023';
  END IF;

  SELECT r.*
    INTO v_req
    FROM visit_requirements r
    JOIN protocol_visit_templates t ON t.id = r.visit_template_id
    JOIN protocols p ON p.id = t.protocol_id
   WHERE r.id = p_requirement_id
     AND (
       p.owner_id = v_user
       OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_user)
     )
   FOR UPDATE OF r;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Requirement not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  v_prev_text   := COALESCE(v_req.current_text, v_req.derived_text);
  v_new_version := v_req.version + 1;

  UPDATE visit_requirements
     SET current_text  = p_new_text,
         review_status = 'edited',
         version       = v_new_version,
         updated_at    = NOW()
   WHERE id = v_req.id;

  SELECT p.id, v_req.amendment_version
    INTO v_protocol_id, v_amendment_ver
    FROM protocol_visit_templates t
    JOIN protocols p ON p.id = t.protocol_id
   WHERE t.id = v_req.visit_template_id;

  INSERT INTO visit_requirement_human_edits (
    requirement_id, reviewer_id, action,
    previous_text, new_text, reviewer_note,
    requirement_version, protocol_id, amendment_version
  )
  VALUES (
    v_req.id, v_user, 'edit_text',
    v_prev_text, p_new_text, NULLIF(btrim(COALESCE(p_note, '')), ''),
    v_new_version, v_protocol_id, v_amendment_ver
  )
  RETURNING id INTO v_event_id;

  RETURN json_build_object(
    'requirement_id', v_req.id,
    'review_status',  'edited',
    'version',        v_new_version,
    'current_text',   p_new_text,
    'event_id',       v_event_id
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- visit_execution_get_human_edit_log — read path for one requirement's audit
-- timeline. Newest first.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION visit_execution_get_human_edit_log(
  p_requirement_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Ownership gate. Empty result rather than leaky existence error.
  IF NOT EXISTS (
    SELECT 1
      FROM visit_requirements r
      JOIN protocol_visit_templates t ON t.id = r.visit_template_id
      JOIN protocols p ON p.id = t.protocol_id
     WHERE r.id = p_requirement_id
       AND (
         p.owner_id = v_user
         OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_user)
       )
  ) THEN
    RETURN json_build_object('events', '[]'::json);
  END IF;

  RETURN json_build_object(
    'events',
    COALESCE(
      (
        SELECT json_agg(json_build_object(
          'id',                  e.id,
          'action',              e.action,
          'reviewer_id',         e.reviewer_id,
          'previous_text',       e.previous_text,
          'new_text',            e.new_text,
          'reviewer_note',       e.reviewer_note,
          'requirement_version', e.requirement_version,
          'amendment_version',   e.amendment_version,
          'created_at',          e.created_at
        ) ORDER BY e.created_at DESC)
          FROM visit_requirement_human_edits e
         WHERE e.requirement_id = p_requirement_id
      ),
      '[]'::json
    )
  );
END;
$$;


COMMENT ON FUNCTION visit_execution_get_workspace IS
  'Read RPC. Returns the full VisitExecutionWorkspace shape (matches the '
  'TypeScript type in src/types/visit-execution/index.ts) for all visit '
  'templates in a protocol. Called by visitExecutionApi when the mock '
  'toggle is off (post-Sprint-3 adapter wiring).';

COMMENT ON FUNCTION visit_execution_set_review_status IS
  'Write RPC for review-state actions other than edit_text. Updates the '
  'requirement row + appends a row to visit_requirement_human_edits.';

COMMENT ON FUNCTION visit_execution_edit_text IS
  'Write RPC for the edit_text action. Sets current_text, bumps version, '
  'flips review_status to edited, captures previous_text in the audit log.';

COMMENT ON FUNCTION visit_execution_get_human_edit_log IS
  'Read RPC. Returns the audit timeline of one requirement, newest first.';
