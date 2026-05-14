-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-6: draft confidence export RPC.
--
-- One read-only RPC that denormalizes everything the CSV needs into a flat
-- row array. No new schema. Auth: caller must own at least one document
-- belonging to the study. Each row is one (item × source) pair, with empty
-- source columns for items that have no linked evidence (LEFT JOIN).
--
-- This is a draft review aid only — NOT a final approved worksheet, NOT a
-- signed artifact, NOT a Part 11 / GxP export. The CSV builder also injects
-- a clear disclaimer at the top of the file.
-- =============================================================================

CREATE OR REPLACE FUNCTION sotr_get_draft_confidence_packet(
  p_study_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_study_code  TEXT;
  v_rows        JSON;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Caller must own at least one document in this study. This is the
  -- study-level access gate — individual items/sources are filtered below
  -- by the same predicate.
  IF NOT EXISTS (
    SELECT 1
      FROM documents
     WHERE protocol_id = p_study_id
       AND user_id     = v_user
  ) THEN
    RAISE EXCEPTION 'Study not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Friendly study label for the export header (NULL if study has none).
  SELECT study_number INTO v_study_code
    FROM protocols
   WHERE id = p_study_id;

  -- Build the row array. LEFT JOIN on links + sources so items with zero
  -- source evidence still appear (with empty source_* columns). LATERAL
  -- subqueries fold the latest review event + latest flag event onto
  -- each row without an extra round trip.
  SELECT json_agg(row_to_json(r)) INTO v_rows
    FROM (
      SELECT
        ei.id                       AS worksheet_item_id,
        ei.field_type               AS worksheet_item_type,
        -- worksheet_item_text: edited text wins; otherwise stringify
        -- the parser output (string passthrough or JSON-stringify).
        COALESCE(
          ei.current_text,
          CASE
            WHEN jsonb_typeof(ei.extracted_value) = 'string'
              THEN ei.extracted_value #>> '{}'
            ELSE ei.extracted_value::text
          END
        )                           AS worksheet_item_text,
        ei.confidence_state         AS confidence_state,
        ei.confidence_score         AS confidence_score,
        ei.confidence_reason        AS confidence_reason,
        ei.ambiguity_reason         AS ambiguity_reason,
        ei.review_status            AS review_status,
        ei.version                  AS worksheet_item_version,
        ei.missing_source_reason    AS missing_source_reason,

        d.id                        AS protocol_document_id,
        d.title                     AS protocol_document_name,
        (d.extracted_fields ->> 'protocol_version') AS document_protocol_version,

        ev.id                       AS source_id,
        ev.support_type             AS source_support_type,
        ev.protocol_version         AS source_protocol_version,
        ev.page_number              AS source_page_number,
        ev.section_number           AS source_section_number,
        ev.section_title            AS source_section_title,
        ev.quoted_text              AS quoted_source_text,
        (
          ev.id IS NOT NULL
          AND ev.bounding_boxes IS NOT NULL
          AND jsonb_typeof(ev.bounding_boxes) = 'array'
          AND jsonb_array_length(ev.bounding_boxes) > 0
        )                           AS has_highlight_coords,

        (ei.review_status = 'flagged') AS is_item_flagged,
        -- Source flag = there exists a flag_source event for this item
        -- whose snapshot contains this exact source id.
        (
          ev.id IS NOT NULL
          AND EXISTS (
            SELECT 1
              FROM worksheet_review_events e
             WHERE e.worksheet_item_id = ei.id
               AND e.action            = 'flag_source'
               AND e.source_evidence_snapshot @>
                   jsonb_build_array(jsonb_build_object('id', ev.id::text))
          )
        )                           AS is_source_flagged,

        latest_event.action         AS latest_review_action,
        latest_event.created_at     AS latest_review_at,
        latest_event.reviewer_note  AS latest_reviewer_note,
        latest_flag.reviewer_note   AS latest_flag_note

      FROM protocol_extracted_items ei
      JOIN documents d
        ON d.id = ei.document_id
      LEFT JOIN protocol_item_evidence_links lnk
        ON lnk.extracted_item_id = ei.id
      LEFT JOIN protocol_source_evidence ev
        ON ev.id = lnk.source_evidence_id

      LEFT JOIN LATERAL (
        SELECT action, created_at, reviewer_note
          FROM worksheet_review_events e
         WHERE e.worksheet_item_id = ei.id
         ORDER BY created_at DESC
         LIMIT 1
      ) latest_event ON TRUE

      LEFT JOIN LATERAL (
        SELECT reviewer_note
          FROM worksheet_review_events e
         WHERE e.worksheet_item_id = ei.id
           AND e.action IN ('flag_item', 'flag_source')
         ORDER BY created_at DESC
         LIMIT 1
      ) latest_flag ON TRUE

      WHERE d.protocol_id = p_study_id
        AND d.user_id     = v_user

      ORDER BY ei.field_type ASC,
               ei.field_path ASC,
               -- primary first when ordering sources within an item
               CASE ev.support_type
                 WHEN 'primary'   THEN 1
                 WHEN 'secondary' THEN 2
                 WHEN 'context'   THEN 3
                 WHEN 'conflict'  THEN 4
                 ELSE 5
               END ASC,
               ev.created_at ASC NULLS FIRST
    ) r;

  RETURN json_build_object(
    'study_id',     p_study_id,
    'study_code',   v_study_code,
    'generated_at', now(),
    'rows',         COALESCE(v_rows, '[]'::json)
  );
END;
$$;
