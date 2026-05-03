-- =============================================================================
-- Audit Mode — Stage 7-8 (Report Drafting / Final Review Export) Schema
--
-- Adds the REPORT_DRAFT_OBJECT enum value and creates the report_draft_objects
-- table (1:1 with audits). Must run before the RPCs migration.
-- =============================================================================


-- Add enum value first (separate transaction required before use in RPCs).
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'REPORT_DRAFT_OBJECT';


-- =============================================================================
-- report_draft_objects
--
-- One row per audit. Holds the auditor-authored executive summary and
-- conclusions, the approval workflow, final GxP sign-off, and export
-- bookkeeping.
-- =============================================================================

CREATE TABLE IF NOT EXISTS report_draft_objects (
  id                    UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              UUID                       NOT NULL UNIQUE REFERENCES audits(id) ON DELETE CASCADE,
  executive_summary     TEXT                       NOT NULL DEFAULT '',
  conclusions           TEXT                       NOT NULL DEFAULT '',
  approval_status       deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by           UUID                       REFERENCES auth.users(id),
  approved_at           TIMESTAMPTZ,
  final_signed_off_by   UUID                       REFERENCES auth.users(id),
  final_signed_off_at   TIMESTAMPTZ,
  exported_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_report_draft_objects_updated_at
  BEFORE UPDATE ON report_draft_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE report_draft_objects ENABLE ROW LEVEL SECURITY;

-- Lead auditor can read/write their own audit's report draft.
CREATE POLICY "report_draft_objects_via_audit"
  ON report_draft_objects
  FOR ALL
  USING (
    audit_id IN (
      SELECT id FROM audits WHERE lead_auditor_id = auth.uid()
    )
  );
