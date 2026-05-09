-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-5: review-action RPC + PR-2 updates.
--
-- Two changes:
--
-- 1. sotr_create_review_event — single RPC handling all five draft review
--    actions. Validates auth + study membership + source-evidence ownership;
--    locks the worksheet item row; updates status / version / current_text
--    per action; builds a frozen snapshot of the source evidence rows the
--    caller passed; appends one row to worksheet_review_events. Returns the
--    new event id and the updated item state.
--
-- 2. sotr_get_worksheet_item_evidence + ..._batch — additive update to
--    extend the response shape with version, review_status, current_text,
--    and worksheet_item_text. Existing PR-3 consumers ignore the new keys.
--    No breaking change.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- _sotr_build_review_snapshot
--
-- SECURITY DEFINER helper: builds a JSONB array of source evidence rows
-- to freeze into a review event. Called only from sotr_create_review_event
-- after that RPC has already validated each ID's study membership.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _sotr_build_review_snapshot(p_evidence_ids UUID[])
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',                   ev.id,
          'document_id',          ev.document_id,
          'protocol_version',     ev.protocol_version,
          'page_number',          ev.page_number,
          'section_number',       ev.section_number,
          'section_title',        ev.section_title,
          'support_type',         ev.support_type,
          'quoted_text',          ev.quoted_text,
          'confidence_score',     ev.confidence_score
        )
      )
        FROM protocol_source_evidence ev
       WHERE ev.id = ANY(p_evidence_ids)
    ),
    '[]'::jsonb
  );
$$;


-- ---------------------------------------------------------------------------
-- sotr_create_review_event
--
-- Single entry point for all five draft review actions.
--
-- Authorization:
--   - caller authenticated
--   - caller owns the document the item belongs to
--   - the item belongs to the requested study
--   - every source_evidence_record_id belongs to a document in the same study
--     and is owned by the caller (existence-of-id otherwise leaks)
--
-- Per-action behaviour:
--   accept_for_draft   → status = 'accepted_for_draft'
--   edit_draft_item    → current_text = p_new_item_text;
--                        version += 1; status = 'edited'
--   reject_from_draft  → status = 'rejected_from_draft'
--   flag_item          → status = 'flagged'
--   flag_source        → no item change (flagging the citation, not the item)
--
-- Locks the item row FOR UPDATE so concurrent edits can't race the version
-- bump.
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

  -- Lock the item row + verify ownership + study membership in one shot.
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

  -- Validate every passed source_evidence_record_id is in the same study and
  -- owned by the caller. Drop the entire request if any one is foreign.
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

  -- Validate edit_draft_item carries new text (other actions ignore it).
  IF p_action = 'edit_draft_item' THEN
    IF p_new_item_text IS NULL OR length(btrim(p_new_item_text)) = 0 THEN
      RAISE EXCEPTION 'edit_draft_item requires non-empty new_item_text'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- Capture the user-visible "previous text" before any update.
  -- current_text wins over extracted_value when set.
  v_prev_text := COALESCE(
    v_item.current_text,
    CASE
      WHEN jsonb_typeof(v_item.extracted_value) = 'string'
        THEN v_item.extracted_value #>> '{}'
      ELSE v_item.extracted_value::text
    END
  );

  -- Derive new version + status + current_text per action.
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
  -- flag_source: no item changes.

  -- Apply item updates if any field changed.
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

  -- Capture protocol context. protocol_version is best-effort: try the
  -- document's extracted_fields first, then NULL. We intentionally do NOT
  -- read protocol_versions here — that table tracks PIQC's own staged
  -- protocol versions, not the parsed PDF's claimed version string.
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

  -- Snapshot source evidence (empty array if none passed).
  v_snapshot := _sotr_build_review_snapshot(p_source_evidence_record_ids);

  -- Append the event.
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

  -- Compute the user-visible "current text" for the response.
  RETURN json_build_object(
    'review_event_id',         v_event_id,
    'worksheet_item_id',       v_item.id,
    'review_status',           v_new_status,
    'version',                 v_new_version,
    'current_text',            v_new_current,
    'worksheet_item_text',     COALESCE(
      v_new_current,
      CASE
        WHEN jsonb_typeof(v_item.extracted_value) = 'string'
          THEN v_item.extracted_value #>> '{}'
        ELSE v_item.extracted_value::text
      END
    )
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_item_evidence — additive update.
--
-- Adds review_status, version, current_text, worksheet_item_text to the
-- response. Existing keys unchanged.
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
    -- PR-5 additions:
    'review_status',         v_item.review_status,
    'version',               v_item.version,
    'current_text',          v_item.current_text,
    'worksheet_item_text',   COALESCE(
      v_item.current_text,
      CASE
        WHEN jsonb_typeof(v_item.extracted_value) = 'string'
          THEN v_item.extracted_value #>> '{}'
        ELSE v_item.extracted_value::text
      END
    ),
    'sources',               _sotr_build_sources_json(v_item.id)
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_items_evidence_batch — additive update (same fields).
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
            -- PR-5 additions:
            'review_status',         ei.review_status,
            'version',               ei.version,
            'current_text',          ei.current_text,
            'worksheet_item_text',   COALESCE(
              ei.current_text,
              CASE
                WHEN jsonb_typeof(ei.extracted_value) = 'string'
                  THEN ei.extracted_value #>> '{}'
                ELSE ei.extracted_value::text
              END
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
