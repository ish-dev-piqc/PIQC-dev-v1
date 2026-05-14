-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-2: review-screen API.
--
-- Two RPCs that power the worksheet review UI. Both are study-scoped: the
-- worksheet item must belong to a document associated with the requested
-- protocol (study), AND the document must be owned by the caller. This is
-- the layer the worksheet review screen calls when a user clicks "Show
-- source" on an extracted protocol field, or when it pre-fetches evidence
-- for a visible page of items.
--
--   sotr_get_worksheet_item_evidence
--     → single worksheet item; flat response shape with embedded sources[]
--
--   sotr_get_worksheet_items_evidence_batch
--     → up to 100 worksheet items in one call; same per-item shape
--
-- Both functions:
--   - SECURITY INVOKER (caller's RLS context applies on top of in-function
--     ownership checks).
--   - Sort sources by support_type enum order, then relevance DESC, then
--     created_at ASC.
--   - Treat source_text as sensitive — returned to the authorized caller
--     but never logged in TS wrapper code.
--   - Return UUID protocol_document_id, never a raw storage URL.
--   - Silently drop unknown / inaccessible IDs from batch results so callers
--     can detect missing items by diffing requested vs returned IDs without
--     leaking existence-of-id signal.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- _sotr_build_sources_json
--
-- SECURITY DEFINER helper that builds the sources[] JSON array for a given
-- extracted item. Centralizes the shape + sort order so both RPCs stay in
-- sync. Called only from the two SECURITY INVOKER RPCs below, after they
-- have validated study membership and ownership.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION _sotr_build_sources_json(p_extracted_item_id UUID)
RETURNS JSON
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT json_agg(
        json_build_object(
          'id',                    ev.id,
          'support_type',          ev.support_type,
          'protocol_document_id',  ev.document_id,
          'protocol_version',      ev.protocol_version,
          'page_number',           ev.page_number,
          'section_number',        ev.section_number,
          'section_title',         ev.section_title,
          -- source_text is sensitive — returned to authorized callers,
          -- never logged in TS wrapper code.
          'source_text',           ev.quoted_text,
          'text_start_offset',     ev.text_start_offset,
          'text_end_offset',       ev.text_end_offset,
          'bounding_boxes',        COALESCE(ev.bounding_boxes, '[]'::jsonb),
          'extraction_confidence', ev.confidence_score,
          'relevance_score',       lnk.relevance_score,
          'is_primary',            lnk.is_primary_source
        )
        ORDER BY
          CASE ev.support_type
            WHEN 'primary'   THEN 1
            WHEN 'secondary' THEN 2
            WHEN 'context'   THEN 3
            WHEN 'conflict'  THEN 4
          END ASC,
          lnk.relevance_score DESC NULLS LAST,
          ev.created_at       ASC
      )
        FROM protocol_item_evidence_links lnk
        JOIN protocol_source_evidence    ev ON ev.id = lnk.source_evidence_id
       WHERE lnk.extracted_item_id = p_extracted_item_id
    ),
    '[]'::json
  );
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_item_evidence
--
-- Returns one worksheet item with its full source-evidence list. Errors
-- if the item does not exist, is not owned by the caller, or does not
-- belong to the requested study (protocol).
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

  -- Item must exist, be owned by caller, AND belong to the requested study.
  -- Combining all three into one SELECT means the same NOT FOUND error
  -- regardless of which check fails — no existence-of-id leak.
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
    'sources',               _sotr_build_sources_json(v_item.id)
  );
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_worksheet_items_evidence_batch
--
-- Returns up to 100 worksheet items in one call. Each item is filtered
-- through the same ownership + study-membership check as the single RPC.
-- Items that fail the check (don't exist, owned by another user, in a
-- different study) are silently omitted from the response — callers can
-- diff returned IDs against requested IDs to detect gaps. This avoids
-- leaking existence/visibility signal to a caller probing IDs.
--
-- Empty input array returns { items: [] } without error.
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
