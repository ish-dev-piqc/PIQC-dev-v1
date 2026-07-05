-- =============================================================================
-- Fix: visit_execution_persist_parsed_workspace zeroed the WHOLE batch on
-- re-ingest → Visit Prep showed visits with no per-visit detail (0
-- visit_requirements) for some protocols (e.g. POLAR-M: 23 visits, 0 rows),
-- while stable protocols (BLKR201) were fine.
--
-- Root cause: visit_requirements has UNIQUE (visit_template_id, ordinal), but
-- the RPC identifies rows by FINGERPRINT (not ordinal), assigns `ordinal` by
-- payload index, and does NOT delete orphan rows before inserting — all in one
-- transaction with no per-row isolation. On re-ingest a churny SoA re-parse
-- changes a visit's procedures → a new-fingerprint INSERT lands on an `ordinal`
-- still held by an un-deleted orphan → unique violation → the whole payload
-- rolls back → 0 rows. The calling edge function swallowed the error (blank tab,
-- no signal). First ingests never collide (distinct ordinals, no orphans).
--
-- Two-part fix (both append-only here):
--   1. DROP the ordinal unique. `ordinal` is DISPLAY ORDER, not identity — the
--      real identity is the fingerprint. Ties sort fine (the read RPC orders by
--      phase then ordinal; equal ordinals just order arbitrarily among ties).
--   2. Wrap each visit in a BEGIN … EXCEPTION savepoint so one bad visit can't
--      zero the other 22; count `visits_failed` and return it. Counters are
--      restored on a failed visit because PL/pgSQL variable assignments are NOT
--      rolled back by the savepoint (only DB writes are).
--
-- Orphan-row deletion stays deferred per the original §7.1 (destroying a
-- human-reviewed row on amendment is destructive) — out of scope here.
-- The helper functions (_vew_normalize_derived_text, _vew_fingerprint) are
-- unchanged and not re-created.
-- =============================================================================

ALTER TABLE visit_requirements
  DROP CONSTRAINT IF EXISTS visit_requirements_visit_template_id_ordinal_key;

COMMENT ON COLUMN visit_requirements.ordinal IS
  'Display order within a visit (phase then ordinal). NOT an identity — the '
  'persist RPC identifies rows by fingerprint(visit_template_id, derived_text). '
  'No uniqueness constraint: re-ingest may transiently produce equal ordinals '
  'and that must not abort the persist transaction.';


