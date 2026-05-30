-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5b:
-- visit_execution_persist_parsed_workspace RPC.
--
-- Atomic-persist function called from the ingest edge function after Reducto's
-- EXTRACT pass produces structured per-visit procedures. Single PL/pgSQL body =
-- one implicit transaction per design doc §6.3 — half-written workspaces
-- (visit_requirements without their child rules) never observable.
--
-- Why a SECURITY DEFINER function:
--   The edge function (processIngestCompletion) runs with the service role
--   key. Protocol ownership has already been verified by the auto-create or
--   document-resolution step in the calling code. This function trusts the
--   caller — it does NOT re-verify protocol ownership. RLS on the underlying
--   tables protects the read path; writes here bypass via SECURITY DEFINER.
--
-- Inputs (JSON shape):
--   p_protocol_id UUID
--   p_visits JSONB array of:
--     {
--       visit_template_id: uuid,            -- must belong to p_protocol_id
--       purpose: string | null,             -- pre-Sprint-3.5b NULL preserved on retry
--       confidence_state: text | null,      -- 'high'|'medium'|'low'|'needs_review'|null
--       procedures: [
--         {
--           ordinal: int,
--           derived_text: string,
--           derived_text_fingerprint: string (sha256 hex computed by caller),
--           description: string | null,
--           phase: string,                  -- execution_phase enum value
--           classification: string,          -- item_classification enum value
--           origin: string,                  -- requirement_origin enum value
--           role_hint: string | null,
--           protocol_section: string | null,
--           protocol_page: int | null,
--           soa_column: string | null,
--           amendment_version: string | null,
--           extracted_item_id: uuid | null,
--           conditional_rules: [{ ordinal, condition_text, consequence_text,
--                                 source_section, source_page }],
--           timing_rule: { label, window_before_minutes, window_after_minutes,
--                          is_hard_constraint, source_section } | null,
--           source_fields: [{ ordinal, field_label, field_type, units,
--                             normal_range, is_required }]
--         }
--       ],
--       completeness_signals: [
--         { gap_text, source_section, source_page,
--           detection_confidence, detection_reason }
--       ]
--     }
--
-- Returns:
--   { visits_written, requirements_written, signals_written, drift_events }
--
-- Re-ingest semantics (per parser-integration.md §7.1):
--   - visit_requirements rows are MATCHED by fingerprint
--     (sha256(visit_template_id || '|' || normalize(derived_text))).
--     The fingerprint is recomputed for existing rows on each call (pgcrypto
--     digest function). Matched rows preserve current_text + review_status +
--     review_note + version.
--   - When current_text IS NOT NULL and the new derived_text differs from the
--     stored derived_text, the human edit takes precedence (current_text wins)
--     and a row is appended to visit_requirement_drift_log so the audit
--     timeline can show "parser changed its mind but the human's edit stuck."
--   - Child rules (conditional / timing / source fields) are PARSER-DERIVED
--     per §7.1 — wiped + rewritten on every call.
--   - Orphan visit_requirements rows (existed before, no match this call)
--     are NOT deleted in 3.5b. Deferred decision (Sprint 4): destroying a
--     human-reviewed row on amendment is destructive, surface as drift
--     instead.
--   - visit_completeness_signals upserts on UNIQUE (visit_template_id,
--     gap_text). Resolved signals (resolution != 'pending') are untouched.
-- =============================================================================


