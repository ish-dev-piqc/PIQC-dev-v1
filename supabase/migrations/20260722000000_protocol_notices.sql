-- =============================================================================
-- Protocol Awareness Layer — "What PIQC noticed" data spine.
--
-- protocol_notices: individual, ranked, evidence-linked OBSERVATIONS about a
-- parsed protocol. Where an ActionCard is a warm handoff ("go do this there"),
-- a Notice is an observation ("here is what I saw, with its evidence"). The
-- predicates are the SAME ones action_cards_sync already computes and buries
-- inside one travel card's rationale string — this layer splits them back into
-- individual, ranked notices so a reviewer sees each observation next to the
-- protocol facts that produced it.
--
-- Sibling of the Action Layer, NOT an extension of it. Notices carry no
-- external destination, no link-out, no 'acted' state — nothing here books,
-- directs, or signs anything off. Observation only.
--
-- Two deliberate departures from action_cards_sync:
--   1. NO deliverable dependency. Notices describe the protocol's own facts,
--      so they surface the moment a protocol is parsed — before (and
--      independent of) the gated deliverable engine. This is what makes the
--      awareness feed visible now to any protocol member.
--   2. DELETE-on-zero. A notice asserts a currently-true observation. When a
--      predicate stops holding (an amendment is superseded, every
--      low-confidence item gets reviewed), the notice is DELETED, not left
--      stale. Re-sync therefore reflects present truth, not history. (A
--      dismissed notice is still preserved-in-place while its predicate holds;
--      only a predicate that drops to zero removes the row.)
--
-- Three RPCs:
--   protocol_notices_sync       — DEFINER (reads owner-gated SOTR fact tables),
--                                 access-gated on the first line. Recomputes
--                                 every notice type; upserts the ones that hold
--                                 (preserving 'dismissed'), deletes the ones
--                                 that no longer do.
--   protocol_notices_get        — INVOKER. JSON array of NoticeRecord, ordered
--                                 by (severity, created_at). Possibly empty,
--                                 never NULL.
--   protocol_notice_set_status  — INVOKER. active / dismissed.
--
-- Fact parsing reuses _deliv_json_string / _deliv_json_number_text
-- (20260708000100_deliverable_rpcs.sql) so the notice counts can never drift
-- from how deliverable_generate / action_cards_sync read the same JSONB.
--
-- TS mirror: src/types/actions/index.ts (NoticeRecord).
-- Design + decisions: plans/fable/protocol-awareness-layer.md.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- protocol_notices
-- ---------------------------------------------------------------------------

CREATE TABLE public.protocol_notices (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id           UUID        NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  -- Stable observation kind. One notice per (protocol, notice_type); sync
  -- refreshes it in place. Not an enum: new observation kinds ship as new
  -- notice_type strings without a type migration, exactly like
  -- protocol_action_cards.trigger_context.
  notice_type           TEXT        NOT NULL,
  -- Attention rank, lower = surfaced first. Assigned by sync, not the client,
  -- so ordering is deterministic and server-owned.
  severity              INTEGER     NOT NULL,
  headline              TEXT        NOT NULL,
  detail                TEXT        NOT NULL,
  -- How many facts this notice summarizes (e.g. 3 tight-window visits). 0 is
  -- never persisted — a zero-count notice is deleted, not stored.
  observed_count        INTEGER     NOT NULL DEFAULT 0,
  protocol_evidence_ids UUID[]      NOT NULL DEFAULT '{}',
  status                TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One notice per kind per protocol; sync updates in place. The unique index
  -- this creates also serves the (protocol_id) read path — no separate index
  -- needed.
  UNIQUE (protocol_id, notice_type)
);

CREATE TRIGGER touch_protocol_notices_updated_at
  BEFORE UPDATE ON public.protocol_notices
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — all four commands route through user_can_access_protocol, the single
-- authorisation primitive. Status writes go through protocol_notice_set_status.
-- Mirrors protocol_action_cards exactly.
-- ---------------------------------------------------------------------------

ALTER TABLE public.protocol_notices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocol_notices_select"
  ON public.protocol_notices FOR SELECT TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_notices_insert"
  ON public.protocol_notices FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_notices_update"
  ON public.protocol_notices FOR UPDATE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_notices_delete"
  ON public.protocol_notices FOR DELETE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));


