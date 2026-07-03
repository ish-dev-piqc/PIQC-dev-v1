-- =============================================================================
-- Protocol Deliverable Engine — RPCs (migration 2 of 2).
--
-- Seven functions over the tables from 20260708000000_protocol_deliverables_
-- schema.sql:
--
--   deliverable_generate          — DEFINER. Selects facts from SOTR's
--                                   owner-gated tables, ports the deterministic
--                                   monitoring-checklist ruleset, and upserts
--                                   the artifact + blocks. Regeneration
--                                   PRESERVES human work (see below).
--   deliverable_get_packet        — INVOKER. Self-contained JSON packet
--                                   (DeliverablePacket); the client never joins
--                                   SOTR tables.
--   deliverable_set_block_review  — INVOKER. Review actions (locking + audit).
--   deliverable_edit_block_text   — INVOKER. Text edit (version bump + audit).
--   deliverable_add_block         — INVOKER. Human editorial block.
--   deliverable_delete_block      — INVOKER. Hard delete, human_editorial only.
--   deliverable_export_packet     — INVOKER. Server-stamped export packet,
--                                   sponsor-name-free.
--
-- SELECTION RULESET: this is the PL/pgSQL port of the unit-tested SPEC in
-- src/lib/deliverables/selection/monitoringChecklist.ts
-- (selectMonitoringChecklistBlocks). Same 9 sections, same prose templates,
-- same guards, same emission policy. Change the TS spec first, keep its tests
-- green, then mirror here.
--
-- REGENERATE SEMANTICS ("human edit wins"):
--   Fingerprint = (section_key, block_type,
--                  COALESCE(extracted_item_id::text, derived_text)).
--   Blocks sharing a fingerprint (e.g. several Section-6 procedure blocks from
--   one visit item) pair up by rank (sort order) on both sides.
--   - Matched block → refresh parser-owned fields (derived_text, evidence
--     passthrough, confidence, sort_order); NEVER touch current_text,
--     review_state, review_note, version.
--   - Unmatched parser block, untouched (draft + no current_text) → DELETE.
--   - Unmatched parser block, human-touched → KEEP, review_state =
--     'needs_review' (its source disappeared — a human must look).
--   - Rejected blocks → kept exactly as-is, matched or not. They still consume
--     their match so regeneration never resurrects rejected content.
--   - human_editorial blocks → never deleted or modified by regeneration.
--
-- Draft-only vocabulary: nothing here is ever "approved".
-- SENSITIVE: source_quote / quoted_text / review notes flow through these
-- functions — never log them (error messages carry no row content).
--
-- TS mirror of every returned shape: src/types/deliverables/index.ts.
-- Design + decisions: plans/fable/monitoring-prep-checklist.md.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Helpers (pure; no table access → no search_path needed, mirrors _vew_*)
-- ---------------------------------------------------------------------------

