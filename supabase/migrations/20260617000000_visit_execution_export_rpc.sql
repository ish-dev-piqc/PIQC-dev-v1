-- =============================================================================
-- Visit Execution Workspace — Sprint 5:
-- visit_execution_export_worksheet RPC.
--
-- Returns a denormalized JSON packet for ONE visit, shaped for the export
-- builder (PDF v1; DOCX/CSV builders will consume the same packet later).
--
-- Why a dedicated RPC instead of reusing visit_execution_get_workspace:
--   1. Server-stamped `generated_at` — the export is a moment-of-lock-in; the
--      timestamp must come from the DB clock, not the browser.
--   2. Single-visit scope avoids over-fetching when exporting one visit out
--      of a multi-visit protocol.
--   3. Includes `protocol_code` (study_number) which the worksheet read RPC
--      doesn't expose. Filename + header attribution need it.
--   4. Future DOCX/CSV builders share the same RPC contract.
--
-- IMPORTANT: per feedback_no_sponsor_branding.md, the packet MUST NOT
-- include `protocols.sponsor`. Sponsor name is a PIQC artifact restriction —
-- the exported worksheet stays sponsor-name-free. Sites add their own
-- letterhead externally on print/share.
--
-- Mirrors sotr_get_draft_confidence_packet's pattern:
-- auth check → ownership gate → denormalized flat shape → DRAFT semantics.
-- =============================================================================

CREATE OR REPLACE FUNCTION visit_execution_export_worksheet(
  p_visit_template_id UUID
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
      FROM protocol_visit_templates t
      JOIN protocols p ON p.id = t.protocol_id
     WHERE t.id = p_visit_template_id
       AND (
         p.owner_id = v_user
         OR p.owner_org_id IN (
           SELECT org_id FROM public.org_members WHERE user_id = v_user
         )
       )
  ) THEN
    RAISE EXCEPTION 'Worksheet not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT json_build_object(
      'protocol_id',       t.protocol_id,
      -- protocol_code = study_number (stable across amendments). Falls back
      -- to a short id prefix on the client when null. Sponsor field is
      -- DELIBERATELY excluded per feedback_no_sponsor_branding.md.
      'protocol_code',     p.study_number,
      'protocol_title',    p.title,
      'visit_template_id', t.id,
      -- Server-stamped lock-in timestamp. The whole point of "moment of
      -- lock-in" semantic is that the clock is authoritative.
      'generated_at',      NOW(),
      'snapshot',          json_build_object(
        'visit_name',              t.visit_name,
        'study_day',               t.study_day,
        'window_minus_days',       t.window_minus_days,
        'window_plus_days',        t.window_plus_days,
        'purpose',                 COALESCE(
          t.purpose,
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
        'reviewed_count',          (
          SELECT COUNT(*) FROM visit_requirements r
           WHERE r.visit_template_id = t.id
             AND r.review_status = 'reviewed'
        ),
        'needs_review_count',      (
          SELECT COUNT(*) FROM visit_requirements r
           WHERE r.visit_template_id = t.id
             AND r.review_status IN ('not_reviewed', 'needs_review')
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
                END AS phase_order_sort,
                json_build_object(
                  'id',                r.id,
                  'phase',             r.phase,
                  'phase_order',       CASE r.phase
                    WHEN 'pre_visit' THEN 1 WHEN 'check_in' THEN 2 WHEN 'assessment' THEN 3
                    WHEN 'dosing' THEN 4 WHEN 'post_dose' THEN 5 WHEN 'safety_ae_conmed' THEN 6
                    WHEN 'close_out' THEN 7 END,
                  'ordinal',           r.ordinal,
                  -- Always export the human-effective label (COALESCE of
                  -- current_text + derived_text). Drift is captured in
                  -- review_status='edited' + the audit log; the worksheet
                  -- shows what the coordinator decided to execute.
                  'label',             COALESCE(r.current_text, r.derived_text),
                  'description',       r.description,
                  'classification',    r.classification,
                  'role_hint',         r.role_hint,
                  'review_status',     r.review_status,
                  'review_note',       r.review_note,
                  'origin',            r.origin,
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
                    'soa_column',         r.soa_column,
                    'protocol_section',   r.protocol_section,
                    'protocol_page',      r.protocol_page,
                    'amendment_version',  r.amendment_version
                  )
                ) AS item_row
              FROM visit_requirements r
             WHERE r.visit_template_id = t.id
            ) item_rows
        ),
        '[]'::json
      )
    )
    FROM protocol_visit_templates t
    JOIN protocols p ON p.id = t.protocol_id
   WHERE t.id = p_visit_template_id
  );
END;
$$;


COMMENT ON FUNCTION visit_execution_export_worksheet IS
  'Sprint 5. Returns the denormalized worksheet packet for a single visit, '
  'shaped for the export builder (PDF v1; future DOCX/CSV share the same '
  'shape). Server-stamped generated_at is the moment-of-lock-in timestamp. '
  'Excludes protocols.sponsor per feedback_no_sponsor_branding.md.';
