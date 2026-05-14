-- =============================================================================
-- SOTR — server-side ingest persistence RPC.
--
-- Called by the ingest edge function after Reducto Extract returns.
-- Wraps three writes in a single transaction so a document either lands
-- with a complete SOTR row set (items + evidence + links) or rolls back
-- entirely — no half-loaded documents.
--
-- Re-ingest semantics (idempotent):
--   - Evidence rows for the document are DELETED first; ON DELETE CASCADE
--     on protocol_item_evidence_links wipes the associated links.
--   - Items are upserted by (document_id, field_path) — IDs preserve across
--     re-ingest so foreign keys from other systems (e.g. visit templates'
--     extracted_item_id) survive.
--   - Fresh evidence + fresh links are inserted in dependency order.
--
-- Why SECURITY INVOKER without auth.uid() check:
--   - This RPC is intended to be called only by the ingest edge function,
--     which has already validated the user JWT and document ownership at
--     the request boundary. Matching the existing pattern of
--     materialize_protocol_visits() which is also called from privileged
--     backend context with service-role credentials (auth.uid() = NULL).
--   - Frontend code uses sotr_upsert_source_evidence / sotr_upsert_extracted_item /
--     sotr_link_item_evidence for per-row writes with their own auth checks.
--     This batch RPC is not exposed to direct frontend use.
-- =============================================================================

CREATE OR REPLACE FUNCTION sotr_ingest_adapter_output(
  p_document_id       UUID,
  p_items             JSONB,
  p_evidence          JSONB,
  p_links             JSONB,
  p_extraction_run_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_item          JSONB;
  v_evidence      JSONB;
  v_link          JSONB;
  v_item_id       UUID;
  v_evidence_id   UUID;
  v_item_ids      UUID[] := ARRAY[]::UUID[];
  v_evidence_ids  UUID[] := ARRAY[]::UUID[];
  v_evidence_del  INTEGER;
BEGIN
  -- Existence check. We don't enforce user_id because the caller (ingest
  -- edge function) has already validated the JWT and the document was
  -- created inside the same request. Defence in depth: a malformed
  -- document_id still fails fast here rather than corrupting another doc.
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'sotr_ingest: document not found: %', p_document_id
      USING ERRCODE = '23503';  -- foreign_key_violation
  END IF;

  -- Clear any prior SOTR state for this document. Links cascade via the
  -- ON DELETE CASCADE on protocol_item_evidence_links.source_evidence_id.
  -- Items survive (upsert by field_path) so external FKs that reference
  -- protocol_extracted_items.id continue to resolve.
  DELETE FROM protocol_source_evidence
    WHERE document_id = p_document_id;
  GET DIAGNOSTICS v_evidence_del = ROW_COUNT;

  -- ---------------------------------------------------------------------
  -- Insert evidence rows. Position in v_evidence_ids matches position in
  -- the input p_evidence array so links can resolve via integer indices.
  -- ---------------------------------------------------------------------
  FOR v_evidence IN SELECT * FROM jsonb_array_elements(p_evidence)
  LOOP
    INSERT INTO protocol_source_evidence (
      document_id, protocol_version, page_number, section_number,
      section_title, quoted_text, text_start_offset, text_end_offset,
      bounding_boxes, confidence_score, support_type, extraction_run_id
    ) VALUES (
      p_document_id,
      (v_evidence->>'protocol_version'),
      NULLIF(v_evidence->>'page_number', '')::INTEGER,
      (v_evidence->>'section_number'),
      (v_evidence->>'section_title'),
      (v_evidence->>'quoted_text'),
      NULLIF(v_evidence->>'text_start_offset', '')::INTEGER,
      NULLIF(v_evidence->>'text_end_offset', '')::INTEGER,
      (v_evidence->'bounding_boxes'),
      NULLIF(v_evidence->>'confidence_score', '')::NUMERIC,
      COALESCE((v_evidence->>'support_type')::evidence_support_type, 'primary'),
      COALESCE(v_evidence->>'extraction_run_id', p_extraction_run_id)
    )
    RETURNING id INTO v_evidence_id;

    v_evidence_ids := v_evidence_ids || v_evidence_id;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Upsert items. Idempotent on (document_id, field_path) so re-ingest
  -- updates in place rather than accumulating duplicates. Same ON CONFLICT
  -- behavior as sotr_upsert_extracted_item.
  -- ---------------------------------------------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO protocol_extracted_items (
      document_id, field_path, field_type, extracted_value,
      confidence_state, confidence_score, confidence_reason,
      ambiguity_reason, missing_source_reason
    ) VALUES (
      p_document_id,
      (v_item->>'field_path'),
      (v_item->>'field_type'),
      (v_item->'extracted_value'),
      COALESCE((v_item->>'confidence_state')::confidence_state, 'needs_review'),
      NULLIF(v_item->>'confidence_score', '')::NUMERIC,
      (v_item->>'confidence_reason'),
      (v_item->>'ambiguity_reason'),
      NULLIF(v_item->>'missing_source_reason', '')::missing_source_reason
    )
    ON CONFLICT (document_id, field_path) DO UPDATE SET
      field_type            = EXCLUDED.field_type,
      extracted_value       = EXCLUDED.extracted_value,
      confidence_state      = EXCLUDED.confidence_state,
      confidence_score      = EXCLUDED.confidence_score,
      confidence_reason     = EXCLUDED.confidence_reason,
      ambiguity_reason      = EXCLUDED.ambiguity_reason,
      missing_source_reason = EXCLUDED.missing_source_reason,
      updated_at            = NOW()
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || v_item_id;
  END LOOP;

  -- ---------------------------------------------------------------------
  -- Insert links. Indices are 0-based in the adapter output (JS) and
  -- 1-based in Postgres arrays — hence the +1.
  -- ---------------------------------------------------------------------
  FOR v_link IN SELECT * FROM jsonb_array_elements(p_links)
  LOOP
    INSERT INTO protocol_item_evidence_links (
      extracted_item_id, source_evidence_id, is_primary_source, relevance_score
    ) VALUES (
      v_item_ids[(v_link->>'item_index')::INTEGER + 1],
      v_evidence_ids[(v_link->>'evidence_index')::INTEGER + 1],
      COALESCE((v_link->>'is_primary_source')::BOOLEAN, FALSE),
      NULLIF(v_link->>'relevance_score', '')::NUMERIC
    )
    ON CONFLICT (extracted_item_id, source_evidence_id) DO UPDATE SET
      is_primary_source = EXCLUDED.is_primary_source,
      relevance_score   = EXCLUDED.relevance_score;
  END LOOP;

  RETURN jsonb_build_object(
    'items_upserted',    COALESCE(array_length(v_item_ids, 1), 0),
    'evidence_inserted', COALESCE(array_length(v_evidence_ids, 1), 0),
    'links_inserted',    jsonb_array_length(p_links),
    'evidence_deleted',  v_evidence_del,
    'item_ids',          to_jsonb(v_item_ids),
    'evidence_ids',      to_jsonb(v_evidence_ids)
  );
END;
$$;

COMMENT ON FUNCTION sotr_ingest_adapter_output IS
  'Batch-persists the output of mapReductoExtractToSotr in a single transaction. '
  'Called from the ingest edge function only — frontend uses the per-row '
  'sotr_upsert_* functions which carry their own auth.uid() checks.';
