-- =============================================================================
-- materialize_protocol_visits — preserve non-scheduled rows on re-projection.
--
-- The previous version (20260507000000) did:
--   DELETE FROM site_visits WHERE protocol_id = p_protocol_id
--                             AND (template_id IS NOT NULL OR is_seed = TRUE);
--
-- This nuked every template-derived visit including ones a coordinator had
-- already marked completed / missed / deviation. Any re-projection (the
-- enrolled_at trigger fires on every participant insert/update) erased
-- their work.
--
-- New shape:
--   1. DELETE only template-derived rows whose status = 'scheduled' (those
--      are safe to recompute — no coordinator action attached).
--   2. DELETE seed rows (is_seed = TRUE) unconditionally — those are
--      Phase-A demo placeholders, never real coordinator data.
--   3. Insert visits ONLY for (participant_id, template_id) pairs that
--      have no row in site_visits — i.e., skip slots where we just
--      preserved a completed / missed / deviation / overdue / closing_soon
--      visit.
--
-- Net effect: re-projecting a protocol re-computes any visit that's still
-- 'scheduled' (in case window parameters changed) and leaves real
-- coordinator actions untouched.
-- =============================================================================

CREATE OR REPLACE FUNCTION materialize_protocol_visits(p_protocol_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_template     protocol_visit_templates%ROWTYPE;
  v_participant  site_participants%ROWTYPE;
  v_anchor       DATE;
  v_effective    DATE;
  v_created      INT  := 0;
  v_skipped      INT  := 0;
  v_window_close TIMESTAMPTZ;
  v_status       site_visit_status;
BEGIN
  SELECT demo_anchor_date INTO v_anchor FROM protocols WHERE id = p_protocol_id;

  -- Step 1: delete template-derived visits that are still 'scheduled'.
  -- These haven't been acted on; safe to recompute their window/status
  -- based on the current template and anchor.
  DELETE FROM site_visits
   WHERE protocol_id = p_protocol_id
     AND template_id IS NOT NULL
     AND status = 'scheduled';

  -- Step 2: delete demo-seed rows. These are Phase-A placeholders not
  -- backed by coordinator action.
  DELETE FROM site_visits
   WHERE protocol_id = p_protocol_id
     AND is_seed = TRUE;

  -- Step 3: cross product of (participants × templates), skipping pairs
  -- that already have a visit (i.e., the coordinator has acted on it).
  FOR v_template IN
    SELECT * FROM protocol_visit_templates WHERE protocol_id = p_protocol_id
  LOOP
    FOR v_participant IN
      SELECT * FROM site_participants WHERE protocol_id = p_protocol_id
    LOOP
      -- Skip if a visit already exists for this (participant, template)
      -- pair. Step 1 only removed scheduled rows; anything left is
      -- coordinator-owned and must not be overwritten.
      IF EXISTS (
        SELECT 1 FROM site_visits
         WHERE participant_id = v_participant.id
           AND template_id    = v_template.id
      ) THEN
        CONTINUE;
      END IF;

      v_effective := COALESCE(v_participant.enrolled_at, v_anchor);
      IF v_effective IS NULL THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      v_window_close := (v_effective + v_template.study_day + v_template.window_plus_days)::timestamptz
                        + INTERVAL '23 hours 59 minutes';

      v_status := CASE
        WHEN (v_effective + v_template.study_day) < CURRENT_DATE
          AND v_window_close > NOW()                          THEN 'overdue'::site_visit_status
        WHEN (v_effective + v_template.study_day) < CURRENT_DATE THEN 'missed'::site_visit_status
        WHEN (v_effective + v_template.study_day) = CURRENT_DATE THEN 'closing_soon'::site_visit_status
        ELSE                                                       'scheduled'::site_visit_status
      END;

      INSERT INTO site_visits
        (participant_id, protocol_id, date, study_day, visit_name,
         window_closes, status, procedures, template_id, is_seed)
      VALUES
        (v_participant.id, p_protocol_id,
         v_effective + v_template.study_day,
         v_template.study_day, v_template.visit_name,
         v_window_close, v_status, v_template.procedures,
         v_template.id, FALSE);

      v_created := v_created + 1;
    END LOOP;
  END LOOP;

  RETURN json_build_object('created', v_created, 'skipped_no_anchor', v_skipped);
END;
$$;
