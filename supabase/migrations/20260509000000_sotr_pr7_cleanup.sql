-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-7: cleanup migration.
--
-- Pure DRY refactor — no behaviour changes, no schema changes, no new RPCs.
-- Extracts the duplicated "stringify protocol_extracted_items.extracted_value
-- (JSONB) to TEXT for display" expression into a single IMMUTABLE helper, then
-- CREATE OR REPLACE the four RPCs that previously inlined it:
--
--   _sotr_extracted_value_to_text(value jsonb)  -- new helper
--   sotr_get_worksheet_item_evidence            (PR-2 + PR-5 update)
--   sotr_get_worksheet_items_evidence_batch     (PR-2 + PR-5 update)
--   sotr_create_review_event                    (PR-5)
--   sotr_get_draft_confidence_packet            (PR-6)
--
-- Why: the same 5-line CASE was repeated 5+ times across the SOTR RPCs. A
-- single helper makes the intent obvious ("show parser output as text"),
-- removes the risk of one copy drifting from the others, and shrinks each
-- RPC body. Marked IMMUTABLE so the planner can fold it.
--
-- This migration only redefines functions — it cannot affect existing data
-- and is safe to roll forward / back via re-deploy.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- _sotr_extracted_value_to_text
--
-- JSONB → TEXT for display. String values are returned unwrapped (no quoting);
-- everything else (numbers, arrays, objects, booleans, null) is rendered as
-- compact JSON via ::text. NULL input → NULL output.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _sotr_extracted_value_to_text(value jsonb)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN value IS NULL                  THEN NULL
    WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}'
    ELSE                                     value::text
  END;
$$;