-- Port of asTrimmedString(): JSON string → trimmed text, NULL for any other
-- type or an empty/whitespace-only string. extracted_value is hostile input.
CREATE OR REPLACE FUNCTION _deliv_json_string(p_value JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_value IS NOT NULL AND jsonb_typeof(p_value) = 'string'
      THEN NULLIF(btrim(p_value #>> '{}'), '')
  END;
$$;

-- Port of asFiniteNumber() for prose rendering: JSON number → its raw token
-- text (matches how the TS template interpolates the number), NULL otherwise.
-- jsonb numbers are always finite, so no extra guard is needed.
CREATE OR REPLACE FUNCTION _deliv_json_number_text(p_value JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN p_value IS NOT NULL AND jsonb_typeof(p_value) = 'number'
      THEN p_value #>> '{}'
  END;
$$;

-- Port of categorizeProcedure(): Section-6 keyword heuristic. Vendor is
-- checked FIRST (its keywords are the most specific — 'central lab' would
-- otherwise be shadowed by the specimen 'lab' keyword), then imaging, then
-- specimen. \y = Postgres word boundary, the equivalent of the spec's \b
-- regexes — a plain ILIKE '%lab%' would false-hit the 'lab' in 'available'.
CREATE OR REPLACE FUNCTION _deliv_procedure_category(p_procedure TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN lower(p_procedure) ~ ANY (ARRAY[
      '\yvendor\y', '\ycentral lab', '\ycourier\y', '\yshipment\y'
    ]) THEN 'vendor'
    WHEN lower(p_procedure) ~ ANY (ARRAY[
      '\yecg\y', '\yimaging\y', '\ymri\y', '\yct\y', '\yx-ray\y', '\yscan', '\yecho'
    ]) THEN 'imaging'
    WHEN lower(p_procedure) ~ ANY (ARRAY[
      '\ylabs?\y', '\ylaboratory\y', '\yblood\y', '\yserum\y', '\yplasma\y',
      '\yurine\y', '\yspecimens?\y', '\ysamples?\y'
    ]) THEN 'specimen'
  END;
$$;

COMMENT ON FUNCTION _deliv_procedure_category IS
  'Section-6 keyword heuristic for the monitoring checklist. MUST stay in '
  'lockstep with categorizeProcedure() in src/lib/deliverables/selection/'
  'monitoringChecklist.ts (the unit-tested spec).';


-- Shared block-array builder for deliverable_get_packet +
-- deliverable_export_packet. SECURITY INVOKER on purpose: RLS on
-- protocol_deliverable_blocks scopes the rows to the caller. Rejected blocks
-- are EXCLUDED — they exist only in the DB (and the edit log) so regeneration
-- will not resurrect them. Shape = DeliverablePacketBlock.
CREATE OR REPLACE FUNCTION _deliv_blocks_json(p_deliverable_id UUID)
RETURNS JSONB
LANGUAGE sql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',                 b.id,
        'section_key',        b.section_key,
        'block_type',         b.block_type,
        'content_origin',     b.content_origin,
        'display_text',       COALESCE(b.current_text, b.derived_text, ''),
        'derived_text',       b.derived_text,
        'current_text',       b.current_text,
        'source_evidence_id', b.source_evidence_id,
        'source_quote',       b.source_quote,
        'source_page_number', b.source_page_number,
        'source_section',     b.source_section,
        'confidence_state',   b.confidence_state,
        'review_state',       b.review_state,
        'review_note',        b.review_note,
        'version',            b.version,
        'sort_order',         b.sort_order
      )
      ORDER BY b.sort_order, b.created_at, b.id
    ),
    '[]'::jsonb
  )
    FROM protocol_deliverable_blocks b
   WHERE b.deliverable_id = p_deliverable_id
     AND b.review_state <> 'rejected';
$$;


-- ---------------------------------------------------------------------------
-- 1. deliverable_generate
--
-- SECURITY DEFINER: must read SOTR's owner-only tables
-- (protocol_extracted_items / protocol_item_evidence_links /
-- protocol_source_evidence) on behalf of any user_can_access_protocol caller
-- — SOTR RLS is documents.user_id-gated and a sponsor can never pass it.
-- FIRST LINE OF DEFENSE: the user_can_access_protocol() check below.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_generate(
  p_protocol_id   UUID,
  p_artifact_type deliverable_artifact_type
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user             UUID := auth.uid();
  v_deliverable_id   UUID;
  v_protocol_version TEXT;
  v_sort             INTEGER := 0;
  v_existing_count   INTEGER := 0;
  v_deleted          INTEGER := 0;
  v_created          INTEGER := 0;
  v_safety_count     INTEGER := 0;
  v_seen             TEXT[]  := ARRAY[]::TEXT[];
  v_item             RECORD;
  v_visit            RECORD;
  v_cohort           RECORD;
  v_val              JSONB;
  v_visit_name       TEXT;
  v_study_day_txt    TEXT;
  v_wminus           NUMERIC;
  v_wplus            NUMERIC;
  v_wminus_txt       TEXT;
  v_wplus_txt        TEXT;
  v_procedures       TEXT[];
  v_proc             TEXT;
  v_category         TEXT;
  v_day_text         TEXT;
  v_window_text      TEXT;
  v_prefix           TEXT;
  v_dose             TEXT;
  v_desc             TEXT;
BEGIN
  -- First line of defense (this function bypasses RLS): the caller must be
  -- able to access the protocol via the single authorization primitive.
  IF v_user IS NULL OR NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RAISE EXCEPTION 'Protocol not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Programmer-error guard: the enum has one value today, but a future enum
  -- extension must not silently receive monitoring-checklist content.
  IF p_artifact_type <> 'monitoring_prep_checklist' THEN
    RAISE EXCEPTION 'Unsupported artifact type: %', p_artifact_type
      USING ERRCODE = '22023';
  END IF;

  -- -------------------------------------------------------------------------
  -- Working tables (session-temp, dropped at commit). IF NOT EXISTS + DELETE
  -- keeps a same-transaction double-call safe.
  -- -------------------------------------------------------------------------
  CREATE TEMP TABLE IF NOT EXISTS _deliv_items (
    ord              BIGINT,
    item_id          UUID,
    field_type       TEXT,
    field_path       TEXT,
    extracted_value  JSONB,
    confidence_state confidence_state,
    value_text       TEXT,   -- asTrimmedString(extracted_value), pre-computed
    evidence_id      UUID,
    quoted_text      TEXT,   -- sensitive — never log
    page_number      INTEGER,
    section_title    TEXT
  ) ON COMMIT DROP;
  DELETE FROM _deliv_items;

  CREATE TEMP TABLE IF NOT EXISTS _deliv_visits (
    ord              BIGINT,
    item_id          UUID,
    confidence_state confidence_state,
    evidence_id      UUID,
    quoted_text      TEXT,   -- sensitive — never log
    page_number      INTEGER,
    section_title    TEXT,
    visit_name       TEXT,
    study_day_txt    TEXT,
    wminus           NUMERIC,
    wplus            NUMERIC,
    wminus_txt       TEXT,
    wplus_txt        TEXT,
    procedures       TEXT[]
  ) ON COMMIT DROP;
  DELETE FROM _deliv_visits;

  CREATE TEMP TABLE IF NOT EXISTS _deliv_new_specs (
    ord                INTEGER,  -- global emission counter = new sort_order
    section_key        TEXT,
    block_type         TEXT,
    content_origin     deliverable_content_origin,
    derived_text       TEXT,
    extracted_item_id  UUID,
    source_evidence_id UUID,
    source_quote       TEXT,    -- sensitive — never log
    source_page_number INTEGER,
    source_section     TEXT,
    confidence_state   confidence_state,
    fingerprint        TEXT,
    match_rank         INTEGER,
    matched_block_id   UUID
  ) ON COMMIT DROP;
  DELETE FROM _deliv_new_specs;

  -- -------------------------------------------------------------------------
  -- Load the fact pool: every extracted item for the protocol, joined to its
  -- primary evidence (is_primary_source), denormalized once.
  --
  -- Input order for the ruleset = protocol order: field_path prefix, then the
  -- numeric array index inside it ("key_inclusion_criteria[10]" sorts after
  -- "[2]"). created_at is useless here — one ingest transaction stamps every
  -- row with the same NOW(), which would leave the order to random UUIDs.
  --
  -- SOTR review is honored at the source: an item the reviewer edited
  -- contributes its current_text ("current_text wins" — same contract as
  -- sotr_get_draft_confidence_packet), and an item rejected_from_draft never
  -- enters the pool at all. Visit prose is built from the JSONB object, so
  -- current_text overrides apply to string-valued facts only.
  -- -------------------------------------------------------------------------
  INSERT INTO _deliv_items (
    ord, item_id, field_type, field_path, extracted_value, confidence_state,
    value_text, evidence_id, quoted_text, page_number, section_title
  )
  SELECT
    ROW_NUMBER() OVER (ORDER BY
      split_part(ei.field_path, '[', 1),
      COALESCE(NULLIF(regexp_replace(ei.field_path, '[^0-9]', '', 'g'), '')::int, 0),
      ei.id),
    ei.id,
    ei.field_type,
    ei.field_path,
    ei.extracted_value,
    ei.confidence_state,
    COALESCE(NULLIF(btrim(ei.current_text), ''), _deliv_json_string(ei.extracted_value)),
    ev.id,
    ev.quoted_text,
    ev.page_number,
    ev.section_title
    FROM protocol_extracted_items ei
    JOIN documents d ON d.id = ei.document_id
    LEFT JOIN LATERAL (
      SELECT se.id, se.quoted_text, se.page_number, se.section_title
        FROM protocol_item_evidence_links l
        JOIN protocol_source_evidence se ON se.id = l.source_evidence_id
       WHERE l.extracted_item_id = ei.id
         AND l.is_primary_source
       ORDER BY l.created_at, l.id
       LIMIT 1
    ) ev ON TRUE
   WHERE d.protocol_id = p_protocol_id
     AND ei.review_status IS DISTINCT FROM 'rejected_from_draft';

  -- Protocol version label (nullable — parser may not have extracted one).
  -- value_text already prefers the SOTR reviewer's current_text correction.
  SELECT COALESCE(
           NULLIF(btrim(value_text), ''),
           CASE WHEN jsonb_typeof(extracted_value) <> 'string'
                THEN extracted_value::text END
         )
    INTO v_protocol_version
    FROM _deliv_items
   WHERE field_type = 'metadata'
     AND field_path = 'protocol_version'
   ORDER BY ord DESC
   LIMIT 1;

  -- -------------------------------------------------------------------------
  -- Upsert the artifact row and LOCK it — serializes concurrent generates on
  -- the same (protocol, artifact_type) so block matching never races.
  -- -------------------------------------------------------------------------
  SELECT id
    INTO v_deliverable_id
    FROM protocol_deliverables
   WHERE protocol_id = p_protocol_id
     AND artifact_type = p_artifact_type
     FOR UPDATE;

  IF FOUND THEN
    UPDATE protocol_deliverables
       SET title            = 'Monitoring Preparation Checklist',
           protocol_version = v_protocol_version,
           generated_by     = v_user,
           regenerated_at   = NOW()
     WHERE id = v_deliverable_id;
  ELSE
    INSERT INTO protocol_deliverables (
      protocol_id, artifact_type, title, protocol_version, generated_by
    )
    VALUES (
      p_protocol_id, p_artifact_type,
      'Monitoring Preparation Checklist',
      v_protocol_version, v_user
    )
    ON CONFLICT (protocol_id, artifact_type) DO UPDATE
      SET title            = EXCLUDED.title,
          protocol_version = EXCLUDED.protocol_version,
          generated_by     = EXCLUDED.generated_by,
          regenerated_at   = NOW()
    RETURNING id INTO v_deliverable_id;
  END IF;

  SELECT COUNT(*)
    INTO v_existing_count
    FROM protocol_deliverable_blocks
   WHERE deliverable_id = v_deliverable_id;

  -- -------------------------------------------------------------------------
  -- Pre-scan visits (port of readVisitValue): value must be a JSON object
  -- (not array) with a usable visit_name — a nameless visit cannot produce
  -- meaningful checklist prose. Windows default to 0; a non-array procedures
  -- field degrades to an empty list.
  -- -------------------------------------------------------------------------
  FOR v_item IN
    SELECT * FROM _deliv_items WHERE field_type = 'visit' ORDER BY ord
  LOOP
    v_val := v_item.extracted_value;
    CONTINUE WHEN v_val IS NULL OR jsonb_typeof(v_val) <> 'object';

    v_visit_name := _deliv_json_string(v_val->'visit_name');
    CONTINUE WHEN v_visit_name IS NULL;

    v_study_day_txt := _deliv_json_number_text(v_val->'study_day');
    v_wminus_txt    := COALESCE(_deliv_json_number_text(v_val->'window_minus_days'), '0');
    v_wplus_txt     := COALESCE(_deliv_json_number_text(v_val->'window_plus_days'), '0');
    v_wminus        := v_wminus_txt::NUMERIC;
    v_wplus         := v_wplus_txt::NUMERIC;

    IF jsonb_typeof(v_val->'procedures') = 'array' THEN
      SELECT COALESCE(array_agg(s.p ORDER BY s.idx), ARRAY[]::TEXT[])
        INTO v_procedures
        FROM (
          SELECT _deliv_json_string(o.elem) AS p, o.idx
            FROM jsonb_array_elements(v_val->'procedures')
                 WITH ORDINALITY AS o(elem, idx)
        ) s
       WHERE s.p IS NOT NULL;
    ELSE
      v_procedures := ARRAY[]::TEXT[];
    END IF;

    INSERT INTO _deliv_visits (
      ord, item_id, confidence_state, evidence_id, quoted_text, page_number,
      section_title, visit_name, study_day_txt, wminus, wplus, wminus_txt,
      wplus_txt, procedures
    )
    VALUES (
      v_item.ord, v_item.item_id, v_item.confidence_state, v_item.evidence_id,
      v_item.quoted_text, v_item.page_number, v_item.section_title,
      v_visit_name, v_study_day_txt, v_wminus, v_wplus, v_wminus_txt,
      v_wplus_txt, v_procedures
    );
  END LOOP;

  -- =========================================================================
  -- THE RULESET — port of selectMonitoringChecklistBlocks(). Prose templates
  -- are byte-for-byte copies of the TS spec (em dashes and the U+2212 minus
  -- included). sort_order (v_sort) is one global 0-based counter.
  -- =========================================================================

  -- --- 1. eligibility_verification (facts; empty when nothing extracted) ----
  IF EXISTS (
    SELECT 1 FROM _deliv_items
     WHERE field_type = 'inclusion_criterion' AND value_text IS NOT NULL
  ) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'eligibility_verification', 'section_intro', 'derived_operational_framing',
      'Verify each enrolled participant against the inclusion criteria below. '
      'Confirm source documentation supports every criterion at the time of enrollment.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'inclusion_criterion' AND value_text IS NOT NULL
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_verification', 'checklist_item', 'protocol_fact',
        'Verify: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 2. exclusion_prohibited_med_review (facts + ALWAYS a coverage gap) ---
  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'exclusion_prohibited_med_review', 'section_intro', 'derived_operational_framing',
    'Confirm no enrolled participant meets an exclusion criterion below, and '
    'review medication history against protocol restrictions.');
  v_sort := v_sort + 1;

  FOR v_item IN
    SELECT * FROM _deliv_items
     WHERE field_type = 'exclusion_criterion' AND value_text IS NOT NULL
     ORDER BY ord
  LOOP
    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'exclusion_prohibited_med_review', 'checklist_item', 'protocol_fact',
      'Confirm absence of: ' || v_item.value_text,
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  END LOOP;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'exclusion_prohibited_med_review', 'checklist_item', 'derived_operational_framing',
    'No prohibited-medication list was extracted from this protocol. Review the '
    'concomitant/prohibited medication section of the protocol manually and '
    'verify medication-history cross-checks at the site.');
  v_sort := v_sort + 1;

  -- --- 3. visit_window_verification (facts; empty when nothing extracted) ---
  IF EXISTS (SELECT 1 FROM _deliv_visits) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'visit_window_verification', 'section_intro', 'derived_operational_framing',
      'Check each visit below against its protocol-defined window. Any '
      'out-of-window visit requires a documented deviation.');
    v_sort := v_sort + 1;

    FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
      v_day_text := CASE
        WHEN v_visit.study_day_txt IS NOT NULL
          THEN 'study day ' || v_visit.study_day_txt
        ELSE 'its scheduled study day'
      END;
      v_window_text := CASE
        WHEN v_visit.wminus = 0 AND v_visit.wplus = 0
          THEN 'no window — exact day'
        ELSE 'window −' || v_visit.wminus_txt || '/+' || v_visit.wplus_txt || ' days'
      END;

      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'visit_window_verification', 'checklist_item', 'protocol_fact',
        'Verify ' || v_visit.visit_name || ' occurred on ' || v_day_text
          || ' (' || v_window_text || ') and '
          'that any out-of-window visits are documented with a deviation.',
        v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title,
        COALESCE(v_visit.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 4. endpoint_critical_checks (facts; empty when nothing extracted) ----
  IF EXISTS (
    SELECT 1 FROM _deliv_items
     WHERE field_type = 'endpoint' AND value_text IS NOT NULL
  ) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'endpoint_critical_checks', 'section_intro', 'derived_operational_framing',
      'Endpoint data drives the study conclusions. Verify source data '
      'completeness for each endpoint-critical item below.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'endpoint' AND value_text IS NOT NULL
       ORDER BY ord
    LOOP
      v_prefix := CASE
        WHEN v_item.field_path LIKE 'primary\_endpoints%'
          THEN 'PRIMARY ENDPOINT — '
        ELSE 'Secondary endpoint — '
      END;

      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'endpoint_critical_checks', 'checklist_item', 'protocol_fact',
        v_prefix || 'verify source data completeness for: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 5. arm_cohort_randomization_deps (framing; only when cohorts exist) --
  -- Cohorts come from protocol_cohorts, a separate table with no passthrough
  -- evidence row in this input — so cohort blocks are framing, not facts.
  IF EXISTS (
    SELECT 1 FROM protocol_cohorts
     WHERE protocol_id = p_protocol_id AND NULLIF(btrim(label), '') IS NOT NULL
  ) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'arm_cohort_randomization_deps', 'section_intro', 'derived_operational_framing',
      'This protocol defines multiple cohorts/arms. Verify assignment and '
      'dosing dependencies for each cohort below.');
    v_sort := v_sort + 1;

    FOR v_cohort IN
      SELECT NULLIF(btrim(c.label), '') AS label, c.dose_regimen, c.description
        FROM protocol_cohorts c
       WHERE c.protocol_id = p_protocol_id
       ORDER BY c.ordinal, c.label
    LOOP
      CONTINUE WHEN v_cohort.label IS NULL;
      v_dose := COALESCE(NULLIF(btrim(COALESCE(v_cohort.dose_regimen, '')), ''), 'dose per protocol');
      v_desc := NULLIF(btrim(COALESCE(v_cohort.description, '')), '');

      INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
      VALUES (v_sort, 'arm_cohort_randomization_deps', 'checklist_item', 'derived_operational_framing',
        'Cohort ' || v_cohort.label || ': ' || v_dose || ' — verify participants are assigned per '
        'protocol and dosing matches the cohort.'
        || COALESCE(' Description: ' || v_desc, ''));
      v_sort := v_sort + 1;
    END LOOP;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'arm_cohort_randomization_deps', 'checklist_item', 'derived_operational_framing',
      'Randomization mechanics are not extracted by PIQC — verify assignment '
      'procedures against the protocol''s randomization section.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 6. safety_specimen_imaging_vendor_checks (heuristic facts, forced low) --
  -- One block per matched visit-procedure pair; identical procedure strings
  -- across visits are deduped — the first visit wins and is named in the text.
  v_safety_count := 0;
  v_seen := ARRAY[]::TEXT[];
  FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
    FOREACH v_proc IN ARRAY v_visit.procedures LOOP
      v_category := _deliv_procedure_category(v_proc);
      CONTINUE WHEN v_category IS NULL;
      CONTINUE WHEN lower(v_proc) = ANY (v_seen);
      v_seen := v_seen || lower(v_proc);

      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'safety_specimen_imaging_vendor_checks', 'checklist_item', 'protocol_fact',
        'Confirm handling/documentation for ''' || v_proc || ''' (' || v_visit.visit_name || ') '
        '— ' || v_category || ' workflow.',
        v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title,
        -- heuristic match — confidence is forced low regardless of the visit
        -- item's own state
        'low'
      );
      v_sort := v_sort + 1;
      v_safety_count := v_safety_count + 1;
    END LOOP;
  END LOOP;

  IF v_safety_count = 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'safety_specimen_imaging_vendor_checks', 'checklist_item', 'derived_operational_framing',
      'No laboratory, imaging, or vendor-dependent procedures were detected in '
      'the extracted visit schedule. Review the protocol''s laboratory manual, '
      'imaging charter, and vendor plans manually to verify these workflows at the site.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 7. source_doc_focus (framing only) -----------------------------------
  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'source_doc_focus', 'section_intro', 'derived_operational_framing',
    'Focus source-document verification on the highest-risk data areas '
    'identified for this protocol. Source records must support every CRF entry.');
  v_sort := v_sort + 1;

  IF EXISTS (
    SELECT 1 FROM _deliv_items
     WHERE field_type = 'endpoint'
       AND value_text IS NOT NULL
       AND field_path LIKE 'primary\_endpoints%'
  ) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'source_doc_focus', 'checklist_item', 'derived_operational_framing',
      'Prioritize source verification for primary-endpoint data points.');
    v_sort := v_sort + 1;
  END IF;

  IF v_safety_count > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'source_doc_focus', 'checklist_item', 'derived_operational_framing',
      'Confirm safety assessments are documented in source, not only in the CRF.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 8. amendment_sensitive (fact when an amendment was extracted) --------
  SELECT *
    INTO v_item
    FROM _deliv_items
   WHERE field_type = 'metadata'
     AND field_path = 'amendment_summary'
     AND value_text IS NOT NULL
   ORDER BY ord
   LIMIT 1;

  IF FOUND THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'amendment_sensitive', 'section_intro', 'derived_operational_framing',
      'This protocol has amendment activity. Requirements may have changed '
      'between versions — confirm the site operates from the current version.');
    v_sort := v_sort + 1;

    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'amendment_sensitive', 'checklist_item', 'protocol_fact',
      'Amendment noted: ' || v_item.value_text || '. Verify affected requirements '
      'below are executed per the CURRENT version.',
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'amendment_sensitive', 'checklist_item', 'derived_operational_framing',
      'No amendment was detected in this protocol version. Confirm with the '
      'sponsor that you hold the current version.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 9. site_questions (templated framing, always) ------------------------
  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES
    (v_sort, 'site_questions', 'site_question', 'derived_operational_framing',
      'Have there been any staffing changes since the last monitoring visit? If '
      'so, confirm delegation-of-authority updates and training documentation for new staff.'),
    (v_sort + 1, 'site_questions', 'site_question', 'derived_operational_framing',
      'How is investigator oversight documented between monitoring visits? Ask '
      'to see where the investigator''s review of safety data and eligibility decisions is recorded.'),
    (v_sort + 2, 'site_questions', 'site_question', 'derived_operational_framing',
      'How does enrollment compare with the screening-failure rate? Discuss any '
      'pattern that could indicate eligibility pressure or recruitment difficulties.');
  v_sort := v_sort + 3;

  -- =========================================================================
  -- MATCH + APPLY — "human edit wins".
  -- =========================================================================

  -- Fingerprint every new spec, then rank duplicates so both sides pair 1:1.
  -- derived_text is PART of the fingerprint (not just a fallback): a match
  -- means "same section, same kind, same source item, same content". Changed
  -- content therefore never silently inherits a human's review_state — the
  -- old block falls out as unmatched (kept + flagged if touched, deleted if
  -- pristine) and the new text arrives as a fresh draft. It also means a
  -- rejected block only ever consumes the match for content identical to
  -- what was rejected, and Section-6 siblings from one visit item can never
  -- re-pair onto each other's procedures when the list reorders.
  UPDATE _deliv_new_specs
     SET fingerprint = section_key || '|' || block_type || '|'
                       || COALESCE(extracted_item_id::text, '') || '|'
                       || COALESCE(derived_text, '');

  UPDATE _deliv_new_specs s
     SET match_rank = r.rn
    FROM (
      SELECT ord, ROW_NUMBER() OVER (PARTITION BY fingerprint ORDER BY ord) AS rn
        FROM _deliv_new_specs
    ) r
   WHERE r.ord = s.ord;

  -- Pair with existing parser-origin blocks (human_editorial never matches —
  -- it is never generated). Rejected blocks DO participate: they consume
  -- their spec so regeneration cannot resurrect rejected content as a fresh
  -- draft — but they are never updated below.
  UPDATE _deliv_new_specs s
     SET matched_block_id = e.id
    FROM (
      SELECT b.id,
             b.section_key || '|' || b.block_type || '|'
               || COALESCE(b.extracted_item_id::text, '') || '|'
               || COALESCE(b.derived_text, '') AS fingerprint,
             ROW_NUMBER() OVER (
               PARTITION BY b.section_key || '|' || b.block_type || '|'
                 || COALESCE(b.extracted_item_id::text, '') || '|'
                 || COALESCE(b.derived_text, '')
               ORDER BY b.sort_order, b.created_at, b.id
             ) AS rn
        FROM protocol_deliverable_blocks b
       WHERE b.deliverable_id = v_deliverable_id
         AND b.content_origin <> 'human_editorial'
    ) e
   WHERE e.fingerprint = s.fingerprint
     AND e.rn = s.match_rank;

  -- Matched (and not rejected): refresh the parser-owned fields. A match
  -- implies identical derived_text (it's in the fingerprint), so this only
  -- ever moves evidence/confidence/sort — never visible content.
  -- current_text, review_state, review_note, version are intentionally
  -- untouched — the human's work survives regeneration.
  UPDATE protocol_deliverable_blocks b
     SET derived_text       = s.derived_text,
         source_evidence_id = s.source_evidence_id,
         source_quote       = s.source_quote,
         source_page_number = s.source_page_number,
         source_section     = s.source_section,
         confidence_state   = s.confidence_state,
         sort_order         = s.ord
    FROM _deliv_new_specs s
   WHERE b.id = s.matched_block_id
     AND b.review_state <> 'rejected';

  -- Unmatched parser blocks, untouched by a human → delete. "Untouched" is
  -- strict: still draft AND no text overlay.
  DELETE FROM protocol_deliverable_blocks b
   WHERE b.deliverable_id = v_deliverable_id
     AND b.content_origin <> 'human_editorial'
     AND NOT EXISTS (
       SELECT 1 FROM _deliv_new_specs s WHERE s.matched_block_id = b.id
     )
     AND b.review_state = 'draft'
     AND b.current_text IS NULL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Unmatched parser blocks a human touched → keep, but flag: the source
  -- fact disappeared, so a human must look. Rejected blocks stay as-is.
  UPDATE protocol_deliverable_blocks b
     SET review_state = 'needs_review'
   WHERE b.deliverable_id = v_deliverable_id
     AND b.content_origin <> 'human_editorial'
     AND NOT EXISTS (
       SELECT 1 FROM _deliv_new_specs s WHERE s.matched_block_id = b.id
     )
     AND b.review_state NOT IN ('rejected', 'needs_review');

  -- New specs with no match → fresh draft blocks, version 1.
  INSERT INTO protocol_deliverable_blocks (
    deliverable_id, section_key, block_type, content_origin,
    derived_text, extracted_item_id, source_evidence_id,
    source_quote, source_page_number, source_section,
    confidence_state, review_state, protocol_version, sort_order, version
  )
  SELECT
    v_deliverable_id, s.section_key, s.block_type, s.content_origin,
    s.derived_text, s.extracted_item_id, s.source_evidence_id,
    s.source_quote, s.source_page_number, s.source_section,
    s.confidence_state, 'draft', v_protocol_version, s.ord, 1
    FROM _deliv_new_specs s
   WHERE s.matched_block_id IS NULL
   ORDER BY s.ord;
  GET DIAGNOSTICS v_created = ROW_COUNT;

  RETURN jsonb_build_object(
    'deliverable_id',   v_deliverable_id,
    'blocks_created',   v_created,
    'blocks_preserved', v_existing_count - v_deleted
  );
END;
$$;

COMMENT ON FUNCTION deliverable_generate IS
  'Generates / regenerates a protocol deliverable from already-extracted SOTR '
  'facts. SECURITY DEFINER (reads owner-gated SOTR tables) gated by '
  'user_can_access_protocol as the first line of defense. PL/pgSQL port of '
  'the unit-tested spec in src/lib/deliverables/selection/'
  'monitoringChecklist.ts — change the TS spec first, then mirror here. '
  'Regeneration preserves human work: human_editorial blocks are never '
  'touched, human-edited/reviewed blocks keep current_text + review_state, '
  'rejected blocks are remembered and never resurrected.';


-- ---------------------------------------------------------------------------
-- 2. deliverable_get_packet — DeliverablePacket, or NULL when no deliverable
-- exists (also what a non-member sees: RLS hides the row, so absence and
-- denial are indistinguishable — no existence leak).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_get_packet(
  p_protocol_id   UUID,
  p_artifact_type deliverable_artifact_type
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_deliv protocol_deliverables;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_deliv
    FROM protocol_deliverables
   WHERE protocol_id = p_protocol_id
     AND artifact_type = p_artifact_type;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'deliverable_id',   v_deliv.id,
    'protocol_id',      v_deliv.protocol_id,
    'artifact_type',    v_deliv.artifact_type,
    'title',            v_deliv.title,
    'protocol_version', v_deliv.protocol_version,
    'generated_at',     v_deliv.generated_at,
    'regenerated_at',   v_deliv.regenerated_at,
    'blocks',           _deliv_blocks_json(v_deliv.id)
  );
END;
$$;

COMMENT ON FUNCTION deliverable_get_packet IS
  'Self-contained JSON packet for a deliverable (DeliverablePacket in '
  'src/types/deliverables). SECURITY INVOKER — RLS scopes it. Rejected blocks '
  'are excluded server-side; display_text = COALESCE(current_text, '
  'derived_text, ''''). Returns NULL when no deliverable exists or the caller '
  'cannot see it.';


