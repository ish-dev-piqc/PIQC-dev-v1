-- =============================================================================
-- Context-Aware Action Layer — data spine.
--
-- protocol_action_cards: one optional, explainable next-action card per
-- (protocol, trigger_context). PIQC suggests and links out; execution happens
-- in external systems (travel tool, LMS, CTMS). Cards are derived
-- deterministically from already-extracted facts by action_cards_sync — a
-- card with no evidence and no deliverable behind it is a bug, not a feature.
--
-- Three RPCs:
--   action_cards_sync       — DEFINER (reads owner-gated SOTR fact tables),
--                             access-gated on the first line. Upserts the
--                             'monitoring_prep' travel card IFF the protocol
--                             has >= 1 deliverable. Re-sync refreshes content
--                             in place but NEVER writes status — a dismissed
--                             card stays dismissed (no resurrection; the
--                             deliverable engine's rejection discipline).
--   action_cards_get        — INVOKER. JSON array of ActionCardRecord,
--                             possibly empty, never NULL.
--   action_card_set_status  — INVOKER. suggested / dismissed / acted.
--                             'acted' records that the user followed the
--                             link-out — a click record, not workflow state;
--                             PIQC never claims the external action happened.
--
-- Decisions (plans/fable/action-layer.md):
--   1. suggested_window is always NULL in v1 — protocol-only data cannot
--      honestly suggest travel dates. Never fabricate.
--   2. external_url_or_template stays NULL until an org-config surface
--      exists — the card renders neutral guidance instead of a link-out.
--   3. Cards sync in their own RPC, never inside deliverable_generate.
--
-- Fact parsing reuses _deliv_json_string / _deliv_json_number_text
-- (20260708000100_deliverable_rpcs.sql) so the rationale counts can never
-- drift from how deliverable_generate reads the same hostile JSONB.
--
-- Draft-only vocabulary: cards are planning-support suggestions; nothing
-- here books, directs, or signs anything off.
--
-- TS mirror: src/types/actions/index.ts (ActionCardRecord).
-- Design + decisions: plans/fable/action-layer.md.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- protocol_action_cards
-- ---------------------------------------------------------------------------

CREATE TABLE public.protocol_action_cards (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id               UUID        NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  -- Anchor deliverable (latest generated_at at sync time). SET NULL: the card
  -- outlives its anchor; rationale + evidence keep it self-explanatory.
  deliverable_id            UUID        REFERENCES public.protocol_deliverables(id) ON DELETE SET NULL,
  trigger_context           TEXT        NOT NULL,
  title                     TEXT        NOT NULL,
  rationale                 TEXT        NOT NULL,
  protocol_evidence_ids     UUID[]      NOT NULL DEFAULT '{}',
  suggested_window          JSONB,
  external_destination_type TEXT        NOT NULL CHECK (external_destination_type IN ('travel', 'lms', 'ctms', 'none')),
  external_url_or_template  TEXT,
  disclaimer                TEXT        NOT NULL,
  status                    TEXT        NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'dismissed', 'acted')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One card per trigger per protocol; sync updates in place. The unique
  -- index this creates also serves the (protocol_id) read path — no separate
  -- index needed.
  UNIQUE (protocol_id, trigger_context)
);

CREATE TRIGGER touch_protocol_action_cards_updated_at
  BEFORE UPDATE ON public.protocol_action_cards
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- ---------------------------------------------------------------------------
-- RLS — all four commands route through user_can_access_protocol, the single
-- authorisation primitive. Status writes go through action_card_set_status.
-- ---------------------------------------------------------------------------

ALTER TABLE public.protocol_action_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "protocol_action_cards_select"
  ON public.protocol_action_cards FOR SELECT TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_action_cards_insert"
  ON public.protocol_action_cards FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_action_cards_update"
  ON public.protocol_action_cards FOR UPDATE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_action_cards_delete"
  ON public.protocol_action_cards FOR DELETE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));


