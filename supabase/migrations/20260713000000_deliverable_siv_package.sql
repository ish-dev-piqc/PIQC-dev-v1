-- =============================================================================
-- SIV Knowledge Transfer Package — fourth artifact_type (v5 of
-- deliverable_generate) + the speaker_note block type.
--
-- Three parts:
--   1. deliverable_artifact_type gains 'siv_package'.
--   2. protocol_deliverable_blocks.block_type CHECK widens to admit
--      'speaker_note' — teaching prose rendered in the deck's notes band,
--      reviewable like any block. The original inline CHECK is dropped by
--      dynamically-resolved name and re-added under an EXPLICIT stable name
--      so the next widening is a plain DROP/ADD.
--   3. deliverable_generate v5 — the siv_package branch, ported byte-for-byte
--      from src/lib/deliverables/selection/sivPackage.ts (the unit-tested
--      spec). TEACHING register (handover §6.4): what must the site
--      UNDERSTAND before the first patient. Every emitted section closes
--      with EXACTLY ONE speaker_note carrying the structural
--      sponsor-confirmation sentence. Checklist / risk / CRA branches are
--      byte-preserved from 20260711000000.
--
-- ENUM HAZARD: ALTER TYPE ... ADD VALUE inside this transaction is safe
-- because nothing here USES the new value (CREATE FUNCTION stores its body
-- as text; plpgsql parses at first execution). Do not add casts/DML on
-- 'siv_package' to this migration.
--
-- TS mirrors: src/types/deliverables/index.ts (SivSectionKey, speaker_note).
-- Design + decisions: plans/fable/siv-package.md.
-- =============================================================================

ALTER TYPE deliverable_artifact_type ADD VALUE IF NOT EXISTS 'siv_package';


-- ---------------------------------------------------------------------------
-- Widen the block_type CHECK. The 20260708000000 schema declared it inline,
-- so its name is auto-generated — resolve it from pg_constraint rather than
-- guessing, then re-add under the explicit name future widenings can target.
-- ---------------------------------------------------------------------------

DO $do$
DECLARE
  v_name TEXT;
BEGIN
  SELECT conname
    INTO v_name
    FROM pg_constraint
   WHERE conrelid = 'public.protocol_deliverable_blocks'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%block_type%';
  IF v_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.protocol_deliverable_blocks DROP CONSTRAINT %I',
      v_name
    );
  END IF;
END;
$do$;