CREATE OR REPLACE FUNCTION visit_execution_persist_parsed_workspace(
  p_protocol_id UUID,
  p_visits JSONB
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit              JSONB;
  v_visit_template_id  UUID;
  v_purpose            TEXT;
  v_confidence_state   TEXT;
  v_proc               JSONB;
  v_proc_fingerprint   TEXT;
  v_proc_derived_text  TEXT;
  v_existing_req_id    UUID;
  v_existing_curtext   TEXT;
  v_existing_derived   TEXT;
  v_existing_version   INTEGER;
  v_new_req_id         UUID;
  v_signal             JSONB;
  v_visits_written     INTEGER := 0;
  v_reqs_written       INTEGER := 0;
  v_signals_written    INTEGER := 0;
  v_drift_events       INTEGER := 0;
  v_visits_failed      INTEGER := 0;
  -- Per-visit counter snapshots — restored if the visit's savepoint rolls back,
  -- since variable assignments (unlike DB writes) survive the EXCEPTION.
  v_w0 INTEGER; v_r0 INTEGER; v_s0 INTEGER; v_d0 INTEGER;
BEGIN
  -- Defensive: empty array → no work, return zeros.
  IF p_visits IS NULL OR jsonb_array_length(p_visits) = 0 THEN
    RETURN json_build_object(
      'visits_written', 0,
      'requirements_written', 0,
      'signals_written', 0,
      'drift_events', 0,
      'visits_failed', 0
    );
  END IF;

  FOR v_visit IN SELECT * FROM jsonb_array_elements(p_visits)
  LOOP
    -- Snapshot counters, then process the visit inside its own savepoint so a
    -- single bad visit fails in isolation instead of rolling back the batch.
    v_w0 := v_visits_written; v_r0 := v_reqs_written;
    v_s0 := v_signals_written; v_d0 := v_drift_events;
    BEGIN
      v_visit_template_id := (v_visit->>'visit_template_id')::UUID;

      -- Sanity: visit_template_id must belong to p_protocol_id. If not, skip
      -- the visit (don't abort the whole call — partial success is better
      -- than zero on a single bad row in a multi-visit payload).
      IF NOT EXISTS (
        SELECT 1 FROM protocol_visit_templates
         WHERE id = v_visit_template_id AND protocol_id = p_protocol_id
      ) THEN
        CONTINUE;
      END IF;

      v_purpose          := NULLIF(btrim(v_visit->>'purpose'), '');
      v_confidence_state := NULLIF(btrim(v_visit->>'confidence_state'), '');

      -- Update visit-level fields. NULL inputs leave the prior value alone
      -- (we only overwrite when the new value is non-null). Mirrors the
      -- "preserve prior on retry" rule from §5.4.
      UPDATE protocol_visit_templates
         SET purpose          = COALESCE(v_purpose, purpose),
             confidence_state = COALESCE(v_confidence_state::confidence_state, confidence_state)
       WHERE id = v_visit_template_id;

      v_visits_written := v_visits_written + 1;

      -- ---------------------------------------------------------------------
      -- Procedures → visit_requirements upsert by fingerprint match
      -- ---------------------------------------------------------------------
      IF v_visit ? 'procedures' AND jsonb_typeof(v_visit->'procedures') = 'array' THEN
        FOR v_proc IN SELECT * FROM jsonb_array_elements(v_visit->'procedures')
        LOOP
          v_proc_fingerprint  := v_proc->>'derived_text_fingerprint';
          v_proc_derived_text := v_proc->>'derived_text';

          IF v_proc_fingerprint IS NULL OR v_proc_derived_text IS NULL THEN
            CONTINUE;
          END IF;

          -- Look up existing requirement by fingerprint (computed on existing
          -- rows from their stored derived_text). Scoped to this visit only.
          SELECT r.id, r.current_text, r.derived_text, r.version
            INTO v_existing_req_id, v_existing_curtext, v_existing_derived, v_existing_version
            FROM visit_requirements r
           WHERE r.visit_template_id = v_visit_template_id
             AND _vew_fingerprint(r.visit_template_id, r.derived_text) = v_proc_fingerprint
           LIMIT 1;

          IF v_existing_req_id IS NOT NULL THEN
            -- Match. Preserve human edits + review state.
            IF v_existing_curtext IS NOT NULL AND v_existing_derived IS DISTINCT FROM v_proc_derived_text THEN
              INSERT INTO visit_requirement_drift_log (
                requirement_id, parser_text_before, parser_text_after, current_text_preserved
              ) VALUES (
                v_existing_req_id, v_existing_derived, v_proc_derived_text, v_existing_curtext
              );
              v_drift_events := v_drift_events + 1;
            END IF;

            UPDATE visit_requirements
               SET derived_text       = v_proc_derived_text,
                   description        = v_proc->>'description',
                   phase              = COALESCE((v_proc->>'phase')::execution_phase, phase),
                   classification     = COALESCE((v_proc->>'classification')::item_classification, classification),
                   origin             = COALESCE((v_proc->>'origin')::requirement_origin, origin),
                   role_hint          = v_proc->>'role_hint',
                   protocol_section   = v_proc->>'protocol_section',
                   protocol_page      = NULLIF((v_proc->>'protocol_page'), '')::INTEGER,
                   soa_column         = v_proc->>'soa_column',
                   amendment_version  = v_proc->>'amendment_version',
                   extracted_item_id  = NULLIF(v_proc->>'extracted_item_id', '')::UUID,
                   ordinal            = COALESCE(NULLIF((v_proc->>'ordinal'), '')::INTEGER, ordinal),
                   updated_at         = NOW()
             WHERE id = v_existing_req_id;

            v_new_req_id := v_existing_req_id;
          ELSE
            -- No match → insert a new row.
            INSERT INTO visit_requirements (
              visit_template_id,
              ordinal,
              phase,
              classification,
              origin,
              derived_text,
              description,
              role_hint,
              extracted_item_id,
              protocol_section,
              protocol_page,
              soa_column,
              amendment_version
            ) VALUES (
              v_visit_template_id,
              COALESCE(NULLIF((v_proc->>'ordinal'), '')::INTEGER, v_reqs_written),
              COALESCE((v_proc->>'phase')::execution_phase, 'assessment'),
              COALESCE((v_proc->>'classification')::item_classification, 'required'),
              COALESCE((v_proc->>'origin')::requirement_origin, 'soa_cell'),
              v_proc_derived_text,
              v_proc->>'description',
              v_proc->>'role_hint',
              NULLIF(v_proc->>'extracted_item_id', '')::UUID,
              v_proc->>'protocol_section',
              NULLIF((v_proc->>'protocol_page'), '')::INTEGER,
              v_proc->>'soa_column',
              v_proc->>'amendment_version'
            )
            RETURNING id INTO v_new_req_id;
          END IF;

          v_reqs_written := v_reqs_written + 1;

          -- ----------------------------------------------------------------
          -- Child rules — parser-derived, wipe + rewrite per §7.1.
          -- ----------------------------------------------------------------
          DELETE FROM visit_conditional_rules WHERE requirement_id = v_new_req_id;
          DELETE FROM visit_timing_rules      WHERE requirement_id = v_new_req_id;
          DELETE FROM visit_source_fields     WHERE requirement_id = v_new_req_id;

          IF v_proc ? 'conditional_rules' AND jsonb_typeof(v_proc->'conditional_rules') = 'array' THEN
            INSERT INTO visit_conditional_rules (
              requirement_id, ordinal, condition_text, consequence_text,
              source_section, source_page
            )
            SELECT
              v_new_req_id,
              COALESCE((cr->>'ordinal')::INTEGER, idx),
              cr->>'condition_text',
              cr->>'consequence_text',
              cr->>'source_section',
              NULLIF((cr->>'source_page'), '')::INTEGER
              FROM jsonb_array_elements(v_proc->'conditional_rules') WITH ORDINALITY AS t(cr, idx)
             WHERE cr->>'condition_text' IS NOT NULL AND cr->>'consequence_text' IS NOT NULL;
          END IF;

          IF v_proc ? 'timing_rule' AND jsonb_typeof(v_proc->'timing_rule') = 'object' THEN
            INSERT INTO visit_timing_rules (
              requirement_id, label,
              window_before_minutes, window_after_minutes,
              is_hard_constraint, source_section
            )
            VALUES (
              v_new_req_id,
              v_proc->'timing_rule'->>'label',
              NULLIF((v_proc->'timing_rule'->>'window_before_minutes'), '')::INTEGER,
              NULLIF((v_proc->'timing_rule'->>'window_after_minutes'), '')::INTEGER,
              COALESCE((v_proc->'timing_rule'->>'is_hard_constraint')::BOOLEAN, FALSE),
              v_proc->'timing_rule'->>'source_section'
            );
          END IF;

          IF v_proc ? 'source_fields' AND jsonb_typeof(v_proc->'source_fields') = 'array' THEN
            INSERT INTO visit_source_fields (
              requirement_id, ordinal, field_label, field_type,
              units, normal_range, is_required
            )
            SELECT
              v_new_req_id,
              COALESCE((sf->>'ordinal')::INTEGER, idx),
              sf->>'field_label',
              COALESCE((sf->>'field_type')::source_field_type, 'text'),
              sf->>'units',
              sf->>'normal_range',
              COALESCE((sf->>'is_required')::BOOLEAN, FALSE)
              FROM jsonb_array_elements(v_proc->'source_fields') WITH ORDINALITY AS t(sf, idx)
             WHERE sf->>'field_label' IS NOT NULL;
          END IF;
        END LOOP;
      END IF;

      -- ---------------------------------------------------------------------
      -- Completeness signals upsert. UNIQUE (visit_template_id, gap_text).
      -- Clears stale synthetic coverage-check rows first (pending only), then
      -- upserts the new batch. Resolved signals are forensic and stick.
      -- ---------------------------------------------------------------------
      DELETE FROM visit_completeness_signals
       WHERE visit_template_id = v_visit_template_id
         AND resolution = 'pending'
         AND detection_reason IN ('coverage_check_unavailable', 'coverage_check_malformed');

      IF v_visit ? 'completeness_signals' AND jsonb_typeof(v_visit->'completeness_signals') = 'array' THEN
        FOR v_signal IN SELECT * FROM jsonb_array_elements(v_visit->'completeness_signals')
        LOOP
          IF (v_signal->>'gap_text') IS NULL OR btrim(v_signal->>'gap_text') = '' THEN
            CONTINUE;
          END IF;

          INSERT INTO visit_completeness_signals (
            visit_template_id, gap_text, source_section, source_page,
            detection_confidence, detection_reason
          ) VALUES (
            v_visit_template_id,
            left(v_signal->>'gap_text', 1024),
            left(v_signal->>'source_section', 256),
            NULLIF((v_signal->>'source_page'), '')::INTEGER,
            COALESCE((v_signal->>'detection_confidence')::confidence_state, 'needs_review'),
            left(v_signal->>'detection_reason', 512)
          )
          ON CONFLICT (visit_template_id, gap_text)
          DO UPDATE SET
            source_section       = EXCLUDED.source_section,
            source_page          = EXCLUDED.source_page,
            detection_confidence = EXCLUDED.detection_confidence,
            detection_reason     = EXCLUDED.detection_reason
            -- resolution + acknowledged_* preserved — human decisions stick
          WHERE visit_completeness_signals.resolution = 'pending';

          v_signals_written := v_signals_written + 1;
        END LOOP;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      -- One visit failing must NOT zero the rest of the batch. Roll back this
      -- visit's writes (implicit savepoint), restore the counters (variables
      -- survive the rollback), and record the failure.
      v_visits_failed  := v_visits_failed + 1;
      v_visits_written := v_w0; v_reqs_written := v_r0;
      v_signals_written := v_s0; v_drift_events := v_d0;
      RAISE WARNING 'vew_persist: visit % failed, skipped: % (SQLSTATE %)',
        (v_visit->>'visit_template_id'), SQLERRM, SQLSTATE;
    END;
  END LOOP;

  RETURN json_build_object(
    'visits_written',       v_visits_written,
    'requirements_written', v_reqs_written,
    'signals_written',      v_signals_written,
    'drift_events',         v_drift_events,
    'visits_failed',        v_visits_failed
  );
END;
$$;

COMMENT ON FUNCTION visit_execution_persist_parsed_workspace IS
  'Atomic-persist RPC for parser ingest (step 5b). Writes visit_requirements + '
  'child rules + completeness signals; re-ingest preserves human edits via '
  'fingerprint dedup. Each visit runs in its own savepoint (partial success — '
  'one bad visit is skipped + counted in visits_failed, never zeroes the batch). '
  'ordinal is display-order only (no uniqueness) so re-ingest ordinal reuse '
  'cannot abort the transaction. Orphan-row deletion deferred (§7.1).';
