-- =============================================================================
-- Phase A — calendar autopopulates from parsed protocol PDFs.
--
-- The Reducto-driven `ingest` Edge Function extracts a Schedule of
-- Assessments per protocol PDF and upserts the visits here, indexed by
-- (protocol_id, visit_name, study_day). We don't write calendar dates at
-- this layer — the user provides a `demo_anchor_date` per protocol, and the
-- materialize_protocol_visits RPC projects (participant, template) pairs
-- onto real `site_visits` rows by adding `study_day` to each participant's
-- effective anchor (their enrolled_at, or the protocol-level anchor as a
-- fallback).
-- =============================================================================

CREATE TABLE protocol_visit_templates (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id         UUID        NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  visit_name          TEXT        NOT NULL,
  study_day           INTEGER     NOT NULL,
  window_minus_days   INTEGER     NOT NULL DEFAULT 0,
  window_plus_days    INTEGER     NOT NULL DEFAULT 0,
  procedures          TEXT[]      NOT NULL DEFAULT '{}',
  source_document_id  UUID        REFERENCES documents(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (protocol_id, visit_name, study_day)
);

CREATE INDEX protocol_visit_templates_protocol_idx
  ON protocol_visit_templates(protocol_id);

CREATE TRIGGER touch_protocol_visit_templates_updated_at
  BEFORE UPDATE ON protocol_visit_templates
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- ---------------------------------------------------------------------------
-- protocols.demo_anchor_date — the calendar date for protocol Day 0. Used as
-- a fallback when a participant has no enrolled_at yet, so the calendar can
-- show visits before site enrolment is finalised (demo / preview path).
-- ---------------------------------------------------------------------------
ALTER TABLE protocols
  ADD COLUMN demo_anchor_date DATE;


-- ---------------------------------------------------------------------------
-- site_visits — columns added so materialize can attribute rows back to
-- the template they came from and so the original demo seed rows can be
-- swept on first projection.
-- ---------------------------------------------------------------------------
ALTER TABLE site_visits
  ADD COLUMN template_id UUID REFERENCES protocol_visit_templates(id) ON DELETE SET NULL,
  ADD COLUMN is_seed     BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX site_visits_template_idx ON site_visits(template_id);

-- Pre-Phase-A seed rows (the original demo data) have no template_id; mark
-- them so the materialize RPC can sweep them out on first projection.
UPDATE site_visits SET is_seed = TRUE WHERE template_id IS NULL;


-- ---------------------------------------------------------------------------
-- materialize_protocol_visits — main RPC.
--
-- Wipes auto-materialized rows (template_id IS NOT NULL) and seed rows
-- (is_seed = TRUE) for the protocol, then re-creates one site_visit per
-- (participant, template) pair using the effective anchor.
--
-- Returns { created INTEGER, skipped_no_anchor INTEGER } as JSON.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION materialize_protocol_visits(p_protocol_id UUID)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
  v_anchor       DATE;
  v_created      INTEGER := 0;
  v_skipped      INTEGER := 0;
  v_template     RECORD;
  v_participant  RECORD;
  v_effective    DATE;
  v_window_close TIMESTAMPTZ;
  v_status       site_visit_status;
BEGIN
  SELECT demo_anchor_date INTO v_anchor FROM protocols WHERE id = p_protocol_id;

  -- Nuke previously-materialized + original seed rows for this protocol.
  DELETE FROM site_visits
   WHERE protocol_id = p_protocol_id
     AND (template_id IS NOT NULL OR is_seed = TRUE);

  -- Cross product of participants × templates.
  FOR v_template IN
    SELECT * FROM protocol_visit_templates WHERE protocol_id = p_protocol_id
  LOOP
    FOR v_participant IN
      SELECT * FROM site_participants WHERE protocol_id = p_protocol_id
    LOOP
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


-- ---------------------------------------------------------------------------
-- Auto-trigger: when a participant's enrolled_at changes (or new participant
-- is inserted with non-null enrolled_at), re-materialize that protocol so
-- the new participant gets their schedule projected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_participant_anchor_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (TG_OP = 'UPDATE' AND NEW.enrolled_at IS DISTINCT FROM OLD.enrolled_at) THEN
    -- Only fire when the protocol has at least one template — avoids needless
    -- churn on protocols that haven't had a PDF parsed yet.
    IF EXISTS (
      SELECT 1 FROM protocol_visit_templates WHERE protocol_id = NEW.protocol_id
    ) THEN
      PERFORM materialize_protocol_visits(NEW.protocol_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER site_participants_remateralize_on_enroll
  AFTER INSERT OR UPDATE OF enrolled_at ON site_participants
  FOR EACH ROW EXECUTE FUNCTION trg_participant_anchor_changed();