-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.protocol_notices IS
  'Protocol Awareness Layer — one ranked, evidence-linked observation per '
  '(protocol, notice_type), derived deterministically from already-extracted '
  'facts by protocol_notices_sync. Sibling of protocol_action_cards: a notice '
  'observes ("what I saw"), a card hands off ("go do this there"). No external '
  'destination, no link-out, no acted state. Sync deletes a notice whose '
  'predicate no longer holds (observation of current truth). TS mirror: '
  'src/types/actions/index.ts (NoticeRecord).';

COMMENT ON COLUMN public.protocol_notices.protocol_evidence_ids IS
  'Soft references into protocol_source_evidence — arrays cannot FK; stale '
  'ids are tolerated by readers (rendered as a source count, not resolved '
  'row-by-row).';


-- ---------------------------------------------------------------------------
-- 1. protocol_notices_sync
--
-- SECURITY DEFINER: must read SOTR's owner-only fact tables
-- (protocol_extracted_items / protocol_item_evidence_links /
-- protocol_source_evidence) on behalf of any user_can_access_protocol caller.
-- FIRST LINE OF DEFENSE: the user_can_access_protocol() check below.
--
-- Recomputes all four notice predicates from the same fact pool
-- action_cards_sync uses (rejected_from_draft items never enter; current_text
-- wins over extracted_value for string facts; each fact contributes its single
-- primary evidence row, is_primary_source, first by link created_at). Then, in
-- one pass over a server-owned spec list: upserts each notice whose count > 0
-- (preserving a 'dismissed' status), deletes each notice whose count is 0.
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
      'detail',      v_lowconf_count::TEXT || ' extracted fact'
                       || CASE WHEN v_lowconf_count = 1 THEN ' is' ELSE 's are' END
                       || ' low-confidence or awaiting review — verify against the source before relying on them.',
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
  'protocol is parsed. Deterministic prose from real counts only.';


-- ---------------------------------------------------------------------------
-- 2. protocol_notices_get — JSON array of NoticeRecord, ordered by
-- (severity, created_at). SECURITY INVOKER: RLS scopes the rows, and an
-- inaccessible protocol is indistinguishable from one with no notices (empty
-- array — no existence leak). Dismissed notices are included; the client
-- decides rendering.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protocol_notices_get(
  p_protocol_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN (
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',                    n.id,
          'protocol_id',           n.protocol_id,
          'notice_type',           n.notice_type,
          'severity',              n.severity,
          'headline',              n.headline,
          'detail',                n.detail,
          'observed_count',        n.observed_count,
          'protocol_evidence_ids', to_jsonb(n.protocol_evidence_ids),
          'status',                n.status,
          'created_at',            n.created_at,
          'updated_at',            n.updated_at
        )
        ORDER BY n.severity, n.created_at, n.id
      ),
      '[]'::jsonb
    )
      FROM protocol_notices n
     WHERE n.protocol_id = p_protocol_id
  );
END;
$$;

COMMENT ON FUNCTION protocol_notices_get IS
  'JSON array (possibly empty, never NULL) of a protocol''s notices, ordered '
  'by (severity, created_at). Field names = NoticeRecord in '
  'src/types/actions/index.ts. SECURITY INVOKER — RLS scopes the rows. '
  'Dismissed notices are included; the client renders them hidden.';


-- ---------------------------------------------------------------------------
-- 3. protocol_notice_set_status — active / dismissed.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION protocol_notice_set_status(
  p_notice_id UUID,
  p_status    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_notice_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('active', 'dismissed') THEN
    RAISE EXCEPTION 'Unknown notice status: %', p_status USING ERRCODE = '22023';
  END IF;

  -- RLS is the access gate (invisible row → NOT FOUND). FOR UPDATE so a
  -- concurrent sync's content refresh cannot interleave with the flip.
  SELECT id
    INTO v_notice_id
    FROM protocol_notices
   WHERE id = p_notice_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notice not found or access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE protocol_notices
     SET status = p_status
   WHERE id = v_notice_id;

  RETURN jsonb_build_object('notice_id', v_notice_id, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION protocol_notice_set_status IS
  'Sets a notice''s status: active (re-show) or dismissed (one-click, '
  'reversible — content preserved while the predicate holds). SECURITY '
  'INVOKER — RLS is the access gate.';


-- ---------------------------------------------------------------------------
-- Grants (repo pattern: EXECUTE to authenticated)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION protocol_notices_sync(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION protocol_notices_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION protocol_notice_set_status(UUID, TEXT) TO authenticated;