-- Helper: normalize derived_text → lowercase + collapse whitespace + trim.
-- Mirrors the edge-function fingerprint normalization exactly. If the two
-- drift apart, fingerprints stop matching across re-ingest. Tests cover both.
CREATE OR REPLACE FUNCTION _vew_normalize_derived_text(p_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(regexp_replace(lower(coalesce(p_text, '')), '\s+', ' ', 'g'));
$$;


CREATE OR REPLACE FUNCTION _vew_fingerprint(
  p_visit_template_id UUID,
  p_derived_text TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- Schema-qualified: pgcrypto lives in the `extensions` schema and the
  -- migration runner's search_path does not include it, so a bare digest()
  -- fails with 42883. Qualifying doesn't change the hash output, so the
  -- fingerprint stays in sync with the TS-side fingerprintRequirement().
  SELECT encode(
    extensions.digest(
      p_visit_template_id::text || '|' || _vew_normalize_derived_text(p_derived_text),
      'sha256'
    ),
    'hex'
  );
$$;


-- Main entry. SECURITY DEFINER + SET search_path = public for safety.
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
BEGIN
  -- Defensive: empty array → no work, return zeros.
  IF p_visits IS NULL OR jsonb_array_length(p_visits) = 0 THEN
    RETURN json_build_object(
      'visits_written', 0,
      'requirements_written', 0,
      'signals_written', 0,
      'drift_events', 0
    );
  END IF;

  FOR v_visit IN SELECT * FROM jsonb_array_elements(p_visits)
  LOOP
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

    -- -----------------------------------------------------------------------
    -- Procedures → visit_requirements upsert by fingerprint match
    -- -----------------------------------------------------------------------
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
          --
          -- Drift detection: if the new derived_text differs from the stored
          -- derived_text AND a human edit exists (current_text NOT NULL),
          -- append a drift_log row. The fingerprint matched (normalized text
          -- equal) but the raw derived_text may have whitespace/case changes
          -- worth recording.
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
                 -- current_text + review_status + review_note + version
                 -- intentionally untouched (human edit takes precedence).
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

        -- ------------------------------------------------------------------
        -- Child rules — parser-derived, wipe + rewrite per §7.1.
        -- ------------------------------------------------------------------
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

    -- -----------------------------------------------------------------------
    -- Completeness signals upsert. UNIQUE (visit_template_id, gap_text).
    -- Only touches 'pending' rows; resolved signals are forensic and stick.
    --
    -- Critical: clear stale synthetic 'coverage_check_unavailable' /
    -- 'coverage_check_malformed' rows for this visit BEFORE upserting the
    -- new batch. Otherwise a transient OpenAI failure leaves a permanent
    -- "coverage check unavailable" badge on the visit even after a
    -- subsequent successful retry. Only `resolution = 'pending'` rows are
    -- cleared — human-acted-on rows (acknowledged, dismissed, promoted)
    -- stay as forensic record.
    --
    -- Run unconditionally — even when the new batch is empty, because an
    -- empty batch can mean "successful coverage check found no gaps" and
    -- that's exactly when we want to clear the stale failure row.
    -- -----------------------------------------------------------------------
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

        -- Hard cap on gap_text length. The LLM is instructed to return short
        -- verbatim/paraphrase requirements, but an adversarial response could
        -- emit a 50000-char blob that bloats the table. 1024 chars is far
        -- more than any legitimate clinical requirement statement needs.
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
  END LOOP;

  RETURN json_build_object(
    'visits_written',       v_visits_written,
    'requirements_written', v_reqs_written,
    'signals_written',      v_signals_written,
    'drift_events',         v_drift_events
  );
END;
$$;


COMMENT ON FUNCTION visit_execution_persist_parsed_workspace IS
  'Atomic-persist RPC for Sprint 3.5b parser ingest. Called from the ingest '
  'edge function (processIngestCompletion step 5b) after Reducto extracts '
  'structured procedures_structured[] per visit. Writes visit_requirements + '
  'child rules + visit_completeness_signals + drift_log in one transaction. '
  'Re-ingest preserves human edits (current_text, review_status) via '
  'fingerprint dedup; child rules wipe-and-rewrite. Orphan-row deletion is '
  'deferred — humans can re-resolve through review UI in Sprint 4.';

COMMENT ON FUNCTION _vew_normalize_derived_text IS
  'Helper for visit_execution_persist_parsed_workspace. Normalizes derived_text '
  'to lowercase + collapsed whitespace + trim. MUST stay byte-for-byte '
  'identical to the TypeScript normalize() in supabase/functions/_shared/'
  'ingestPipeline.ts — fingerprints stop matching across re-ingest otherwise.';

COMMENT ON FUNCTION _vew_fingerprint IS
  'SHA-256 hex fingerprint of (visit_template_id || ''|'' || normalize(derived_text)). '
  'Re-ingest dedup key per parser-integration.md §7.2. Not stored — computed '
  'inline. If perf becomes a concern, add a generated column on visit_requirements.';
