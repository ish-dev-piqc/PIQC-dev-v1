-- ---------------------------------------------------------------------------
-- fable-audit FA-160a358-9c899fe-bf434f6051b5, finding M1 (confirmed, high):
-- the low_confidence_extraction notice's detail said items are "low-confidence
-- or awaiting review", but its predicate keys on confidence_state only
-- (low/needs_review) — a different column than the SOTR drawer's own
-- "N awaiting review" chip, which counts !review_status/'draft'. Same drawer,
-- same phrase, two different numbers. Reword to confidence vocabulary only;
-- no predicate/logic change.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protocol_notices_sync(
  p_protocol_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user                UUID := auth.uid();
  v_endpoint_count      INTEGER := 0;
  v_endpoint_evidence   UUID[]  := ARRAY[]::UUID[];
  v_narrow_visit_count  INTEGER := 0;
  v_visit_evidence      UUID[]  := ARRAY[]::UUID[];
  v_amendment_count     INTEGER := 0;
  v_amend_evidence      UUID[]  := ARRAY[]::UUID[];
  v_lowconf_count       INTEGER := 0;
  v_lowconf_evidence    UUID[]  := ARRAY[]::UUID[];
  v_specs               JSONB;
  v_spec                JSONB;
  v_count               INTEGER;
  v_evidence            UUID[];
  v_upserts             INTEGER := 0;
  v_deletes             INTEGER := 0;
  v_touched             INTEGER;
BEGIN
  -- First line of defense (this function bypasses RLS): the caller must be
  -- able to access the protocol via the single authorization primitive.
  IF v_user IS NULL OR NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RAISE EXCEPTION 'Protocol not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- -------------------------------------------------------------------------
  -- Predicate 1 — primary endpoints with usable text (current_text wins).
  -- Same fact pool as action_cards_sync's endpoint block.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*)::INTEGER,
         COALESCE(
           array_agg(f.evidence_id ORDER BY f.path_prefix, f.path_index, f.item_id)
             FILTER (WHERE f.evidence_id IS NOT NULL),
           ARRAY[]::UUID[]
         )
    INTO v_endpoint_count, v_endpoint_evidence
    FROM (
      SELECT ei.id AS item_id,
             split_part(ei.field_path, '[', 1) AS path_prefix,
             COALESCE(NULLIF(regexp_replace(ei.field_path, '[^0-9]', '', 'g'), '')::INT, 0) AS path_index,
             ev.id AS evidence_id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
        LEFT JOIN LATERAL (
          SELECT se.id
            FROM protocol_item_evidence_links l
            JOIN protocol_source_evidence se ON se.id = l.source_evidence_id
           WHERE l.extracted_item_id = ei.id
             AND l.is_primary_source
           ORDER BY l.created_at, l.id
           LIMIT 1
        ) ev ON TRUE
       WHERE d.protocol_id = p_protocol_id
         AND ei.review_status IS DISTINCT FROM 'rejected_from_draft'
         AND ei.field_type = 'endpoint'
         AND ei.field_path LIKE 'primary\_endpoints%'
         AND COALESCE(NULLIF(btrim(ei.current_text), ''), _deliv_json_string(ei.extracted_value)) IS NOT NULL
    ) f;

  -- -------------------------------------------------------------------------
  -- Predicate 2 — narrow-window visits: <= 2 days total scheduling tolerance.
  -- Same JSONB parse as action_cards_sync's visit block.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*)::INTEGER,
         COALESCE(
           array_agg(f.evidence_id ORDER BY f.path_prefix, f.path_index, f.item_id)
             FILTER (WHERE f.evidence_id IS NOT NULL),
           ARRAY[]::UUID[]
         )
    INTO v_narrow_visit_count, v_visit_evidence
    FROM (
      SELECT ei.id AS item_id,
             split_part(ei.field_path, '[', 1) AS path_prefix,
             COALESCE(NULLIF(regexp_replace(ei.field_path, '[^0-9]', '', 'g'), '')::INT, 0) AS path_index,
             ev.id AS evidence_id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
        LEFT JOIN LATERAL (
          SELECT se.id
            FROM protocol_item_evidence_links l
            JOIN protocol_source_evidence se ON se.id = l.source_evidence_id
           WHERE l.extracted_item_id = ei.id
             AND l.is_primary_source
           ORDER BY l.created_at, l.id
           LIMIT 1
        ) ev ON TRUE
       WHERE d.protocol_id = p_protocol_id
         AND ei.review_status IS DISTINCT FROM 'rejected_from_draft'
         AND ei.field_type = 'visit'
         AND jsonb_typeof(ei.extracted_value) = 'object'
         AND _deliv_json_string(ei.extracted_value -> 'visit_name') IS NOT NULL
         AND COALESCE(_deliv_json_number_text(ei.extracted_value -> 'window_minus_days'), '0')::NUMERIC
             + COALESCE(_deliv_json_number_text(ei.extracted_value -> 'window_plus_days'), '0')::NUMERIC <= 2
    ) f;

  -- -------------------------------------------------------------------------
  -- Predicate 3 — amendment in force. Same amendment_summary metadata scan as
  -- action_cards_sync; collect ALL such items' evidence (not just the first),
  -- since the notice reports presence and its count is 0 vs 1+.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*)::INTEGER,
         COALESCE(
           array_agg(f.evidence_id ORDER BY f.item_id)
             FILTER (WHERE f.evidence_id IS NOT NULL),
           ARRAY[]::UUID[]
         )
    INTO v_amendment_count, v_amend_evidence
    FROM (
      SELECT ei.id AS item_id,
             ev.id AS evidence_id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
        LEFT JOIN LATERAL (
          SELECT se.id
            FROM protocol_item_evidence_links l
            JOIN protocol_source_evidence se ON se.id = l.source_evidence_id
           WHERE l.extracted_item_id = ei.id
             AND l.is_primary_source
           ORDER BY l.created_at, l.id
           LIMIT 1
        ) ev ON TRUE
       WHERE d.protocol_id = p_protocol_id
         AND ei.review_status IS DISTINCT FROM 'rejected_from_draft'
         AND ei.field_type = 'metadata'
         AND ei.field_path = 'amendment_summary'
         AND COALESCE(NULLIF(btrim(ei.current_text), ''), _deliv_json_string(ei.extracted_value)) IS NOT NULL
    ) f;

  -- -------------------------------------------------------------------------
  -- Predicate 4 — low-confidence extractions. Items PIQC itself is unsure of
  -- (confidence_state low or needs_review). Surfacing our own uncertainty is
  -- the honest posture — the reviewer verifies these against the source.
  -- -------------------------------------------------------------------------
  SELECT COUNT(*)::INTEGER,
         COALESCE(
           array_agg(f.evidence_id ORDER BY f.path_prefix, f.path_index, f.item_id)
             FILTER (WHERE f.evidence_id IS NOT NULL),
           ARRAY[]::UUID[]
         )
    INTO v_lowconf_count, v_lowconf_evidence
    FROM (
      SELECT ei.id AS item_id,
             split_part(ei.field_path, '[', 1) AS path_prefix,
             COALESCE(NULLIF(regexp_replace(ei.field_path, '[^0-9]', '', 'g'), '')::INT, 0) AS path_index,
             ev.id AS evidence_id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
        LEFT JOIN LATERAL (
          SELECT se.id
            FROM protocol_item_evidence_links l
            JOIN protocol_source_evidence se ON se.id = l.source_evidence_id
           WHERE l.extracted_item_id = ei.id
             AND l.is_primary_source
           ORDER BY l.created_at, l.id
           LIMIT 1
        ) ev ON TRUE
       WHERE d.protocol_id = p_protocol_id
         AND ei.review_status IS DISTINCT FROM 'rejected_from_draft'
         AND ei.confidence_state IN ('low', 'needs_review')
    ) f;

  -- -------------------------------------------------------------------------
  -- Server-owned spec list. Severity fixes the feed order; headline/detail are
  -- deterministic prose from real counts only — no scores, no dates. Evidence
  -- is embedded as a JSONB string array and converted back to UUID[] per row.
  -- Plural-correct via CASE WHEN n = 1.
  -- -------------------------------------------------------------------------
  v_specs := jsonb_build_array(
    jsonb_build_object(
      'notice_type', 'tight_visit_window',
      'severity',    1,
      'headline',    'Tight visit windows',
      'detail',      v_narrow_visit_count::TEXT || ' visit'
                       || CASE WHEN v_narrow_visit_count = 1 THEN ' allows' ELSE 's allow' END
                       || ' 2 days or less of scheduling tolerance — protocol deviations are easy to trigger here.',
      'count',       v_narrow_visit_count,
      'evidence',    to_jsonb(v_visit_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'amendment_in_force',
      'severity',    2,
      'headline',    'Amendment in force',
      'detail',      'This protocol carries an amendment in force — confirm you are working from the current version.',
      'count',       v_amendment_count,
      'evidence',    to_jsonb(v_amend_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'endpoint_sdv',
      'severity',    3,
      'headline',    'Endpoints need source verification',
      'detail',      v_endpoint_count::TEXT || ' primary endpoint'
                       || CASE WHEN v_endpoint_count = 1 THEN ' requires' ELSE 's require' END
                       || ' source-data verification.',
      'count',       v_endpoint_count,
      'evidence',    to_jsonb(v_endpoint_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'low_confidence_extraction',
      'severity',    4,
      'headline',    'Low-confidence extractions',
      -- M1 fix: was "...low-confidence or awaiting review..." — collided
      -- with the drawer's differently-computed "awaiting review" chip
      -- (review_status-based, not confidence_state-based). Confidence
      -- vocabulary only now; predicate/count logic unchanged.
      'detail',      v_lowconf_count::TEXT || ' extracted fact'
                       || CASE WHEN v_lowconf_count = 1 THEN ' is' ELSE 's are' END
                       || ' flagged low-confidence — verify against the source before relying on them.',
      'count',       v_lowconf_count,
      'evidence',    to_jsonb(v_lowconf_evidence)
    )
  );

  -- -------------------------------------------------------------------------
  -- One pass: upsert the notices that hold (status-preserving), delete the
  -- ones that do not. The UNIQUE(protocol_id, notice_type) upsert + ON CONFLICT
  -- serializes concurrent syncs, and status is never referenced in the UPDATE
  -- arm so a dismissed notice stays dismissed while its predicate holds.
  -- -------------------------------------------------------------------------
  FOR v_spec IN SELECT * FROM jsonb_array_elements(v_specs)
  LOOP
    v_count := (v_spec ->> 'count')::INTEGER;

    IF v_count > 0 THEN
      SELECT COALESCE(array_agg(x::UUID), ARRAY[]::UUID[])
        INTO v_evidence
        FROM jsonb_array_elements_text(v_spec -> 'evidence') AS x;

      INSERT INTO protocol_notices (
        protocol_id, notice_type, severity, headline, detail,
        observed_count, protocol_evidence_ids
      )
      VALUES (
        p_protocol_id,
        v_spec ->> 'notice_type',
        (v_spec ->> 'severity')::INTEGER,
        v_spec ->> 'headline',
        v_spec ->> 'detail',
        v_count,
        v_evidence
      )
      ON CONFLICT (protocol_id, notice_type) DO UPDATE
        SET severity              = EXCLUDED.severity,
            headline              = EXCLUDED.headline,
            detail                = EXCLUDED.detail,
            observed_count        = EXCLUDED.observed_count,
            protocol_evidence_ids = EXCLUDED.protocol_evidence_ids;
      v_upserts := v_upserts + 1;
    ELSE
      DELETE FROM protocol_notices
       WHERE protocol_id = p_protocol_id
         AND notice_type = v_spec ->> 'notice_type';
      GET DIAGNOSTICS v_touched = ROW_COUNT;
      v_deletes := v_deletes + v_touched;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('notices_upserted', v_upserts, 'notices_deleted', v_deletes);
END;
$$;

COMMENT ON FUNCTION protocol_notices_sync IS
  'Recomputes every protocol_notices predicate (tight visit windows, amendment '
  'in force, endpoints needing SDV, low-confidence extractions) from the same '
  'fact pool as action_cards_sync. Upserts each notice that holds (preserving '
  'a dismissed status), deletes each whose count dropped to zero. SECURITY '
  'DEFINER (reads owner-gated SOTR fact tables) gated by '
  'user_can_access_protocol as the first line of defense. No deliverable '
  'dependency: notices describe protocol facts and surface as soon as a '
  'protocol is parsed. Deterministic prose from real counts only. '
  'low_confidence_extraction wording fixed in FA-160a358-9c899fe-bf434f6051b5 '
  '(M1) to avoid colliding with the SOTR drawer''s review_status-based '
  '"awaiting review" chip.';