-- ---------------------------------------------------------------------------
-- 3. deliverable_set_block_review — all non-edit review actions.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_set_block_review(
  p_block_id UUID,
  p_action   TEXT,
  p_note     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user      UUID := auth.uid();
  v_block     protocol_deliverable_blocks;
  v_new_state deliverable_review_state;
  v_note      TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_edit_id   UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_action NOT IN ('mark_reviewed', 'unmark_reviewed', 'flag', 'add_note', 'reject_block') THEN
    RAISE EXCEPTION 'Unknown review action: %', p_action USING ERRCODE = '22023';
  END IF;

  -- RLS is the access gate (invisible row → NOT FOUND). FOR UPDATE so a
  -- concurrent edit/review cannot race the audit snapshot.
  SELECT *
    INTO v_block
    FROM protocol_deliverable_blocks
   WHERE id = p_block_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block not found or access denied' USING ERRCODE = '42501';
  END IF;

  v_new_state := CASE p_action
    WHEN 'mark_reviewed'   THEN 'reviewed'::deliverable_review_state
    -- unmark restores the state the facts imply, not a flat 'draft':
    -- reviewer-authored blocks stay human_added, text-overlaid blocks stay
    -- edited (their badge and export column must keep saying so).
    WHEN 'unmark_reviewed' THEN CASE
      WHEN v_block.content_origin = 'human_editorial' THEN 'human_added'::deliverable_review_state
      WHEN v_block.current_text IS NOT NULL           THEN 'edited'
      ELSE 'draft'
    END
    WHEN 'flag'            THEN 'needs_review'
    WHEN 'add_note'        THEN v_block.review_state  -- state unchanged
    WHEN 'reject_block'    THEN 'rejected'
  END;

  UPDATE protocol_deliverable_blocks
     SET review_state = v_new_state,
         review_note  = CASE WHEN p_action = 'add_note' THEN v_note ELSE review_note END
   WHERE id = p_block_id;

  -- Append-only audit trail. block_version snapshots the version at action
  -- time (review actions never bump it — only edit_text does).
  INSERT INTO deliverable_block_edits (
    block_id, reviewer_id, action, reviewer_note, block_version, protocol_version
  )
  VALUES (
    p_block_id, v_user, p_action, v_note, v_block.version, v_block.protocol_version
  )
  RETURNING id INTO v_edit_id;

  RETURN jsonb_build_object(
    'block_id',     p_block_id,
    'review_state', v_new_state,
    'version',      v_block.version,
    'edit_id',      v_edit_id
  );
END;
$$;

COMMENT ON FUNCTION deliverable_set_block_review IS
  'Review actions on a deliverable block: mark_reviewed → reviewed, '
  'unmark_reviewed → human_added/edited/draft (whichever the block''s origin '
  'and text overlay imply), flag → needs_review, add_note → state unchanged + '
  'review_note set, reject_block → rejected (hidden from packet/export but '
  'remembered so regeneration never resurrects it). Every call appends a '
  'deliverable_block_edits row. SECURITY INVOKER — RLS is the access gate.';


-- ---------------------------------------------------------------------------
-- 4. deliverable_edit_block_text — text overlay + version bump.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_edit_block_text(
  p_block_id UUID,
  p_new_text TEXT,
  p_note     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user        UUID := auth.uid();
  v_block       protocol_deliverable_blocks;
  v_text        TEXT := btrim(COALESCE(p_new_text, ''));
  v_note        TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_prev        TEXT;
  v_new_version INTEGER;
  v_edit_id     UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_text = '' THEN
    RAISE EXCEPTION 'Block text is required' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_block
    FROM protocol_deliverable_blocks
   WHERE id = p_block_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block not found or access denied' USING ERRCODE = '42501';
  END IF;

  -- The user-visible previous text: the human overlay wins over the frozen
  -- parser text when one exists.
  v_prev        := COALESCE(v_block.current_text, v_block.derived_text);
  v_new_version := v_block.version + 1;

  UPDATE protocol_deliverable_blocks
     SET current_text = v_text,
         version      = v_new_version,
         review_state = 'edited'
   WHERE id = p_block_id;

  INSERT INTO deliverable_block_edits (
    block_id, reviewer_id, action, previous_text, new_text, reviewer_note,
    block_version, protocol_version
  )
  VALUES (
    p_block_id, v_user, 'edit_text', v_prev, v_text, v_note,
    v_new_version, v_block.protocol_version
  )
  RETURNING id INTO v_edit_id;

  RETURN jsonb_build_object(
    'block_id',     p_block_id,
    'review_state', 'edited',
    'version',      v_new_version,
    'edit_id',      v_edit_id
  );
END;
$$;

COMMENT ON FUNCTION deliverable_edit_block_text IS
  'Sets the human text overlay on a block (current_text; derived_text stays '
  'frozen), bumps version, review_state → edited, and appends the '
  'previous/new text pair to deliverable_block_edits. SECURITY INVOKER.';


-- ---------------------------------------------------------------------------
-- 5. deliverable_add_block — human editorial content.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_add_block(
  p_deliverable_id UUID,
  p_section_key    TEXT,
  p_text           TEXT,
  p_note           TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user             UUID := auth.uid();
  v_text             TEXT := btrim(COALESCE(p_text, ''));
  v_section          TEXT := btrim(COALESCE(p_section_key, ''));
  v_note             TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_protocol_version TEXT;
  v_sort             INTEGER;
  v_block_id         UUID;
  v_edit_id          UUID;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF v_text = '' THEN
    RAISE EXCEPTION 'Block text is required' USING ERRCODE = '22023';
  END IF;

  IF v_section = '' THEN
    RAISE EXCEPTION 'Section key is required' USING ERRCODE = '22023';
  END IF;

  -- RLS-gated visibility check + lock, so concurrent adds serialize on the
  -- sort_order append.
  SELECT protocol_version
    INTO v_protocol_version
    FROM protocol_deliverables
   WHERE id = p_deliverable_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deliverable not found or access denied' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(MAX(sort_order), -1) + 1
    INTO v_sort
    FROM protocol_deliverable_blocks
   WHERE deliverable_id = p_deliverable_id;

  -- Human editorial: derived_text stays NULL (there is no parser text);
  -- the authored text lives in current_text. Never touched by regeneration.
  INSERT INTO protocol_deliverable_blocks (
    deliverable_id, section_key, block_type, content_origin,
    derived_text, current_text, review_state, protocol_version,
    sort_order, version
  )
  VALUES (
    p_deliverable_id, v_section, 'checklist_item', 'human_editorial',
    NULL, v_text, 'human_added', v_protocol_version,
    v_sort, 1
  )
  RETURNING id INTO v_block_id;

  INSERT INTO deliverable_block_edits (
    block_id, reviewer_id, action, reviewer_note, block_version, protocol_version
  )
  VALUES (
    v_block_id, v_user, 'add_block', v_note, 1, v_protocol_version
  )
  RETURNING id INTO v_edit_id;

  RETURN jsonb_build_object(
    'block_id',     v_block_id,
    'review_state', 'human_added',
    'version',      1,
    'edit_id',      v_edit_id
  );
END;
$$;

COMMENT ON FUNCTION deliverable_add_block IS
  'Appends a human_editorial checklist_item block (review_state human_added, '
  'text in current_text, derived_text NULL) after the deliverable''s last '
  'sort_order, and records an add_block audit row. SECURITY INVOKER.';


-- ---------------------------------------------------------------------------
-- 6. deliverable_delete_block — hard delete, human_editorial only.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_delete_block(
  p_block_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user  UUID := auth.uid();
  v_block protocol_deliverable_blocks;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_block
    FROM protocol_deliverable_blocks
   WHERE id = p_block_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Block not found or access denied' USING ERRCODE = '42501';
  END IF;

  -- Parser-derived blocks are never hard-deleted: their absence must be
  -- remembered so regeneration cannot resurrect them. Reject those instead.
  -- The gate keys on content_origin — IMMUTABLE, unlike review_state, which
  -- review/edit actions overwrite (a reviewer-added block stays deletable
  -- after it has been reviewed or its text edited).
  IF v_block.content_origin <> 'human_editorial' THEN
    RAISE EXCEPTION 'Only reviewer-added blocks can be deleted. Use '
      'deliverable_set_block_review with reject_block for parser-derived blocks.'
      USING ERRCODE = '22023';
  END IF;

  -- Hard delete; deliverable_block_edits rows cascade with the block.
  DELETE FROM protocol_deliverable_blocks WHERE id = p_block_id;

  RETURN jsonb_build_object('block_id', p_block_id);
END;
$$;

COMMENT ON FUNCTION deliverable_delete_block IS
  'Hard-deletes a block, allowed ONLY for content_origin human_editorial (its '
  'audit rows cascade; the origin is immutable so deletability survives review '
  'and edit actions). Parser-derived blocks must be rejected instead so the '
  'rejection is remembered across regeneration. SECURITY INVOKER.';


-- ---------------------------------------------------------------------------
-- 7. deliverable_export_packet — server-stamped, trimmed, sponsor-name-free.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION deliverable_export_packet(
  p_deliverable_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  RECORD;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- protocol_code = study_number (stable across amendments). protocols.sponsor
  -- is DELIBERATELY never selected — exports stay sponsor-name-free per
  -- feedback_no_sponsor_branding.md.
  SELECT d.id,
         d.artifact_type,
         d.title,
         d.protocol_version,
         p.study_number AS protocol_code,
         p.title        AS protocol_title
    INTO v_row
    FROM protocol_deliverables d
    JOIN protocols p ON p.id = d.protocol_id
   WHERE d.id = p_deliverable_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deliverable not found or access denied' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'deliverable_id',   v_row.id,
    'protocol_code',    v_row.protocol_code,
    'protocol_title',   v_row.protocol_title,
    'artifact_type',    v_row.artifact_type,
    'title',            v_row.title,
    'protocol_version', v_row.protocol_version,
    -- Server-stamped at export-fetch time (used for the filename date) — the
    -- clock is authoritative, not the browser.
    'generated_at',     NOW(),
    'blocks',           _deliv_blocks_json(v_row.id)
  );
END;
$$;

COMMENT ON FUNCTION deliverable_export_packet IS
  'Export packet (DeliverableExportPacket in src/types/deliverables): '
  'server-stamped generated_at, rejected blocks excluded, protocol_code from '
  'protocols.study_number. NEVER selects protocols.sponsor — exports are '
  'sponsor-name-free. SECURITY INVOKER.';


-- ---------------------------------------------------------------------------
-- Grants (repo pattern: EXECUTE to authenticated; helpers keep defaults)
-- ---------------------------------------------------------------------------

GRANT EXECUTE ON FUNCTION deliverable_generate(UUID, deliverable_artifact_type) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_get_packet(UUID, deliverable_artifact_type) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_set_block_review(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_edit_block_text(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_add_block(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_delete_block(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION deliverable_export_packet(UUID) TO authenticated;