COMMENT ON FUNCTION _sotr_extracted_value_to_text(jsonb) IS
  'SOTR — render protocol_extracted_items.extracted_value JSONB as TEXT '
  'for display in RPC responses, review events, and exports.';


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_item_evidence — uses the helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_get_worksheet_item_evidence(
  p_study_id          UUID,
  p_worksheet_item_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_item protocol_extracted_items;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT ei.*
    INTO v_item
    FROM protocol_extracted_items ei
    JOIN documents d ON d.id = ei.document_id
   WHERE ei.id           = p_worksheet_item_id
     AND d.user_id       = v_user
     AND d.protocol_id   = p_study_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worksheet item not found in study or access denied'
      USING ERRCODE = '42501';
  END IF;

  RETURN json_build_object(
    'worksheet_item_id',     v_item.id,
    'confidence_state',      v_item.confidence_state,
    'confidence_score',      v_item.confidence_score,
    'confidence_reason',     v_item.confidence_reason,
    'ambiguity_reason',      v_item.ambiguity_reason,
    'missing_source_reason', v_item.missing_source_reason,
    'review_status',         v_item.review_status,
    'version',               v_item.version,
    'current_text',          v_item.current_text,
    'worksheet_item_text',   COALESCE(
      v_item.current_text,
      _sotr_extracted_value_to_text(v_item.extracted_value)
    ),
    'sources',               _sotr_build_sources_json(v_item.id)
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_items_evidence_batch — uses the helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_get_worksheet_items_evidence_batch(
  p_study_id           UUID,
  p_worksheet_item_ids UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user  UUID    := auth.uid();
  v_count INTEGER := COALESCE(array_length(p_worksheet_item_ids, 1), 0);
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_count > 100 THEN
    RAISE EXCEPTION 'Batch size exceeds maximum (100); requested %', v_count
      USING ERRCODE = '22023';
  END IF;

  IF v_count = 0 THEN
    RETURN json_build_object('items', '[]'::json);
  END IF;

  RETURN json_build_object(
    'items', COALESCE(
      (
        SELECT json_agg(
          json_build_object(
            'worksheet_item_id',     ei.id,
            'confidence_state',      ei.confidence_state,
            'confidence_score',      ei.confidence_score,
            'confidence_reason',     ei.confidence_reason,
            'ambiguity_reason',      ei.ambiguity_reason,
            'missing_source_reason', ei.missing_source_reason,
            'review_status',         ei.review_status,
            'version',               ei.version,
            'current_text',          ei.current_text,
            'worksheet_item_text',   COALESCE(
              ei.current_text,
              _sotr_extracted_value_to_text(ei.extracted_value)
            ),
            'sources',               _sotr_build_sources_json(ei.id)
          )
        )
          FROM protocol_extracted_items ei
          JOIN documents               d  ON d.id = ei.document_id
         WHERE ei.id         = ANY(p_worksheet_item_ids)
           AND d.user_id     = v_user
           AND d.protocol_id = p_study_id
      ),
      '[]'::json
    )
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_create_review_event — uses the helper (twice — previous text + result
-- text), keeps PR-5's locking + validation behaviour identical.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_create_review_event(
  p_study_id                  UUID,
  p_worksheet_item_id         UUID,
  p_action                    draft_review_action,
  p_new_item_text             TEXT  DEFAULT NULL,
  p_reviewer_note             TEXT  DEFAULT NULL,
  p_source_evidence_record_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user           UUID := auth.uid();
  v_item           protocol_extracted_items;
  v_doc_protocol   UUID;
  v_doc_extracted  JSONB;
  v_protocol_ver   TEXT;
  v_prev_text      TEXT;
  v_new_version    INTEGER;
  v_new_status     draft_review_status;
  v_new_current    TEXT;
  v_event_id       UUID;
  v_snapshot       JSONB;
  v_invalid_count  INTEGER;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT ei.*
    INTO v_item
    FROM protocol_extracted_items ei
    JOIN documents d ON d.id = ei.document_id
   WHERE ei.id           = p_worksheet_item_id
     AND d.user_id       = v_user
     AND d.protocol_id   = p_study_id
     FOR UPDATE OF ei;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Worksheet item not found in study or access denied'
      USING ERRCODE = '42501';
  END IF;

  IF array_length(p_source_evidence_record_ids, 1) IS NOT NULL THEN
    SELECT COUNT(*)
      INTO v_invalid_count
      FROM (
        SELECT unnest(p_source_evidence_record_ids) AS ev_id
      ) ids
      WHERE NOT EXISTS (
        SELECT 1
          FROM protocol_source_evidence ev
          JOIN documents d ON d.id = ev.document_id
         WHERE ev.id         = ids.ev_id
           AND d.user_id     = v_user
           AND d.protocol_id = p_study_id
      );
    IF v_invalid_count > 0 THEN
      RAISE EXCEPTION 'One or more source evidence records are not in this study or accessible'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_action = 'edit_draft_item' THEN
    IF p_new_item_text IS NULL OR length(btrim(p_new_item_text)) = 0 THEN
      RAISE EXCEPTION 'edit_draft_item requires non-empty new_item_text'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_prev_text := COALESCE(
    v_item.current_text,
    _sotr_extracted_value_to_text(v_item.extracted_value)
  );

  v_new_version := v_item.version;
  v_new_status  := v_item.review_status;
  v_new_current := v_item.current_text;

  IF p_action = 'accept_for_draft' THEN
    v_new_status := 'accepted_for_draft';
  ELSIF p_action = 'edit_draft_item' THEN
    v_new_current := p_new_item_text;
    v_new_version := v_item.version + 1;
    v_new_status  := 'edited';
  ELSIF p_action = 'reject_from_draft' THEN
    v_new_status := 'rejected_from_draft';
  ELSIF p_action = 'flag_item' THEN
    v_new_status := 'flagged';
  END IF;

  IF v_new_status     IS DISTINCT FROM v_item.review_status
     OR v_new_version IS DISTINCT FROM v_item.version
     OR v_new_current IS DISTINCT FROM v_item.current_text THEN
    UPDATE protocol_extracted_items
       SET review_status = v_new_status,
           version       = v_new_version,
           current_text  = v_new_current,
           updated_at    = NOW()
     WHERE id = v_item.id;
  END IF;

  SELECT protocol_id, extracted_fields
    INTO v_doc_protocol, v_doc_extracted
    FROM documents
   WHERE id = v_item.document_id;

  IF v_doc_extracted IS NOT NULL
     AND jsonb_typeof(v_doc_extracted -> 'protocol_version') = 'string' THEN
    v_protocol_ver := v_doc_extracted ->> 'protocol_version';
  ELSE
    v_protocol_ver := NULL;
  END IF;

  v_snapshot := _sotr_build_review_snapshot(p_source_evidence_record_ids);

  INSERT INTO worksheet_review_events (
    worksheet_item_id, reviewer_id, action,
    previous_item_text, new_item_text, reviewer_note,
    worksheet_item_version, protocol_document_id, protocol_version,
    source_evidence_snapshot
  )
  VALUES (
    v_item.id, v_user, p_action,
    CASE WHEN p_action = 'edit_draft_item' THEN v_prev_text     ELSE NULL END,
    CASE WHEN p_action = 'edit_draft_item' THEN p_new_item_text ELSE NULL END,
    NULLIF(btrim(COALESCE(p_reviewer_note, '')), ''),
    v_new_version,
    v_item.document_id,
    v_protocol_ver,
    v_snapshot
  )
  RETURNING id INTO v_event_id;

  RETURN json_build_object(
    'review_event_id',     v_event_id,
    'worksheet_item_id',   v_item.id,
    'review_status',       v_new_status,
    'version',             v_new_version,
    'current_text',        v_new_current,
    'worksheet_item_text', COALESCE(
      v_new_current,
      _sotr_extracted_value_to_text(v_item.extracted_value)
    )
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_draft_confidence_packet — uses the helper for worksheet_item_text
-- ---------------------------------------------------------------------------

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

  IF NOT EXISTS (
    SELECT 1
      FROM documents
     WHERE protocol_id = p_study_id
       AND user_id     = v_user
  ) THEN
    RAISE EXCEPTION 'Study not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  SELECT study_number INTO v_study_code
    FROM protocols
   WHERE id = p_study_id;

  SELECT json_agg(row_to_json(r)) INTO v_rows
    FROM (
      SELECT
        ei.id                       AS worksheet_item_id,
        ei.field_type               AS worksheet_item_type,
        COALESCE(
          ei.current_text,
          _sotr_extracted_value_to_text(ei.extracted_value)
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