-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.protocol_action_cards IS
  'Context-Aware Action Layer — one suggested next-action card per (protocol, '
  'trigger_context), derived deterministically from already-extracted facts '
  'by action_cards_sync. PIQC suggests and links out; execution happens in '
  'external systems. Re-sync refreshes content in place but never touches '
  'status: a dismissed card stays dismissed. TS mirror: '
  'src/types/actions/index.ts (ActionCardRecord).';

COMMENT ON COLUMN public.protocol_action_cards.protocol_evidence_ids IS
  'Soft references into protocol_source_evidence — arrays cannot FK; stale '
  'ids are tolerated by readers (rendered as a source count, not resolved '
  'row-by-row).';


-- ---------------------------------------------------------------------------
-- 1. action_cards_sync
--
-- SECURITY DEFINER: must read SOTR's owner-only fact tables
-- (protocol_extracted_items / protocol_item_evidence_links /
-- protocol_source_evidence) on behalf of any user_can_access_protocol caller.
-- FIRST LINE OF DEFENSE: the user_can_access_protocol() check below.
--
-- Emits the 'monitoring_prep' travel card IFF the protocol has >= 1
-- deliverable; with zero deliverables it is a no-op (an already-existing card
-- is left untouched — deliverables are never deleted in practice; revisit if
-- deliverable deletion ever ships). Fact pool mirrors deliverable_generate:
-- rejected_from_draft items never enter, current_text wins over
-- extracted_value for string facts, and each fact contributes its single
-- primary evidence row (is_primary_source, first by link created_at).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION action_cards_sync(
  p_protocol_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user               UUID := auth.uid();
  c_disclaimer CONSTANT TEXT := 'Planning support only — PIQC does not book travel, set monitoring cadence, or direct site visits. Execution happens in your organization''s systems.';
  c_base       CONSTANT TEXT := 'A monitoring visit for this protocol will need focused preparation';
  v_deliverable_id     UUID;
  v_card_id            UUID;
  v_endpoint_count     INTEGER := 0;
  v_endpoint_evidence  UUID[]  := ARRAY[]::UUID[];
  v_narrow_visit_count INTEGER := 0;
  v_visit_evidence     UUID[]  := ARRAY[]::UUID[];
  v_has_amendment      BOOLEAN := FALSE;
  v_amend_evidence_id  UUID;
  v_evidence_ids       UUID[]  := ARRAY[]::UUID[];
  v_clauses            TEXT[]  := ARRAY[]::TEXT[];
  v_rationale          TEXT;
  v_created            INTEGER := 0;
  v_updated            INTEGER := 0;
BEGIN
  -- First line of defense (this function bypasses RLS): the caller must be
  -- able to access the protocol via the single authorization primitive.
  IF v_user IS NULL OR NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RAISE EXCEPTION 'Protocol not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Card anchor: any one deliverable for the protocol, latest generated_at.
  -- No deliverable → no card to emit; return zero counts.
  SELECT id
    INTO v_deliverable_id
    FROM protocol_deliverables
   WHERE protocol_id = p_protocol_id
   ORDER BY generated_at DESC, id
   LIMIT 1;

  IF v_deliverable_id IS NULL THEN
    RETURN jsonb_build_object('cards_created', 0, 'cards_updated', 0);
  END IF;

  -- -------------------------------------------------------------------------
  -- Facts. Each block counts items AND collects their primary evidence ids in
  -- protocol order (field_path prefix, then the numeric array index inside
  -- it, then id — same ordering rationale as deliverable_generate's fact
  -- pool). Items without a primary evidence row still count; they just
  -- contribute no evidence id.
  -- -------------------------------------------------------------------------

  -- Primary endpoints with usable text (current_text wins for string facts).
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

  -- Narrow-window visits: <= 2 days of total scheduling tolerance. JSONB is
  -- parsed exactly the way deliverable_generate's visit pre-scan does: value
  -- must be an object with a usable visit_name (a nameless visit never enters
  -- the deliverable either); windows are number-typed or default to 0.
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

  -- Amendment in force: first amendment_summary metadata item with usable
  -- text (same LIMIT 1 discipline as deliverable_generate's Section 8).
  SELECT ev.id
    INTO v_amend_evidence_id
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
   ORDER BY ei.id
   LIMIT 1;
  v_has_amendment := FOUND;

  -- Evidence = exactly the facts counted above: endpoints, then narrow
  -- visits, then the amendment item. '{}' when none.
  v_evidence_ids := v_endpoint_evidence || v_visit_evidence;
  IF v_amend_evidence_id IS NOT NULL THEN
    v_evidence_ids := v_evidence_ids || v_amend_evidence_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- Rationale: deterministic prose from non-zero facts only. No scores, no
  -- dates. Plural-correct via the CASE WHEN n = 1 pattern.
  -- -------------------------------------------------------------------------
  IF v_endpoint_count > 0 THEN
    v_clauses := v_clauses || (
      v_endpoint_count::TEXT || ' primary endpoint'
      || CASE WHEN v_endpoint_count = 1 THEN ' requires' ELSE 's require' END
      || ' source-data verification'
    );
  END IF;

  IF v_narrow_visit_count > 0 THEN
    v_clauses := v_clauses || (
      v_narrow_visit_count::TEXT || ' visit'
      || CASE WHEN v_narrow_visit_count = 1 THEN ' allows' ELSE 's allow' END
      || ' 2 days or less of scheduling tolerance'
    );
  END IF;

  IF v_has_amendment THEN
    v_clauses := v_clauses || 'the protocol carries an amendment in force';
  END IF;

  v_rationale := CASE array_length(v_clauses, 1)
    WHEN 1 THEN c_base || ' — ' || v_clauses[1] || '.'
    WHEN 2 THEN c_base || ' — ' || v_clauses[1] || ' and ' || v_clauses[2] || '.'
    WHEN 3 THEN c_base || ' — ' || v_clauses[1] || ', ' || v_clauses[2] || ', and ' || v_clauses[3] || '.'
    -- All clauses zero (array_length of an empty array is NULL):
    ELSE c_base || ' — review the PIQC-drafted deliverables before planning.'
  END;

  -- -------------------------------------------------------------------------
  -- Upsert, status-preserving. The row lock serializes concurrent syncs;
  -- status is never referenced in either arm — DEFAULT 'suggested' on first
  -- insert, and a dismissed card is refreshed in place but stays dismissed.
  -- suggested_window NULL (Decision 1: never fabricate dates);
  -- external_url_or_template NULL (Decision 2: no third-party URL hardcoded).
  -- -------------------------------------------------------------------------
  SELECT id
    INTO v_card_id
    FROM protocol_action_cards
   WHERE protocol_id = p_protocol_id
     AND trigger_context = 'monitoring_prep'
     FOR UPDATE;

  IF FOUND THEN
    UPDATE protocol_action_cards
       SET deliverable_id        = v_deliverable_id,
           title                 = 'Plan monitoring travel',
           rationale             = v_rationale,
           protocol_evidence_ids = v_evidence_ids,
           disclaimer            = c_disclaimer
     WHERE id = v_card_id;
    v_updated := 1;
  ELSE
    INSERT INTO protocol_action_cards (
      protocol_id, deliverable_id, trigger_context, title, rationale,
      protocol_evidence_ids, suggested_window, external_destination_type,
      external_url_or_template, disclaimer
    )
    VALUES (
      p_protocol_id, v_deliverable_id, 'monitoring_prep',
      'Plan monitoring travel', v_rationale,
      v_evidence_ids, NULL, 'travel', NULL, c_disclaimer
    )
    ON CONFLICT (protocol_id, trigger_context) DO UPDATE
      SET deliverable_id        = EXCLUDED.deliverable_id,
          title                 = EXCLUDED.title,
          rationale             = EXCLUDED.rationale,
          protocol_evidence_ids = EXCLUDED.protocol_evidence_ids,
          disclaimer            = EXCLUDED.disclaimer;
    v_created := 1;
  END IF;

  RETURN jsonb_build_object('cards_created', v_created, 'cards_updated', v_updated);
END;
$$;

COMMENT ON FUNCTION action_cards_sync IS
  'Upserts the ''monitoring_prep'' travel card for a protocol IFF it has at '
  'least one deliverable. SECURITY DEFINER (reads owner-gated SOTR fact '
  'tables) gated by user_can_access_protocol as the first line of defense. '
  'Rationale is assembled deterministically from real facts only '
  '(primary-endpoint count, <= 2-day-window visit count, amendment '
  'presence); protocol_evidence_ids carries those facts'' primary evidence '
  'ids. Never writes status — a dismissed card is refreshed in place but '
  'stays dismissed. suggested_window and external_url_or_template are always '
  'NULL in v1 (plans/fable/action-layer.md Decisions 1–2).';


-- ---------------------------------------------------------------------------
-- 2. action_cards_get — JSON array of ActionCardRecord, ordered by
-- created_at. SECURITY INVOKER: RLS scopes the rows, and an inaccessible
-- protocol is indistinguishable from one with no cards (empty array — no
-- existence leak). Dismissed cards are included; the client decides rendering.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION action_cards_get(
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
          'id',                        c.id,
          'protocol_id',               c.protocol_id,
          'deliverable_id',            c.deliverable_id,
          'trigger_context',           c.trigger_context,
          'title',                     c.title,
          'rationale',                 c.rationale,
          'protocol_evidence_ids',     to_jsonb(c.protocol_evidence_ids),
          'suggested_window',          c.suggested_window,
          'external_destination_type', c.external_destination_type,
          'external_url_or_template',  c.external_url_or_template,
          'disclaimer',                c.disclaimer,
          'status',                    c.status,
          'created_at',                c.created_at,
          'updated_at',                c.updated_at
        )
        ORDER BY c.created_at, c.id
      ),
      '[]'::jsonb
    )
      FROM protocol_action_cards c
     WHERE c.protocol_id = p_protocol_id
  );
