-- =============================================================================
-- Audit Mode — ISA report draft schema (S3 of the notes → findings → report arc)
--
-- isa_report_draft_objects — one row per ISA audit holding the auditor-owned
-- pieces of the report. Everything else in the exported report derives at
-- render time (metadata merge from the audit record, boilerplate constants,
-- mechanical rollups from isa_finding_objects) and is deliberately NOT stored:
-- stored copies of derivable content go stale the moment a finding changes.
--
-- Storage model — nullable prose columns, NULL = "still templated":
--   exec_summary          NULL → the client derives the six-beat template
--                         formula live from findings; a stored value means
--                         the auditor took the pen (source = auditor_edited).
--   auditee_background,
--   opening_meeting,
--   closing_meeting       NULL → placeholder guidance shows; stored = prose.
--   This replaces the vendor lane's paired *_source columns: with no LLM in
--   this slice there are only two states, and NULL-ness encodes them without
--   a second column to keep honest. When LLM refinement lands, a source
--   column comes with it.
--
-- site_verdict — the site-continuation ruling, THE consequential sentence of
-- the report ("None of the noted findings should prevent continued use of
-- the site…"). Doctrine: never machine-drafted, never defaulted. It is a
-- structured enum the auditor must set; the client blocks export while NULL
-- and renders an explicit placeholder in the exec summary. The optional
-- site_verdict_text carries auditor nuance appended to the templated
-- verdict sentence.
--
-- response_due_days/basis — the response clause is parameterized (the
-- templates disagree: 30 calendar days vs "<XX business> days"); 30 calendar
-- is the default.
-- =============================================================================

CREATE TYPE isa_site_verdict AS ENUM (
  'CONTINUE',
  'CONTINUE_INCREASED_MONITORING',
  'DO_NOT_CONTINUE'
);

-- New tracked type; 20260725000100 extends audit_mode_can_view_tracked_object.
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'ISA_REPORT_DRAFT_OBJECT';

CREATE TABLE isa_report_draft_objects (
  id                 UUID             PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id           UUID             NOT NULL UNIQUE REFERENCES audits(id) ON DELETE CASCADE,
  exec_summary       TEXT,
  auditee_background TEXT,
  opening_meeting    TEXT,
  closing_meeting    TEXT,
  site_verdict       isa_site_verdict,
  site_verdict_text  TEXT,
  response_due_days  INTEGER          NOT NULL DEFAULT 30
                     CHECK (response_due_days BETWEEN 1 AND 365),
  response_due_basis TEXT             NOT NULL DEFAULT 'CALENDAR'
                     CHECK (response_due_basis IN ('CALENDAR', 'BUSINESS')),
  created_by         UUID             NOT NULL REFERENCES auth.users(id),
  created_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ      NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_isa_report_draft_objects_updated_at
  BEFORE UPDATE ON isa_report_draft_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE isa_report_draft_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "isa_report_draft_objects_via_audit"
  ON isa_report_draft_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
