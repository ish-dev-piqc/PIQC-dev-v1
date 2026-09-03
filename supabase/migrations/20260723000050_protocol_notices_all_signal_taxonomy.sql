-- ---------------------------------------------------------------------------
-- S1 — all-signal notice taxonomy swap (Living Protocol, awareness layer v2).
-- Founder decision recorded 2026-07-08 (spec §7.6), authored here 2026-07-09.
--
-- ONE taxonomy migration, additive to the notices surface only. It:
--   1. REMOVES endpoint_sdv — a standing SDV worklist that fired on every
--      parsed protocol (always-on wallpaper). Its home is the Deliverable
--      Engine's Monitoring Prep Checklist, not the notable-rail (spec §7.2 O2).
--      Removing a notice_type from v_specs does NOT reap already-persisted
--      rows (delete-on-zero only reaps types still in the spec list), so a
--      one-time orphan DELETE runs after the function (spec §5 mandatory gotcha).
--   2. GATES low_confidence_extraction to high-stakes field_types — a
--      low-confidence sponsor-name parse is noise; a low-confidence
--      endpoint/visit/criterion/dose is worth a reviewer's eye. Predicate
--      keys unchanged; one field_type allowlist added.
--   3. ADDS cross_document_divergence (N1) — the same field, extracted from
--      two or more of this protocol's documents, with values that disagree.
--      The first "protocol vs itself" reconciliation act, and the first
--      amendment-drift catch that ships without the amendment-diff engine.
--      v1 allowlist: protocol_number, protocol_title, dosing_regimen (clearly
--      scalar, clearly protocol facts; array/version fields deferred — spec §8).
--   4. ADDS unwindowed_visit (N2) — this protocol states scheduling windows
--      for some visits and none for others. Never fires when the protocol
--      uniformly omits windows (that is a choice, not an inconsistency). The
--      absence claim fires only from high-confidence rows (spec §7.3).
--
-- LITMUS: every predicate reads only in-document facts and every detail cites
-- what PIQC actually read. No external "a protocol should have…" norm anywhere.
-- N1 cites two passages of the uploaded documents that disagree. N2 cites the
-- uploaded schedule's own inconsistency. (spec §7.7.)
--
-- Supersedes the protocol_notices_sync body in
-- 20260722000100_protocol_notices_lowconf_wording.sql. CREATE OR REPLACE only —
-- the table, RPCs (get/set_status), RLS, and grants from 20260722000000 stand.
--
-- Rail after S1 (5 families, none always-on):
--   1 cross_document_divergence · 2 tight_visit_window · 3 amendment_in_force
--   · 4 unwindowed_visit · 5 low_confidence_extraction (gated)
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
  v_divergence_count    INTEGER := 0;
  v_divergence_evidence UUID[]  := ARRAY[]::UUID[];
  v_narrow_visit_count  INTEGER := 0;
  v_visit_evidence      UUID[]  := ARRAY[]::UUID[];
  v_amendment_count     INTEGER := 0;
  v_amend_evidence      UUID[]  := ARRAY[]::UUID[];
  v_unwindowed_count    INTEGER := 0;
  v_unwindowed_evidence UUID[]  := ARRAY[]::UUID[];
  v_any_window          BOOLEAN := FALSE;
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
  -- Predicate N1 — cross-document divergence. The same field_path, extracted
  -- from two or more of this protocol's documents, whose normalized values
  -- disagree. This is "the protocol vs itself": both sides already carry
  -- evidence rows, so the notice cites two real passages that conflict.
  --
  -- v1 allowlist (precision-first): protocol_number, protocol_title (must be
  -- identical across the documents of one protocol — a difference is a real
  -- reconciliation flag) and dosing_regimen (a dose that changed between
  -- versions — the marquee amendment-drift catch). All three are scalar text.
  -- protocol_version / is_amendment / amendment_summary are excluded by not
  -- being on the allowlist: they are EXPECTED to differ between a base and an
  -- amendment, so a difference there is not a divergence (spec BN1). Array and
  -- multi-value fields are deferred — index alignment across documents is a
  -- false-positive machine (spec §8 debt).
  --
  -- Evidence is order-meaningful: base-ish document first. documents carries
  -- no base/amendment flag, so first-ingested (created_at) is the stable,
  -- honest proxy — the detail never asserts WHICH document is authoritative,
  -- only that they disagree.
  -- -------------------------------------------------------------------------
  WITH item_norm AS (
    SELECT ei.id           AS item_id,
           ei.field_path    AS field_path,
           d.id             AS document_id,
           d.created_at     AS doc_created,
           lower(regexp_replace(
             COALESCE(NULLIF(btrim(ei.current_text), ''), _deliv_json_string(ei.extracted_value)),
             '\s+', ' ', 'g'
           ))               AS norm_value,
           ev.id            AS evidence_id
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
       AND ei.field_path IN ('protocol_number', 'protocol_title', 'dosing_regimen')
       AND COALESCE(NULLIF(btrim(ei.current_text), ''), _deliv_json_string(ei.extracted_value)) IS NOT NULL
  ),
  diverging AS (
    SELECT field_path
      FROM item_norm
     GROUP BY field_path
    HAVING COUNT(DISTINCT norm_value) > 1
       AND COUNT(DISTINCT document_id) > 1
  ),
  -- Verify-pass fix: one representative row per DISTINCT normalized value
  -- (earliest document first), not every row sharing the field_path. Without
  -- this, a field_path with values {A, A, B} across 3 documents would cite
  -- all three items, including the second A that agrees with the first --
  -- diluting the notice's "these disagree" claim with a non-conflicting
  -- citation once a protocol has 3+ documents carrying the same field_path.
  representative AS (
    SELECT DISTINCT ON (inr.field_path, inr.norm_value)
           inr.field_path, inr.doc_created, inr.item_id, inr.evidence_id
      FROM item_norm inr
      JOIN diverging dv ON dv.field_path = inr.field_path
     ORDER BY inr.field_path, inr.norm_value, inr.doc_created, inr.item_id
  )
  SELECT COUNT(DISTINCT field_path)::INTEGER,
         COALESCE(
           array_agg(evidence_id ORDER BY field_path, doc_created, item_id)
             FILTER (WHERE evidence_id IS NOT NULL),
           ARRAY[]::UUID[]
         )
    INTO v_divergence_count, v_divergence_evidence
    FROM representative;

  -- -------------------------------------------------------------------------
  -- Predicate — narrow-window visits: <= 2 days total scheduling tolerance.
  -- Same JSONB parse as action_cards_sync's visit block. (unchanged)
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
  -- Predicate — amendment in force. Same amendment_summary metadata scan as
  -- action_cards_sync; collect ALL such items' evidence. (unchanged)
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
  -- Predicate N2 — unwindowed visits, inconsistency-framed. Fires ONLY when
  -- this protocol states a window for at least one visit AND leaves at least
  -- one high-confidence visit windowless. The EXISTS guard is what keeps this
  -- litmus-clean: a protocol that uniformly omits windows never fires — that
  -- is the SoA's design, not a contradiction. The window parse is the SAME
  -- JSONB shape the narrow-window predicate uses (copied, not re-derived).
  -- Verify-pass fix: BOTH arms key on confidence_state = 'high', not just the
  -- fire arm — otherwise a single noisy low-confidence window misparse
  -- anywhere in the protocol could arm the whole notice even though every
  -- high-confidence-read visit uniformly omits windows, defeating the
  -- never-fires-on-uniform-omission guarantee via noise rather than signal.
  -- The absence claim ("no window here, windows there") fires only from
  -- confidence_state = 'high' rows — PIQC read it clearly and it genuinely
  -- isn't there, not an extraction miss wearing a notice costume (spec §7.3).
  -- -------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1
      FROM protocol_extracted_items ei
      JOIN documents d ON d.id = ei.document_id
     WHERE d.protocol_id = p_protocol_id
       AND ei.review_status IS DISTINCT FROM 'rejected_from_draft'
       AND ei.field_type = 'visit'
       AND ei.confidence_state = 'high'
       AND jsonb_typeof(ei.extracted_value) = 'object'
       AND _deliv_json_string(ei.extracted_value -> 'visit_name') IS NOT NULL
       AND ( _deliv_json_number_text(ei.extracted_value -> 'window_minus_days') IS NOT NULL
          OR _deliv_json_number_text(ei.extracted_value -> 'window_plus_days') IS NOT NULL )
  ) INTO v_any_window;

  IF v_any_window THEN
    SELECT COUNT(*)::INTEGER,
           COALESCE(
             array_agg(f.evidence_id ORDER BY f.path_prefix, f.path_index, f.item_id)
               FILTER (WHERE f.evidence_id IS NOT NULL),
             ARRAY[]::UUID[]
           )
      INTO v_unwindowed_count, v_unwindowed_evidence
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
           AND ei.confidence_state = 'high'
           AND jsonb_typeof(ei.extracted_value) = 'object'
           AND _deliv_json_string(ei.extracted_value -> 'visit_name') IS NOT NULL
           AND _deliv_json_number_text(ei.extracted_value -> 'window_minus_days') IS NULL
           AND _deliv_json_number_text(ei.extracted_value -> 'window_plus_days') IS NULL
      ) f;
  END IF;

  -- -------------------------------------------------------------------------
  -- Predicate — low-confidence extractions, GATED to high-stakes field_types.
  -- Items PIQC itself is unsure of (confidence_state low or needs_review) that
  -- also carry clinical/operational weight. A low-confidence sponsor name is
  -- noise; a low-confidence endpoint, visit, criterion, dose, or prohibited
  -- med is worth verifying against the source. Predicate keys are otherwise
  -- unchanged from 20260722000100 — only the field_type allowlist is added.
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
         AND ei.field_type IN (
               'endpoint', 'visit', 'inclusion_criterion',
               'exclusion_criterion', 'dosing', 'prohibited_med'
             )
    ) f;

  -- -------------------------------------------------------------------------
  -- Server-owned spec list. Severity fixes the feed order (contradictions
  -- outrank inconsistencies outrank standing facts; PIQC's own uncertainty is
  -- last). Headline/detail are deterministic prose from real counts only, and
  -- every detail names exactly what was read (spec §7.3 honesty rule).
  -- Plural-correct via CASE WHEN n = 1.
  -- -------------------------------------------------------------------------
  v_specs := jsonb_build_array(
    jsonb_build_object(
      'notice_type', 'cross_document_divergence',
      'severity',    1,
      'headline',    'Documents disagree',
      'detail',      v_divergence_count::TEXT || ' protocol fact'
                       || CASE WHEN v_divergence_count = 1 THEN ' reads' ELSE 's read' END
                       || ' differently across two or more of this protocol''s documents — reconcile the versions before relying on '
                       || CASE WHEN v_divergence_count = 1 THEN 'it' ELSE 'them' END || '.',
      'count',       v_divergence_count,
      'evidence',    to_jsonb(v_divergence_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'tight_visit_window',
      'severity',    2,
      'headline',    'Tight visit windows',
      'detail',      v_narrow_visit_count::TEXT || ' visit'
                       || CASE WHEN v_narrow_visit_count = 1 THEN ' allows' ELSE 's allow' END
                       || ' 2 days or less of scheduling tolerance — protocol deviations are easy to trigger here.',
      'count',       v_narrow_visit_count,
      'evidence',    to_jsonb(v_visit_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'amendment_in_force',
      'severity',    3,
      'headline',    'Amendment in force',
      'detail',      'This protocol carries an amendment in force — confirm you are working from the current version.',
      'count',       v_amendment_count,
      'evidence',    to_jsonb(v_amend_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'unwindowed_visit',
      'severity',    4,
      'headline',    'Visits without scheduling windows',
      'detail',      v_unwindowed_count::TEXT || ' visit'
                       || CASE WHEN v_unwindowed_count = 1 THEN ' has' ELSE 's have' END
                       || ' no scheduling window in the schedule rows PIQC read, while other visits in this protocol state one — confirm the open timing is intentional.',
      'count',       v_unwindowed_count,
      'evidence',    to_jsonb(v_unwindowed_evidence)
    ),
    jsonb_build_object(
      'notice_type', 'low_confidence_extraction',
      'severity',    5,
      'headline',    'Low-confidence extractions',
      'detail',      v_lowconf_count::TEXT || ' extracted fact'
                       || CASE WHEN v_lowconf_count = 1 THEN ' is' ELSE 's are' END
                       || ' flagged low-confidence — verify against the source before relying on them.',
      'count',       v_lowconf_count,
      'evidence',    to_jsonb(v_lowconf_evidence)
    )
  );

  -- -------------------------------------------------------------------------
  -- One pass: upsert the notices that hold (status-preserving), delete the
  -- ones that do not. status is never referenced in the UPDATE arm, so a
  -- dismissed notice stays dismissed while its predicate holds. delete-on-zero
  -- only reaps notice_types still in v_specs — endpoint_sdv leaving the list
  -- is handled by the one-time DELETE below the function.
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
  'Recomputes every protocol_notices predicate (cross-document divergence, '
  'tight visit windows, amendment in force, unwindowed visits, gated '
  'low-confidence extractions) from the same in-document fact pool as '
  'action_cards_sync. Upserts each notice that holds (preserving a dismissed '
  'status), deletes each whose count dropped to zero. Every predicate reads '
  'only facts of the uploaded protocol and every detail cites what PIQC read '
  '— no external standard is ever consulted. SECURITY DEFINER (reads '
  'owner-gated SOTR fact tables) gated by user_can_access_protocol as the '
  'first line of defense. S1 all-signal taxonomy (spec §7.6, 2026-07-09): '
  'endpoint_sdv removed (its home is the Monitoring Prep Checklist), '
  'low_confidence gated to high-stakes field_types, cross_document_divergence '
  '(N1) and unwindowed_visit (N2) added. Supersedes the sync body in '
  '20260722000100.';

-- ---------------------------------------------------------------------------
-- One-time orphan cleanup (spec §5 mandatory gotcha). endpoint_sdv is no
-- longer in v_specs, so the in-function delete-on-zero will never reap the
-- rows persisted under the old taxonomy. Reap them once, here. Idempotent:
-- re-running deletes nothing because no path re-creates endpoint_sdv.
-- ---------------------------------------------------------------------------
DELETE FROM protocol_notices WHERE notice_type = 'endpoint_sdv';