END;
$$;

COMMENT ON FUNCTION action_cards_get IS
  'JSON array (possibly empty, never NULL) of a protocol''s action cards, '
  'ordered by created_at. Field names = ActionCardRecord in '
  'src/types/actions/index.ts. SECURITY INVOKER — RLS scopes the rows. '
  'Dismissed cards are included; the client renders them hidden.';


-- ---------------------------------------------------------------------------
-- 3. action_card_set_status — suggested / dismissed / acted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION action_card_set_status(
  p_card_id UUID,
  p_status  TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_card_id UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('suggested', 'dismissed', 'acted') THEN
    RAISE EXCEPTION 'Unknown card status: %', p_status USING ERRCODE = '22023';
  END IF;

  -- RLS is the access gate (invisible row → NOT FOUND). FOR UPDATE so a
  -- concurrent sync's content refresh cannot interleave with the flip.
  SELECT id
    INTO v_card_id
    FROM protocol_action_cards
   WHERE id = p_card_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Card not found or access denied' USING ERRCODE = '42501';
  END IF;

  UPDATE protocol_action_cards
     SET status = p_status
   WHERE id = v_card_id;

  RETURN jsonb_build_object('card_id', v_card_id, 'status', p_status);
END;
$$;

COMMENT ON FUNCTION action_card_set_status IS
  'Sets a card''s status: suggested (re-show), dismissed (one-click, '
  'reversible — content preserved), or acted (the user followed the '
  'link-out; a click record, not a claim the external action happened). '
  'SECURITY INVOKER — RLS is the access gate.';


-- ---------------------------------------------------------------------------
-- Grants (repo pattern: EXECUTE to authenticated)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION action_cards_sync(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION action_cards_get(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION action_card_set_status(UUID, TEXT) TO authenticated;
