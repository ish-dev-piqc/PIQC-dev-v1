-- =============================================================================
-- Visit Prep — surface HOW the schedule was extracted on the coverage row.
--
-- Workstream B of the deterministic-SoA-grid change. The ingest pipeline now
-- reads the SoA HTML grid Reducto returns and parses it deterministically; an
-- automatic gate falls back to the LLM extraction when the grid is unreliable.
-- Recording the method (+ the independent expected-visit signal) lets the
-- Visit-Prep coverage banner show "extraction may be incomplete — re-run" for a
-- fallback or low-confidence parse, so a collapse is never silent.
--
-- Append-only: adds two nullable columns + CREATE OR REPLACE the read RPC.
-- =============================================================================

ALTER TABLE protocol_visit_coverage
  ADD COLUMN IF NOT EXISTS extraction_method  TEXT,
  ADD COLUMN IF NOT EXISTS expected_from_signal INTEGER;

COMMENT ON COLUMN protocol_visit_coverage.extraction_method IS
  'How schedule_of_events was extracted: ''grid'' (deterministic SoA-grid parse), '
  '''grid_low_confidence'' (grid used but self-consistency flagged), or '
  '''llm_fallback'' (grid gate failed → LLM extraction). NULL for rows written '
  'before this migration.';

COMMENT ON COLUMN protocol_visit_coverage.expected_from_signal IS
  'Independent expected treatment-visit count derived from inline protocol prose '
  '(soaColumnCount.deriveVisitCountSignal) — the cross-check the grid gate used.';


-- ---------------------------------------------------------------------------
-- Read RPC — now also returns extraction_method + expected_from_signal.
-- (CREATE OR REPLACE; body otherwise unchanged from 20260626000000.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION visit_execution_get_coverage(p_protocol_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  protocol_visit_coverage%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RETURN NULL;  -- empty rather than leak existence
  END IF;

  SELECT * INTO v_row
    FROM protocol_visit_coverage
   WHERE protocol_id = p_protocol_id
   ORDER BY detected_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'expected_count',       v_row.expected_count,
    'found_count',          v_row.found_count,
    'missing',              v_row.missing,
    'detected_at',          v_row.detected_at,
    'resolution',           v_row.resolution,
    'extraction_method',    v_row.extraction_method,
    'expected_from_signal', v_row.expected_from_signal
  );
END;
$$;

GRANT EXECUTE ON FUNCTION visit_execution_get_coverage(UUID) TO authenticated;
