-- =============================================================================
-- Visit Execution Workspace — order visits by PROTOCOL SEQUENCE (v6).
--
-- The deterministic SoA-grid parse now captures each visit's left-to-right
-- column position (protocol_visit_templates.column_order), so Visit Prep can
-- render visits "the way they are in the protocol". The prior RPC ordered ONLY
-- by study_day, which mis-places visits whose header day is relative (e.g. an
-- "EOT Visit, Day 14 after last cycle" sorted next to the Day-14 Treatment
-- Visit 2 instead of after Treatment Visit 12, with a UUID tiebreaker).
--
-- FIX: ORDER BY column_order first, then study_day, then visit_template_id.
-- column_order is NULL for the LLM-fallback path (and pre-existing rows), so
-- COALESCE(..., 2147483647) makes those rows fall back to the prior study_day
-- ordering — no regression for non-grid protocols.
--
-- CREATE OR REPLACE — body identical to v5 (20260628000000) EXCEPT the
-- column_order_sort select + the ORDER BY. SECURITY DEFINER + STABLE +
-- search_path restated (a bare replace would reset DEFINER → INVOKER). Append-only.
-- =============================================================================

ALTER TABLE protocol_visit_templates
  ADD COLUMN IF NOT EXISTS column_order INTEGER;

COMMENT ON COLUMN protocol_visit_templates.column_order IS
  'Left-to-right SoA column position (protocol visit sequence) from the '
  'deterministic grid parse. NULL on the LLM-fallback path → workspace RPC '
  'falls back to study_day ordering.';


CREATE OR REPLACE FUNCTION visit_execution_get_workspace(
  p_protocol_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Protocol-level ownership gate. Empty result rather than leaking existence.
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
        -- v6: protocol sequence first (column_order), then study_day, then a
        -- stable UUID tiebreak. column_order NULL (LLM path) → study_day order.
        SELECT json_agg(workspace_row ORDER BY column_order_sort, study_day_sort, (workspace_row->>'visit_template_id'))
          FROM (
            SELECT
              COALESCE(t.column_order, 2147483647) AS column_order_sort,
              t.study_day AS study_day_sort,
              json_build_object(
                'visit_template_id', t.id,
                'protocol_id',       t.protocol_id,
                'snapshot',          json_build_object(
                  'visit_name',              t.visit_name,
                  'study_day',               t.study_day,
                  'window_minus_days',       t.window_minus_days,
                  'window_plus_days',        t.window_plus_days,
                  'purpose',                 COALESCE(
                    t.purpose,
                    'Per-protocol visit. Detailed execution requirements pending structured ingest extraction.'
                  ),
                  'confidence_state',       t.confidence_state,
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
                  ),
                  'completeness_signal_count', (
                    SELECT COUNT(*) FROM visit_completeness_signals s
                     WHERE s.visit_template_id = t.id
                       AND s.resolution = 'pending'
                  ),
                  'completeness_signals',    COALESCE(
                    (
                      SELECT json_agg(json_build_object(
                        'id',                   s.id,
                        'gap_text',             s.gap_text,
                        'source_section',       s.source_section,
                        'source_page',          s.source_page,
                        'detection_confidence', s.detection_confidence,
                        'detection_reason',     s.detection_reason,
                        'detected_at',          s.detected_at
                      ) ORDER BY s.detected_at ASC)
                        FROM visit_completeness_signals s
                       WHERE s.visit_template_id = t.id
                         AND s.resolution = 'pending'
                    ),
                    '[]'::json
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
                            'derived_text',      r.derived_text,
                            'description',       r.description,
                            'phase',             r.phase,
                            'classification',    r.classification,
                            'role_hint',         r.role_hint,
                            'review_status',     r.review_status,
                            'review_note',       r.review_note,
                            'confidence_state',  (
                              SELECT ei.confidence_state
                                FROM protocol_extracted_items ei
                               WHERE ei.id = r.extracted_item_id
                            ),
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
                              'protocol_section',               COALESCE(r.protocol_section, ev.section_title),
                              'protocol_page',                  COALESCE(r.protocol_page, ev.page_number),
                              'amendment_version',              r.amendment_version,
                              'source_evidence_id',             ev.source_evidence_id,
                              'source_quote',                   ev.quoted_text,
                              'cross_reference_source_section', (t.cross_references->0->>'source_section'),
                              'cross_reference_page',           NULLIF(t.cross_references->0->>'page', '')::INTEGER,
                              'cross_reference_snippet',        (t.cross_references->0->>'snippet')
                            )
                          ) AS item_row
                        FROM visit_requirements r
                        LEFT JOIN LATERAL (
                          SELECT lnk.source_evidence_id,
                                 se.page_number,
                                 se.section_title,
                                 se.quoted_text
                            FROM protocol_item_evidence_links lnk
                            JOIN protocol_source_evidence se ON se.id = lnk.source_evidence_id
                           WHERE lnk.extracted_item_id = r.extracted_item_id
                           ORDER BY lnk.is_primary_source DESC NULLS LAST,
                                    lnk.relevance_score   DESC NULLS LAST
                           LIMIT 1
                        ) ev ON TRUE
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


COMMENT ON FUNCTION visit_execution_get_workspace IS
  'Read RPC (v6 — protocol-sequence ordering). Same as v5 (citations) but visits '
  'are ordered by protocol_visit_templates.column_order (SoA column sequence from '
  'the grid parse), then study_day, then visit_template_id. column_order NULL '
  '(LLM-fallback / pre-existing rows) falls back to study_day order via COALESCE. '
  'SECURITY DEFINER (perf) + citations behaviour unchanged.';