ALTER TABLE public.protocol_deliverable_blocks
  ADD CONSTRAINT protocol_deliverable_blocks_block_type_check
  CHECK (block_type IN ('checklist_item', 'section_intro', 'site_question', 'speaker_note'));


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
  -- New for the per-type dispatch (v_title) + the risk_overview branch.
  v_title            TEXT;
  v_criteria_total   INTEGER := 0;
  v_flagged_total    INTEGER := 0;
  v_visit_total      INTEGER := 0;
  v_narrow_total     INTEGER := 0;
  v_primary_total    INTEGER := 0;
  v_dep_total        INTEGER := 0;
  v_dense_total      INTEGER := 0;
  v_dep              RECORD;
  v_reason           TEXT;
  -- New for v4: the cra_monitoring_focus branch + the risk-lens Section-1
  -- prohibited-med cards. v_med_total counts prohibited_med facts (used by
  -- both the risk and CRA branches — only one branch runs per call);
  -- v_emphasis assembles the CRA Section-1 intro's joined phrase (the SQL
  -- mirror of the spec's emphasisParts.join(' and ')).
  v_med_total        INTEGER := 0;
  v_emphasis         TEXT;
  -- Port of CONDITIONAL_LANGUAGE in selection/riskOverview.ts AND
  -- selection/craMonitoringFocus.ts (the SAME regex by design — the specs
  -- say KEEP IN SYNC; tune together or the lenses contradict each other).
  -- \y = Postgres word boundary (the spec's \b); matched with ~* below, the
  -- equivalent of the spec's /i flag. The vendor/imaging/specimen keyword
  -- taxonomy is NOT redeclared here — the risk and CRA branches call
  -- _deliv_procedure_category(), the same helper the checklist branch uses
  -- (one shared list, never two).
  c_conditional_language CONSTANT TEXT :=
    '\y(if|unless|except|prior|history of|within)\y';
BEGIN
  -- First line of defense (this function bypasses RLS): the caller must be
  -- able to access the protocol via the single authorization primitive.
  IF v_user IS NULL OR NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RAISE EXCEPTION 'Protocol not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Programmer-error guard: the dispatch below covers exactly these three
  -- types — a future enum extension must not silently receive another
  -- artifact's content.
  IF p_artifact_type NOT IN
     ('monitoring_prep_checklist', 'risk_overview', 'cra_monitoring_focus',
      'siv_package') THEN
    RAISE EXCEPTION 'Unsupported artifact type: %', p_artifact_type
      USING ERRCODE = '22023';
  END IF;

  -- Per-type title (also refreshed on regenerate — an artifact row's title
  -- always reflects its type).
  v_title := CASE p_artifact_type
    WHEN 'monitoring_prep_checklist' THEN 'Monitoring Preparation Checklist'
    WHEN 'risk_overview'             THEN 'Protocol Risk Overview'
    WHEN 'cra_monitoring_focus'      THEN 'CRA Monitoring Focus — Draft Preparation Aid'
    WHEN 'siv_package'               THEN 'SIV Knowledge Transfer Package — Draft'
  END;

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
       SET title            = v_title,
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
      v_title,
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
  -- SPEC-EMISSION DISPATCH — the only per-type stage. All four branches
  -- emit into _deliv_new_specs over the SAME fact pool loaded above ("parse
  -- once, generate many"); everything after the dispatch (fingerprint +
  -- match + apply) is artifact-agnostic. The checklist branch preserves the
  -- 20260710000000 emission stage byte-for-byte; the risk branch preserves
  -- it except Section 1, which settles the prohibited-med debt (med fact
  -- cards + medication-aware intro variants); the cra_monitoring_focus
  -- branch is new — original indentation kept on purpose so versions stay
  -- mechanically diffable.
  -- =========================================================================

  IF p_artifact_type = 'monitoring_prep_checklist' THEN

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

  -- --- 2. exclusion_prohibited_med_review (facts; gap block ONLY when zero
  --     prohibited_med facts — absence of extraction ≠ absence of restrictions,
  --     so the section never goes silent on medications) ---------------------
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

  FOR v_item IN
    SELECT * FROM _deliv_items
     WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL
     ORDER BY ord
  LOOP
    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'exclusion_prohibited_med_review', 'checklist_item', 'protocol_fact',
      'Confirm absence of prohibited medication: ' || v_item.value_text
        || ' — cross-check the '
      'participant''s medication history.',
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  END LOOP;

  -- Zero prohibited_med rows → the coverage-gap fallback. Never silent:
  -- absence of extraction ≠ absence of restrictions, so the CRA is still
  -- told to verify manually.
  IF NOT EXISTS (
    SELECT 1 FROM _deliv_items
     WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL
  ) THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'exclusion_prohibited_med_review', 'checklist_item', 'derived_operational_framing',
      'No prohibited-medication list was extracted from this protocol. Review the '
      'concomitant/prohibited medication section of the protocol manually and '
      'verify medication-history cross-checks at the site.');
    v_sort := v_sort + 1;
  END IF;

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

  ELSIF p_artifact_type = 'risk_overview' THEN

  -- =========================================================================
  -- THE RISK RULESET — port of selectRiskOverviewBlocks() in
  -- src/lib/deliverables/selection/riskOverview.ts (the unit-tested spec —
  -- change rules there first, keep its tests green, then mirror here).
  -- Prose templates are byte-for-byte copies of the TS spec (em dashes and
  -- the U+2212 minus included). Explainable complexity factors ONLY — no
  -- numeric risk scores anywhere (handover doctrine). Thresholds (220 chars,
  -- <= 2-day total window, >= 8 procedures) are v1 heuristics (plan
  -- Decision 6). Section 1 emits when a criterion flags OR a restricted
  -- medication was extracted (prohibited_med facts — the debt named in the
  -- prohibited-meds plan, settled in this v4); sections 2/3/5 emit nothing
  -- when no facts flag; sections 4/6 always say something (explicit fallback
  -- framing instead of silence).
  -- value_text carries the same fact-pool contract as the checklist branch
  -- ("current_text wins"). sort_order (v_sort) is one global 0-based counter.
  -- =========================================================================

  -- --- 1. eligibility_complexity (facts; absent only when nothing is flagged
  --     AND no restricted medication was extracted) --------------------------
  -- A criterion flags for conditional language OR excessive length (> 220
  -- chars, on the trimmed text); when both apply, conditional logic wins as
  -- the named reason (deterministic — mirrors the spec's if / else if).
  -- Restricted medications (prohibited_med facts) always emit — every one is
  -- a medication-history screen the site can miss, so there is no flagging
  -- heuristic to apply. Med cards follow the flagged-criteria cards. Prose is
  -- this lens's own (fragility register) — never the checklist's imperative
  -- "Confirm absence of ..." wording for the same facts.
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE value_text ~* c_conditional_language
                             OR length(value_text) > 220)
    INTO v_criteria_total, v_flagged_total
    FROM _deliv_items
   WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
     AND value_text IS NOT NULL;

  SELECT COUNT(*)
    INTO v_med_total
    FROM _deliv_items
   WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL;

  IF v_flagged_total > 0 OR v_med_total > 0 THEN
    -- Intro variants mirror the spec's three-way branch: both feeds /
    -- flagged-only (byte-identical legacy intro) / medications-only.
    IF v_flagged_total > 0 AND v_med_total > 0 THEN
      INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
      VALUES (v_sort, 'eligibility_complexity', 'section_intro', 'derived_operational_framing',
        'PIQC flagged ' || v_flagged_total || ' of ' || v_criteria_total
        || ' eligibility criteria as complex — conditional logic or lengthy definitions make '
        'screening errors and eligibility deviations more likely. The protocol also restricts '
        || v_med_total || ' '
        || CASE WHEN v_med_total = 1 THEN 'medication' ELSE 'medications' END
        || ' within '
        'eligibility scope, widening the screening surface with medication-history checks. Review '
        'how the site will operationalize each flagged criterion and each restriction.');
    ELSIF v_flagged_total > 0 THEN
      -- No restricted medications extracted — byte-identical legacy intro.
      INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
      VALUES (v_sort, 'eligibility_complexity', 'section_intro', 'derived_operational_framing',
        'PIQC flagged ' || v_flagged_total || ' of ' || v_criteria_total
        || ' eligibility criteria as complex — conditional logic or lengthy definitions make '
        'screening errors and eligibility deviations more likely. Review how the site will '
        'operationalize each flagged criterion.');
    ELSE
      INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
      VALUES (v_sort, 'eligibility_complexity', 'section_intro', 'derived_operational_framing',
        'This protocol restricts ' || v_med_total || ' '
        || CASE WHEN v_med_total = 1 THEN 'medication' ELSE 'medications' END
        || ' within eligibility scope. Each restricted '
        'medication widens the screening surface, and a missed medication-history match surfaces '
        'late as an eligibility deviation. Review how the site will operationalize each restriction.');
    END IF;
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
         AND value_text IS NOT NULL
         AND (value_text ~* c_conditional_language OR length(value_text) > 220)
       ORDER BY ord
    LOOP
      v_reason := CASE
        WHEN v_item.value_text ~* c_conditional_language THEN 'conditional logic'
        ELSE 'lengthy criterion'
      END;

      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_complexity', 'checklist_item', 'protocol_fact',
        'Complex eligibility — ' || v_reason || ': ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_complexity', 'checklist_item', 'protocol_fact',
        'Restricted medication in eligibility scope: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 2. visit_window_pressure (facts; absent when no visit qualifies) -----
  -- Narrow = total window (minus + plus) <= 2 days, including the 0/0
  -- exact-day case, which gets its own harder-edged prose.
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE wminus + wplus <= 2)
    INTO v_visit_total, v_narrow_total
    FROM _deliv_visits;

  IF v_narrow_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'visit_window_pressure', 'section_intro', 'derived_operational_framing',
      'PIQC identified ' || v_narrow_total || ' of ' || v_visit_total
      || ' extracted visits with narrow scheduling tolerance (total window of 2 days or '
      'less). Narrow windows leave little room to reschedule, so each of these visits '
      'carries a standing deviation risk.');
    v_sort := v_sort + 1;

    FOR v_visit IN
      SELECT * FROM _deliv_visits WHERE wminus + wplus <= 2 ORDER BY ord
    LOOP
      v_day_text := CASE
        WHEN v_visit.study_day_txt IS NOT NULL
          THEN 'study day ' || v_visit.study_day_txt
        ELSE 'its scheduled study day'
      END;

      IF v_visit.wminus = 0 AND v_visit.wplus = 0 THEN
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'visit_window_pressure', 'checklist_item', 'protocol_fact',
          'Visit window pressure — ' || v_visit.visit_name || ' (' || v_day_text
          || '): no window — exact day '
          'required. Any scheduling slip immediately becomes a protocol deviation.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      ELSE
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'visit_window_pressure', 'checklist_item', 'protocol_fact',
          'Visit window pressure — ' || v_visit.visit_name || ' (' || v_day_text
          || '): window −' || v_visit.wminus_txt || '/+' || v_visit.wplus_txt
          || ' days. A tolerance this narrow '
          'makes scheduling conflicts likely to end in documented deviations.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      END IF;
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 3. endpoint_critical_procedures (facts; PRIMARY endpoints only) ------
  -- Secondary endpoints are deliberately excluded (plan Decision 3 — the
  -- cognitive-load north star treats them as noise in a risk lens).
  SELECT COUNT(*)
    INTO v_primary_total
    FROM _deliv_items
   WHERE field_type = 'endpoint'
     AND value_text IS NOT NULL
     AND field_path LIKE 'primary\_endpoints%';

  IF v_primary_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'endpoint_critical_procedures', 'section_intro', 'derived_operational_framing',
      'This protocol defines ' || v_primary_total || ' primary '
      || CASE WHEN v_primary_total = 1 THEN 'endpoint' ELSE 'endpoints' END
      || '. Primary-endpoint '
      'data drives the study conclusions, so the procedures feeding it warrant the strongest '
      'source-data verification emphasis. Secondary endpoints are deliberately excluded from this view.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'endpoint'
         AND value_text IS NOT NULL
         AND field_path LIKE 'primary\_endpoints%'
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'endpoint_critical_procedures', 'checklist_item', 'protocol_fact',
        'Primary endpoint — source-data verification emphasis: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 4. vendor_lab_imaging_dependencies (heuristic facts, forced low) -----
  -- Same keyword taxonomy + priority as checklist section 6 via the shared
  -- _deliv_procedure_category() helper. One card per matched visit-procedure
  -- pair; identical procedure strings across visits are deduped — the first
  -- visit wins and is named in the text. Matches are collected first (the
  -- SQL mirror of the spec's dependencyMatches array) because the intro
  -- prose needs the count before the cards are emitted.
  CREATE TEMP TABLE IF NOT EXISTS _deliv_risk_deps (
    seq            INTEGER,
    item_id        UUID,
    evidence_id    UUID,
    quoted_text    TEXT,   -- sensitive — never log
    page_number    INTEGER,
    section_title  TEXT,
    visit_name     TEXT,
    procedure_name TEXT,
    category       TEXT
  ) ON COMMIT DROP;
  DELETE FROM _deliv_risk_deps;

  v_dep_total := 0;
  v_seen := ARRAY[]::TEXT[];
  FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
    FOREACH v_proc IN ARRAY v_visit.procedures LOOP
      v_category := _deliv_procedure_category(v_proc);
      CONTINUE WHEN v_category IS NULL;
      CONTINUE WHEN lower(v_proc) = ANY (v_seen);
      v_seen := v_seen || lower(v_proc);

      v_dep_total := v_dep_total + 1;
      INSERT INTO _deliv_risk_deps (
        seq, item_id, evidence_id, quoted_text, page_number, section_title,
        visit_name, procedure_name, category
      )
      VALUES (
        v_dep_total, v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title, v_visit.visit_name,
        v_proc, v_category
      );
    END LOOP;
  END LOOP;

  IF v_dep_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_lab_imaging_dependencies', 'section_intro', 'derived_operational_framing',
      'PIQC detected ' || v_dep_total || ' procedure '
      || CASE WHEN v_dep_total = 1 THEN 'dependency' ELSE 'dependencies' END
      || ' on external '
      'vendors, laboratories, or imaging workflows (keyword-based detection, so confidence is '
      'marked low). Each dependency adds turnaround time and coordination outside the site''s '
      'direct control.');
    v_sort := v_sort + 1;

    FOR v_dep IN SELECT * FROM _deliv_risk_deps ORDER BY seq LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'vendor_lab_imaging_dependencies', 'checklist_item', 'protocol_fact',
        'External dependency — ''' || v_dep.procedure_name || ''' (' || v_dep.visit_name
        || '): ' || v_dep.category || ' workflow '
        'depends on coordination and turnaround outside the site''s direct control.',
        v_dep.item_id, v_dep.evidence_id, v_dep.quoted_text,
        v_dep.page_number, v_dep.section_title,
        -- heuristic match — confidence is forced low regardless of the visit
        -- item's own state
        'low'
      );
      v_sort := v_sort + 1;
    END LOOP;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_lab_imaging_dependencies', 'checklist_item', 'derived_operational_framing',
      'No laboratory, imaging, or vendor-dependent procedures were detected in the extracted '
      'visit schedule. Review the protocol''s laboratory manual, imaging charter, and vendor '
      'plans to confirm whether external dependencies exist.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 5. coordination_burden (facts; absent when no visit is dense) --------
  -- Dense = 8 or more extracted procedures in one visit.
  SELECT COUNT(*)
    INTO v_dense_total
    FROM _deliv_visits
   WHERE cardinality(procedures) >= 8;

  IF v_dense_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'coordination_burden', 'section_intro', 'derived_operational_framing',
      'PIQC flagged ' || v_dense_total || ' '
      || CASE WHEN v_dense_total = 1 THEN 'visit' ELSE 'visits' END
      || ' with a '
      'dense procedure load (8 or more procedures). Dense visits '
      'concentrate multiple roles and handoffs into a single day, raising the chance of missed '
      'or out-of-sequence assessments.');
    v_sort := v_sort + 1;

    FOR v_visit IN
      SELECT * FROM _deliv_visits WHERE cardinality(procedures) >= 8 ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'coordination_burden', 'checklist_item', 'protocol_fact',
        'Dense visit — ' || v_visit.visit_name || ': ' || cardinality(v_visit.procedures)
        || ' procedures scheduled; '
        'multi-role coordination pressure.',
        v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title,
        COALESCE(v_visit.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 6. amendment_sensitivity (fact when an amendment was extracted) ------
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
    VALUES (v_sort, 'amendment_sensitivity', 'section_intro', 'derived_operational_framing',
      'This protocol has amendment activity. Amended requirements are a common source of version '
      'confusion at sites — the areas the amendment touches deserve elevated monitoring emphasis.');
    v_sort := v_sort + 1;

    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'amendment_sensitivity', 'checklist_item', 'protocol_fact',
      'Amendment in force: ' || v_item.value_text
      || ' — affected requirements deserve monitoring emphasis.',
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'amendment_sensitivity', 'checklist_item', 'derived_operational_framing',
      'No amendment was detected in this protocol version. Confirm with the sponsor that the '
      'site holds and operates from the current protocol version.');
    v_sort := v_sort + 1;
  END IF;

  ELSIF p_artifact_type = 'cra_monitoring_focus' THEN

  -- =========================================================================
  -- THE CRA FOCUS RULESET — port of selectCraMonitoringFocusBlocks() in
  -- src/lib/deliverables/selection/craMonitoringFocus.ts (the unit-tested
  -- spec — change rules there first, keep its tests green, then mirror here).
  -- Prose templates are byte-for-byte copies of the TS spec (em dashes and
  -- the U+2212 minus included). ATTENTION ALLOCATION register (handover
  -- §6.1-D): where should a monitor's limited on-site time go FIRST — card
  -- prose never duplicates the checklist's imperative templates or the risk
  -- lens's fragility templates for the same facts. NO numeric risk scores
  -- anywhere. Protocol-only: no site or participant context in any prose.
  -- The complexity/window thresholds (220 chars, <= 2-day total window) and
  -- c_conditional_language are the SAME heuristics as the risk lens (KEEP IN
  -- SYNC — tune together or the lenses contradict each other); the
  -- vendor/imaging/specimen taxonomy comes from the shared
  -- _deliv_procedure_category() helper (one list, never two). Sections 1/2/3
  -- emit nothing when no facts qualify; sections 4/5 always say something
  -- (explicit fallback framing instead of silence). value_text carries the
  -- same fact-pool contract as the other branches ("current_text wins").
  -- sort_order (v_sort) is one global 0-based counter.
  -- =========================================================================

  -- --- 1. eligibility_verification_emphasis (facts; absent when nothing
  --     qualifies) -----------------------------------------------------------
  -- Two feeds: (a) complex criteria — flagged for conditional language OR
  -- excessive length (> 220 chars, on the trimmed text); when both apply,
  -- conditional logic wins as the named reason (deterministic, same priority
  -- as the risk lens); (b) EVERY prohibited_med fact — restricted medications
  -- are where medication-history review time pays off first.
  SELECT COUNT(*)
    INTO v_flagged_total
    FROM _deliv_items
   WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
     AND value_text IS NOT NULL
     AND (value_text ~* c_conditional_language OR length(value_text) > 220);

  SELECT COUNT(*)
    INTO v_med_total
    FROM _deliv_items
   WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL;

  IF v_flagged_total > 0 OR v_med_total > 0 THEN
    -- The SQL mirror of the spec's emphasisParts.join(' and ').
    v_emphasis := NULL;
    IF v_flagged_total > 0 THEN
      v_emphasis := v_flagged_total || ' complex eligibility '
        || CASE WHEN v_flagged_total = 1 THEN 'criterion' ELSE 'criteria' END;
    END IF;
    IF v_med_total > 0 THEN
      v_emphasis := COALESCE(v_emphasis || ' and ', '')
        || v_med_total || ' protocol-restricted '
        || CASE WHEN v_med_total = 1 THEN 'medication' ELSE 'medications' END;
    END IF;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'eligibility_verification_emphasis', 'section_intro', 'derived_operational_framing',
      'PIQC identified ' || v_emphasis || ' that warrant focused on-site attention. '
      'Prioritize verification of these before routine eligibility review — they are where '
      'screening errors concentrate.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
         AND value_text IS NOT NULL
         AND (value_text ~* c_conditional_language OR length(value_text) > 220)
       ORDER BY ord
    LOOP
      v_reason := CASE
        WHEN v_item.value_text ~* c_conditional_language THEN 'conditional logic'
        ELSE 'lengthy criterion'
      END;

      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_verification_emphasis', 'checklist_item', 'protocol_fact',
        'Prioritize eligibility verification — ' || v_reason || ': ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_verification_emphasis', 'checklist_item', 'protocol_fact',
        'Prioritize medication-history review: ' || v_item.value_text
          || ' is restricted by the protocol.',
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 2. fragile_visit_windows (facts; absent when no visit qualifies) -----
  -- Fragile = total window (minus + plus) <= 2 days, including the 0/0
  -- exact-day case, which gets its own harder-edged prose.
  SELECT COUNT(*)
    INTO v_narrow_total
    FROM _deliv_visits
   WHERE wminus + wplus <= 2;

  IF v_narrow_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'fragile_visit_windows', 'section_intro', 'derived_operational_framing',
      'PIQC identified ' || v_narrow_total || ' '
      || CASE WHEN v_narrow_total = 1 THEN 'visit' ELSE 'visits' END
      || ' with a fragile scheduling window (total tolerance of 2 days or '
      'less). Plan on-site time to verify the actual visit dates for each against source '
      'scheduling records.');
    v_sort := v_sort + 1;

    FOR v_visit IN
      SELECT * FROM _deliv_visits WHERE wminus + wplus <= 2 ORDER BY ord
    LOOP
      v_day_text := CASE
        WHEN v_visit.study_day_txt IS NOT NULL
          THEN 'study day ' || v_visit.study_day_txt
        ELSE 'its scheduled study day'
      END;

      IF v_visit.wminus = 0 AND v_visit.wplus = 0 THEN
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'fragile_visit_windows', 'checklist_item', 'protocol_fact',
          'Plan on-site window verification — ' || v_visit.visit_name || ' (' || v_day_text
          || '): the protocol '
          'allows no scheduling window — confirm the exact visit date against source records.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      ELSE
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'fragile_visit_windows', 'checklist_item', 'protocol_fact',
          'Plan on-site window verification — ' || v_visit.visit_name || ' (' || v_day_text
          || '): window −' || v_visit.wminus_txt || '/+' || v_visit.wplus_txt
          || ' days — confirm each occurrence '
          'fell inside this tolerance.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      END IF;
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 3. endpoint_critical_verification (facts; PRIMARY endpoints only) ----
  -- Secondary endpoints are deliberately excluded — in an attention-allocation
  -- lens they are noise (same call as the risk lens; cognitive-load north
  -- star).
  SELECT COUNT(*)
    INTO v_primary_total
    FROM _deliv_items
   WHERE field_type = 'endpoint'
     AND value_text IS NOT NULL
     AND field_path LIKE 'primary\_endpoints%';

  IF v_primary_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'endpoint_critical_verification', 'section_intro', 'derived_operational_framing',
      'Allocate the strongest share of source-data verification time to primary-endpoint data — '
      'it carries the study conclusions. This protocol defines ' || v_primary_total || ' primary '
      || CASE WHEN v_primary_total = 1 THEN 'endpoint' ELSE 'endpoints' END
      || '; secondary endpoints are deliberately excluded '
      'from this focus view.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'endpoint'
         AND value_text IS NOT NULL
         AND field_path LIKE 'primary\_endpoints%'
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'endpoint_critical_verification', 'checklist_item', 'protocol_fact',
        'Prioritize source-data verification for the primary endpoint: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;
  END IF;

  -- --- 4. vendor_specimen_workflows (heuristic facts, forced low; always
  --     says something) ------------------------------------------------------
  -- Same keyword taxonomy + priority as checklist section 6 via the shared
  -- _deliv_procedure_category() helper. One card per matched visit-procedure
  -- pair; identical procedure strings across visits are deduped — the first
  -- visit wins and is named in the text. Matches are collected first (the
  -- SQL mirror of the spec's workflowMatches array) because the intro prose
  -- needs the count before the cards are emitted.
  CREATE TEMP TABLE IF NOT EXISTS _deliv_cra_workflows (
    seq            INTEGER,
    item_id        UUID,
    evidence_id    UUID,
    quoted_text    TEXT,   -- sensitive — never log
    page_number    INTEGER,
    section_title  TEXT,
    visit_name     TEXT,
    procedure_name TEXT,
    category       TEXT
  ) ON COMMIT DROP;
  DELETE FROM _deliv_cra_workflows;

  v_dep_total := 0;
  v_seen := ARRAY[]::TEXT[];
  FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
    FOREACH v_proc IN ARRAY v_visit.procedures LOOP
      v_category := _deliv_procedure_category(v_proc);
      CONTINUE WHEN v_category IS NULL;
      CONTINUE WHEN lower(v_proc) = ANY (v_seen);
      v_seen := v_seen || lower(v_proc);

      v_dep_total := v_dep_total + 1;
      INSERT INTO _deliv_cra_workflows (
        seq, item_id, evidence_id, quoted_text, page_number, section_title,
        visit_name, procedure_name, category
      )
      VALUES (
        v_dep_total, v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title, v_visit.visit_name,
        v_proc, v_category
      );
    END LOOP;
  END LOOP;

  IF v_dep_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_specimen_workflows', 'section_intro', 'derived_operational_framing',
      'PIQC detected ' || v_dep_total || ' external-workflow '
      || CASE WHEN v_dep_total = 1 THEN 'dependency' ELSE 'dependencies' END
      || ' across '
      'the extracted visits (keyword-based detection, so confidence is marked low). Plan '
      'on-site time to confirm each directly — turnaround and coordination sit outside the '
      'site''s control.');
    v_sort := v_sort + 1;

    FOR v_dep IN SELECT * FROM _deliv_cra_workflows ORDER BY seq LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'vendor_specimen_workflows', 'checklist_item', 'protocol_fact',
        'Confirm on-site: ''' || v_dep.procedure_name || ''' (' || v_dep.visit_name
        || ') — ' || v_dep.category || ' workflow warrants '
        'direct verification.',
        v_dep.item_id, v_dep.evidence_id, v_dep.quoted_text,
        v_dep.page_number, v_dep.section_title,
        -- heuristic match — confidence is forced low regardless of the visit
        -- item's own state
        'low'
      );
      v_sort := v_sort + 1;
    END LOOP;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_specimen_workflows', 'checklist_item', 'derived_operational_framing',
      'PIQC detected no laboratory, imaging, or vendor-dependent procedures in the extracted '
      'visit schedule. Before the visit, check the protocol''s laboratory manual, imaging '
      'charter, and vendor plans to decide whether any external workflow still needs direct '
      'on-site verification.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 5. amendment_sensitive_requirements (always says something) ----------
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
    VALUES (v_sort, 'amendment_sensitive_requirements', 'section_intro', 'derived_operational_framing',
      'This protocol has amendment activity. Version confusion concentrates deviations exactly '
      'where requirements changed — allocate review time to the amendment-affected areas first.');
    v_sort := v_sort + 1;

    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'amendment_sensitive_requirements', 'checklist_item', 'protocol_fact',
      'Amendment-affected: ' || v_item.value_text
      || ' — re-verify impacted requirements against '
      'the current version.',
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'amendment_sensitive_requirements', 'checklist_item', 'derived_operational_framing',
      'PIQC detected no amendment in this protocol version. Confirm on-site that the site '
      'operates from the sponsor''s current version before allocating further review time.');
    v_sort := v_sort + 1;
  END IF;


  ELSIF p_artifact_type = 'siv_package' THEN

  -- =========================================================================
  -- THE SIV RULESET — port of selectSivPackageBlocks() in
  -- src/lib/deliverables/selection/sivPackage.ts (the unit-tested spec —
  -- change rules there first, keep its tests green, then mirror here).
  -- TEACHING register (handover §6.4): what must the site UNDERSTAND before
  -- the first patient. Prose never duplicates the other lenses' templates.
  -- Every emitted section closes with EXACTLY ONE speaker_note
  -- (derived_operational_framing, NULL evidence/confidence) whose text ends
  -- with the structural sponsor-confirmation sentence. Sections
  -- study_overview / vendor_lab_workflows / safety_expectations /
  -- amendment_changes / before_first_patient ALWAYS emit; the other four
  -- emit nothing when no facts qualify. Same thresholds and shared
  -- _deliv_procedure_category() taxonomy as the sibling lenses (KEEP IN
  -- SYNC). sort_order (v_sort) is one global 0-based counter.
  -- =========================================================================

  -- --- 1. study_overview (ALWAYS emits) --------------------------------------
  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'study_overview', 'section_intro', 'derived_operational_framing',
    'Ground the site team in what the study is before any procedure is taught. '
    'The bullets below are extracted from the protocol''s own words — present them as written.');
  v_sort := v_sort + 1;

  SELECT * INTO v_item FROM _deliv_items
   WHERE field_type = 'metadata' AND field_path = 'study_design' AND value_text IS NOT NULL
   ORDER BY ord LIMIT 1;
  IF FOUND THEN
    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'study_overview', 'checklist_item', 'protocol_fact',
      'The protocol states — Study design: ' || v_item.value_text,
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  END IF;

  SELECT * INTO v_item FROM _deliv_items
   WHERE field_type = 'metadata' AND field_path = 'study_phase' AND value_text IS NOT NULL
   ORDER BY ord LIMIT 1;
  IF FOUND THEN
    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'study_overview', 'checklist_item', 'protocol_fact',
      'The protocol states — Study phase: ' || v_item.value_text,
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  END IF;

  SELECT * INTO v_item FROM _deliv_items
   WHERE field_type = 'dosing' AND value_text IS NOT NULL
   ORDER BY ord LIMIT 1;
  IF FOUND THEN
    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'study_overview', 'checklist_item', 'protocol_fact',
      'The protocol states — Dosing regimen: ' || v_item.value_text,
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  END IF;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'study_overview', 'speaker_note', 'derived_operational_framing',
    'Teaching point: Anchor every later slide back to the study''s design so procedures have '
    'context. Likely site question: How does this design differ from studies the site has run '
    'before? Confirm specifics with the sponsor before presenting.');
  v_sort := v_sort + 1;

  -- --- 2. participant_journey (absent when zero usable visits) ---------------
  SELECT COUNT(*) INTO v_visit_total FROM _deliv_visits;
  IF v_visit_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'participant_journey', 'section_intro', 'derived_operational_framing',
      'Walk the room through the full participant journey, visit by visit — the schedule '
      'below is extracted from the protocol''s schedule of assessments.');
    v_sort := v_sort + 1;

    FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
      v_day_text := CASE
        WHEN v_visit.study_day_txt IS NOT NULL THEN 'study day ' || v_visit.study_day_txt
        ELSE 'study day per protocol'
      END;
      IF v_visit.wminus = 0 AND v_visit.wplus = 0 THEN
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'participant_journey', 'checklist_item', 'protocol_fact',
          v_visit.visit_name || ' — ' || v_day_text || ', exact day (no window).',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      ELSE
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'participant_journey', 'checklist_item', 'protocol_fact',
          v_visit.visit_name || ' — ' || v_day_text || ', window −' || v_visit.wminus_txt
            || '/+' || v_visit.wplus_txt || ' days.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      END IF;
      v_sort := v_sort + 1;
    END LOOP;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'participant_journey', 'speaker_note', 'derived_operational_framing',
      'Teaching point: Coordinators retain the journey better as a story than a table — '
      'narrate one participant start to finish. Likely site question: Which visits can be '
      'scheduled flexibly and which cannot? Confirm specifics with the sponsor before presenting.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 3. eligibility_emphasis (absent when nothing qualifies) ---------------
  SELECT COUNT(*)
    INTO v_flagged_total
    FROM _deliv_items
   WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
     AND value_text IS NOT NULL
     AND (value_text ~* c_conditional_language OR length(value_text) > 220);

  SELECT COUNT(*)
    INTO v_med_total
    FROM _deliv_items
   WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL;

  IF v_flagged_total > 0 OR v_med_total > 0 THEN
    v_emphasis := NULL;
    IF v_flagged_total > 0 THEN
      v_emphasis := v_flagged_total || ' eligibility '
        || CASE WHEN v_flagged_total = 1 THEN 'criterion' ELSE 'criteria' END
        || ' that '
        || CASE WHEN v_flagged_total = 1 THEN 'needs' ELSE 'need' END
        || ' unhurried explanation';
    END IF;
    IF v_med_total > 0 THEN
      v_emphasis := COALESCE(v_emphasis || ' and ', '')
        || v_med_total || ' medication '
        || CASE WHEN v_med_total = 1 THEN 'restriction' ELSE 'restrictions' END
        || ' the site must teach into its screening routine';
    END IF;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'eligibility_emphasis', 'section_intro', 'derived_operational_framing',
      'This protocol carries ' || v_emphasis || '. Spend SIV time here — eligibility '
      'misunderstandings set at start-up persist through enrollment.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type IN ('inclusion_criterion', 'exclusion_criterion')
         AND value_text IS NOT NULL
         AND (value_text ~* c_conditional_language OR length(value_text) > 220)
       ORDER BY ord
    LOOP
      v_reason := CASE
        WHEN v_item.value_text ~* c_conditional_language THEN 'conditional logic'
        ELSE 'lengthy criterion'
      END;
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_emphasis', 'checklist_item', 'protocol_fact',
        'Emphasize at SIV — ' || v_reason || ': ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'prohibited_med' AND value_text IS NOT NULL
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'eligibility_emphasis', 'checklist_item', 'protocol_fact',
        'Medication restriction to teach: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'eligibility_emphasis', 'speaker_note', 'derived_operational_framing',
      'Teaching point: Work an example for each flagged criterion rather than reading it '
      'aloud. Likely site question: Who adjudicates a borderline eligibility call, and how '
      'fast? Confirm specifics with the sponsor before presenting.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 4. endpoint_critical (PRIMARY endpoints only; absent when none) -------
  SELECT COUNT(*)
    INTO v_primary_total
    FROM _deliv_items
   WHERE field_type = 'endpoint'
     AND value_text IS NOT NULL
     AND field_path LIKE 'primary\_endpoints%';

  IF v_primary_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'endpoint_critical', 'section_intro', 'derived_operational_framing',
      'The study''s conclusions rest on ' || v_primary_total || ' primary '
      || CASE WHEN v_primary_total = 1 THEN 'endpoint' ELSE 'endpoints' END
      || '. '
      'Teach the procedures behind each one as consequential, not routine.');
    v_sort := v_sort + 1;

    FOR v_item IN
      SELECT * FROM _deliv_items
       WHERE field_type = 'endpoint'
         AND value_text IS NOT NULL
         AND field_path LIKE 'primary\_endpoints%'
       ORDER BY ord
    LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'endpoint_critical', 'checklist_item', 'protocol_fact',
        'First-patient quality depends on: ' || v_item.value_text,
        v_item.item_id, v_item.evidence_id, v_item.quoted_text,
        v_item.page_number, v_item.section_title,
        COALESCE(v_item.confidence_state, 'needs_review')
      );
      v_sort := v_sort + 1;
    END LOOP;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'endpoint_critical', 'speaker_note', 'derived_operational_framing',
      'Teaching point: Tie each primary-endpoint procedure to the data it produces so its '
      'handling feels consequential. Likely site question: What happens operationally when an '
      'endpoint assessment is missed? Confirm specifics with the sponsor before presenting.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 5. windows_and_timing (absent when no narrow-window visits) -----------
  SELECT COUNT(*) INTO v_narrow_total FROM _deliv_visits WHERE wminus + wplus <= 2;
  IF v_narrow_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'windows_and_timing', 'section_intro', 'derived_operational_framing',
      v_narrow_total || ' '
      || CASE WHEN v_narrow_total = 1 THEN 'visit allows' ELSE 'visits allow' END
      || ' 2 days or less of scheduling tolerance. Rehearse the scheduling '
      'of each at the SIV — timing habits are set on day one.');
    v_sort := v_sort + 1;

    FOR v_visit IN
      SELECT * FROM _deliv_visits WHERE wminus + wplus <= 2 ORDER BY ord
    LOOP
      v_day_text := CASE
        WHEN v_visit.study_day_txt IS NOT NULL THEN 'study day ' || v_visit.study_day_txt
        ELSE 'study day per protocol'
      END;
      IF v_visit.wminus = 0 AND v_visit.wplus = 0 THEN
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'windows_and_timing', 'checklist_item', 'protocol_fact',
          'Timing to rehearse — ' || v_visit.visit_name || ' (' || v_day_text
            || '): exact day — no scheduling window.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      ELSE
        INSERT INTO _deliv_new_specs (
          ord, section_key, block_type, content_origin, derived_text,
          extracted_item_id, source_evidence_id, source_quote,
          source_page_number, source_section, confidence_state
        )
        VALUES (
          v_sort, 'windows_and_timing', 'checklist_item', 'protocol_fact',
          'Timing to rehearse — ' || v_visit.visit_name || ' (' || v_day_text
            || '): window −' || v_visit.wminus_txt || '/+' || v_visit.wplus_txt || ' days.',
          v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
          v_visit.page_number, v_visit.section_title,
          COALESCE(v_visit.confidence_state, 'needs_review')
        );
      END IF;
      v_sort := v_sort + 1;
    END LOOP;

    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'windows_and_timing', 'speaker_note', 'derived_operational_framing',
      'Teaching point: Have the coordinator walk a calendar for the tightest visit rather '
      'than presenting the tolerance abstractly. Likely site question: What is the escalation '
      'path when a visit is about to fall out of window? Confirm specifics with the sponsor '
      'before presenting.');
    v_sort := v_sort + 1;
  END IF;

  -- --- 6. vendor_lab_workflows (ALWAYS says something; heuristic, forced low) -
  CREATE TEMP TABLE IF NOT EXISTS _deliv_siv_workflows (
    seq            INTEGER,
    item_id        UUID,
    evidence_id    UUID,
    quoted_text    TEXT,   -- sensitive — never log
    page_number    INTEGER,
    section_title  TEXT,
    visit_name     TEXT,
    procedure_name TEXT,
    category       TEXT
  ) ON COMMIT DROP;
  DELETE FROM _deliv_siv_workflows;

  v_dep_total := 0;
  v_seen := ARRAY[]::TEXT[];
  FOR v_visit IN SELECT * FROM _deliv_visits ORDER BY ord LOOP
    FOREACH v_proc IN ARRAY v_visit.procedures LOOP
      v_category := _deliv_procedure_category(v_proc);
      CONTINUE WHEN v_category IS NULL;
      CONTINUE WHEN lower(v_proc) = ANY (v_seen);
      v_seen := v_seen || lower(v_proc);
      v_dep_total := v_dep_total + 1;
      INSERT INTO _deliv_siv_workflows (
        seq, item_id, evidence_id, quoted_text, page_number, section_title,
        visit_name, procedure_name, category
      )
      VALUES (
        v_dep_total, v_visit.item_id, v_visit.evidence_id, v_visit.quoted_text,
        v_visit.page_number, v_visit.section_title, v_visit.visit_name,
        v_proc, v_category
      );
    END LOOP;
  END LOOP;

  IF v_dep_total > 0 THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_lab_workflows', 'section_intro', 'derived_operational_framing',
      v_dep_total || ' external-workflow '
      || CASE WHEN v_dep_total = 1 THEN 'dependency was' ELSE 'dependencies were' END
      || ' detected in '
      'the extracted visits (keyword-based, so confidence is marked low). Each is a hands-on '
      'walkthrough at the SIV, not a slide to read.');
    v_sort := v_sort + 1;

    FOR v_dep IN SELECT * FROM _deliv_siv_workflows ORDER BY seq LOOP
      INSERT INTO _deliv_new_specs (
        ord, section_key, block_type, content_origin, derived_text,
        extracted_item_id, source_evidence_id, source_quote,
        source_page_number, source_section, confidence_state
      )
      VALUES (
        v_sort, 'vendor_lab_workflows', 'checklist_item', 'protocol_fact',
        'Walk through at SIV: ''' || v_dep.procedure_name || ''' (' || v_dep.visit_name
          || ') — ' || v_dep.category || ' workflow.',
        v_dep.item_id, v_dep.evidence_id, v_dep.quoted_text,
        v_dep.page_number, v_dep.section_title,
        -- heuristic match — confidence is forced low regardless of the visit
        -- item's own state
        'low'
      );
      v_sort := v_sort + 1;
    END LOOP;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'vendor_lab_workflows', 'checklist_item', 'derived_operational_framing',
      'No laboratory, imaging, or vendor-dependent procedures were detected in the extracted '
      'visit schedule. Check the protocol''s laboratory manual, imaging charter, and vendor '
      'plans for workflows the SIV should still cover hands-on.');
    v_sort := v_sort + 1;
  END IF;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'vendor_lab_workflows', 'speaker_note', 'derived_operational_framing',
    'Teaching point: Physically trace one specimen or transmission end to end with the people '
    'who will do it. Likely site question: What are the kit expiry and re-supply arrangements? '
    'Confirm specifics with the sponsor before presenting.');
  v_sort := v_sort + 1;

  -- --- 7. safety_expectations (framing-only; ALWAYS) --------------------------
  -- No structured safety extraction exists yet — the honest teaching move is
  -- to direct the room to the protocol's own safety sections, never to invent
  -- reporting expectations.
  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'safety_expectations', 'section_intro', 'derived_operational_framing',
    'Safety and reporting expectations come from the protocol''s safety sections and must be '
    'walked through in their own words at the SIV — reporting definitions, timelines, and '
    'responsibilities are protocol-specific and are not paraphrased here.');
  v_sort := v_sort + 1;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'safety_expectations', 'speaker_note', 'derived_operational_framing',
    'Teaching point: Read the reporting timelines directly from the protocol with the team — '
    'paraphrase is where safety training goes wrong. Likely site question: Which events does '
    'the sponsor want reported even when in doubt? Confirm specifics with the sponsor before '
    'presenting.');
  v_sort := v_sort + 1;

  -- --- 8. amendment_changes (ALWAYS says something) ---------------------------
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
    VALUES (v_sort, 'amendment_changes', 'section_intro', 'derived_operational_framing',
      'This protocol carries amendment activity — the SIV must teach the CURRENT version, and '
      'name what changed so nobody trains on stale requirements.');
    v_sort := v_sort + 1;

    INSERT INTO _deliv_new_specs (
      ord, section_key, block_type, content_origin, derived_text,
      extracted_item_id, source_evidence_id, source_quote,
      source_page_number, source_section, confidence_state
    )
    VALUES (
      v_sort, 'amendment_changes', 'checklist_item', 'protocol_fact',
      'Amendment to present: ' || v_item.value_text
        || ' — walk through every affected requirement.',
      v_item.item_id, v_item.evidence_id, v_item.quoted_text,
      v_item.page_number, v_item.section_title,
      COALESCE(v_item.confidence_state, 'needs_review')
    );
    v_sort := v_sort + 1;
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'amendment_changes', 'checklist_item', 'derived_operational_framing',
      'No amendment was detected in this protocol version. State at the SIV which version is '
      'being trained and confirm it matches what the sponsor holds current.');
    v_sort := v_sort + 1;
  END IF;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'amendment_changes', 'speaker_note', 'derived_operational_framing',
    'Teaching point: Version confusion concentrates deviations — say the version number out '
    'loud and put it on the slide. Likely site question: How will the site be notified of the '
    'next amendment? Confirm specifics with the sponsor before presenting.');
  v_sort := v_sort + 1;

  -- --- 9. before_first_patient (framing close; ALWAYS) ------------------------
  -- v_emphasis is reused as the close-parts accumulator (its Section-3 value
  -- is no longer needed at this point).
  v_emphasis := NULL;
  IF v_flagged_total > 0 THEN
    v_emphasis := v_flagged_total || ' eligibility '
      || CASE WHEN v_flagged_total = 1 THEN 'emphasis' ELSE 'emphases' END;
  END IF;
  IF v_med_total > 0 THEN
    v_emphasis := COALESCE(v_emphasis || ', ', '')
      || v_med_total || ' medication '
      || CASE WHEN v_med_total = 1 THEN 'restriction' ELSE 'restrictions' END;
  END IF;
  IF v_primary_total > 0 THEN
    v_emphasis := COALESCE(v_emphasis || ', ', '')
      || v_primary_total || ' endpoint-critical '
      || CASE WHEN v_primary_total = 1 THEN 'procedure' ELSE 'procedures' END;
  END IF;
  IF v_narrow_total > 0 THEN
    v_emphasis := COALESCE(v_emphasis || ', ', '')
      || v_narrow_total || ' timing '
      || CASE WHEN v_narrow_total = 1 THEN 'rehearsal' ELSE 'rehearsals' END;
  END IF;

  IF v_emphasis IS NOT NULL THEN
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'before_first_patient', 'section_intro', 'derived_operational_framing',
      'Before the first patient, the site must own: ' || v_emphasis || ' — every block '
      'above is evidence-linked where the protocol supports it, and every block requires '
      'human review before this outline is presented.');
  ELSE
    INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
    VALUES (v_sort, 'before_first_patient', 'section_intro', 'derived_operational_framing',
      'Before the first patient, review every block above with the site — each requires '
      'human review before this outline is presented.');
  END IF;
  v_sort := v_sort + 1;

  INSERT INTO _deliv_new_specs (ord, section_key, block_type, content_origin, derived_text)
  VALUES (v_sort, 'before_first_patient', 'speaker_note', 'derived_operational_framing',
    'Teaching point: Close by assigning each open item above to a named owner at the site. '
    'Likely site question: What does the site still need from the sponsor before first '
    'screening? Confirm specifics with the sponsor before presenting.');
  v_sort := v_sort + 1;

  END IF;

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
  'Generates/regenerates a protocol deliverable. Four artifact types share '
  'one fact pool + fingerprint/match/apply machinery: monitoring_prep_checklist '
  '(imperative verification cards), risk_overview (explainable fragility '
  'factors), cra_monitoring_focus (attention allocation), siv_package '
  '(teaching outline — every section closes with one speaker_note carrying a '
  'sponsor-confirmation warning). Per-type titles; regenerate preserves human '
  'work (human_editorial and current_text blocks survive; rejected blocks are '
  'never resurrected). SECURITY DEFINER gated by user_can_access_protocol. '
  'TS specs: src/lib/deliverables/selection/*.ts (byte-parity by test).';

GRANT EXECUTE ON FUNCTION deliverable_generate(UUID, deliverable_artifact_type) TO authenticated;
