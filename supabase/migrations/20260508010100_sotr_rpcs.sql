-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-1: RPCs.
--
-- Four functions covering the full lifecycle:
--
--   sotr_upsert_source_evidence  — create a citation/provenance record
--   sotr_upsert_extracted_item   — create or update a worksheet item
--   sotr_link_item_evidence      — link a worksheet item to an evidence record
--   sotr_get_item_evidence       — fetch a worksheet item + all its evidence
--
-- All functions are SECURITY INVOKER so the caller's RLS context applies.
-- Authorization is double-checked in-function via documents.user_id so the
-- behaviour is predictable even if RLS policies are adjusted later.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- sotr_upsert_source_evidence
--
-- Inserts one citation/provenance record for a protocol document. All
-- location fields are optional — the adapter calls this with whatever
-- Reducto returned, which may be partial.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_upsert_source_evidence(
  p_document_id         UUID,
  p_protocol_version    TEXT                  DEFAULT NULL,
  p_page_number         INTEGER               DEFAULT NULL,
  p_section_number      TEXT                  DEFAULT NULL,
  p_section_title       TEXT                  DEFAULT NULL,
  p_quoted_text         TEXT                  DEFAULT NULL,
  p_text_start_offset   INTEGER               DEFAULT NULL,
  p_text_end_offset     INTEGER               DEFAULT NULL,
  p_bounding_boxes      JSONB                 DEFAULT NULL,
  p_confidence_score    NUMERIC               DEFAULT NULL,
  p_support_type        evidence_support_type DEFAULT 'primary',
  p_extraction_run_id   TEXT                  DEFAULT NULL
)
RETURNS protocol_source_evidence
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  protocol_source_evidence;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM documents WHERE id = p_document_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Document not found or access denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO protocol_source_evidence (
    document_id, protocol_version, page_number, section_number,
    section_title, quoted_text, text_start_offset, text_end_offset,
    bounding_boxes, confidence_score, support_type, extraction_run_id
  ) VALUES (
    p_document_id, p_protocol_version, p_page_number, p_section_number,
    p_section_title, p_quoted_text, p_text_start_offset, p_text_end_offset,
    p_bounding_boxes, p_confidence_score, p_support_type, p_extraction_run_id
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_upsert_extracted_item
--
-- Creates or updates a worksheet item. The (document_id, field_path) pair
-- is unique — re-ingesting a document updates the existing item in place
-- rather than accumulating duplicates.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_upsert_extracted_item(
  p_document_id           UUID,
  p_field_path            TEXT,
  p_field_type            TEXT,
  p_extracted_value       JSONB,
  p_confidence_state      confidence_state      DEFAULT 'needs_review',
  p_confidence_score      NUMERIC               DEFAULT NULL,
  p_confidence_reason     TEXT                  DEFAULT NULL,
  p_ambiguity_reason      TEXT                  DEFAULT NULL,
  p_missing_source_reason missing_source_reason DEFAULT NULL
)
RETURNS protocol_extracted_items
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  protocol_extracted_items;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM documents WHERE id = p_document_id AND user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Document not found or access denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO protocol_extracted_items (
    document_id, field_path, field_type, extracted_value,
    confidence_state, confidence_score, confidence_reason,
    ambiguity_reason, missing_source_reason
  ) VALUES (
    p_document_id, p_field_path, p_field_type, p_extracted_value,
    p_confidence_state, p_confidence_score, p_confidence_reason,
    p_ambiguity_reason, p_missing_source_reason
  )
  ON CONFLICT (document_id, field_path) DO UPDATE SET
    extracted_value       = EXCLUDED.extracted_value,
    confidence_state      = EXCLUDED.confidence_state,
    confidence_score      = EXCLUDED.confidence_score,
    confidence_reason     = EXCLUDED.confidence_reason,
    ambiguity_reason      = EXCLUDED.ambiguity_reason,
    missing_source_reason = EXCLUDED.missing_source_reason,
    updated_at            = NOW()
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_link_item_evidence
--
-- Creates or updates the link between a worksheet item and an evidence
-- record. Idempotent on (extracted_item_id, source_evidence_id).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_link_item_evidence(
  p_extracted_item_id  UUID,
  p_source_evidence_id UUID,
  p_is_primary_source  BOOLEAN DEFAULT FALSE,
  p_relevance_score    NUMERIC DEFAULT NULL
)
RETURNS protocol_item_evidence_links
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  protocol_item_evidence_links;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM protocol_extracted_items ei
      JOIN documents d ON d.id = ei.document_id
     WHERE ei.id = p_extracted_item_id AND d.user_id = v_user
  ) THEN
    RAISE EXCEPTION 'Extracted item not found or access denied' USING ERRCODE = '42501';
  END IF;

  INSERT INTO protocol_item_evidence_links (
    extracted_item_id, source_evidence_id, is_primary_source, relevance_score
  ) VALUES (
    p_extracted_item_id, p_source_evidence_id, p_is_primary_source, p_relevance_score
  )
  ON CONFLICT (extracted_item_id, source_evidence_id) DO UPDATE SET
    is_primary_source = EXCLUDED.is_primary_source,
    relevance_score   = EXCLUDED.relevance_score
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;


-- ---------------------------------------------------------------------------
-- sotr_get_item_evidence
--
-- Returns the worksheet item + all linked evidence records as a single JSON
-- object. Designed for the source-review panel that opens when a user clicks
-- "Show source" on any extracted protocol field.
--
-- Evidence rows are ordered: primary source first, then by page number.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_get_item_evidence(p_extracted_item_id UUID)
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
   WHERE ei.id = p_extracted_item_id AND d.user_id = v_user;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Extracted item not found or access denied' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT json_build_object(
      'item', row_to_json(v_item),
      'evidence', COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'link',     row_to_json(lnk),
              'evidence', row_to_json(ev)
            )
            ORDER BY lnk.is_primary_source DESC, ev.page_number ASC NULLS LAST
          )
            FROM protocol_item_evidence_links lnk
            JOIN protocol_source_evidence ev ON ev.id = lnk.source_evidence_id
           WHERE lnk.extracted_item_id = v_item.id
        ),
        '[]'::json
      )
    )
  );
END;
$$;
