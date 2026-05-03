-- =============================================================================
-- Audit Mode — Stage 7-8 report_draft_objects table + RLS
--
-- report_draft_objects: 1:1 with audit. Holds the auditor-authored executive
-- summary and conclusions, the report approval lifecycle, and the final
-- sign-off + export bookkeeping for Stage 8.
--
-- The REPORT_DRAFT_OBJECT enum value is added here and committed before the
-- subsequent migration creates RPCs that reference it.
-- =============================================================================


-- Add the new tracked_object_type value. Committed before any RPC migration
-- uses it (Supabase runs each file as a separate transaction).
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'REPORT_DRAFT_OBJECT';


-- =============================================================================
-- TABLE
-- =============================================================================

CREATE TABLE report_draft_objects (
  id                  UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id            UUID                        NOT NULL UNIQUE REFERENCES audits(id) ON DELETE CASCADE,
  executive_summary   TEXT                        NOT NULL DEFAULT '',
  conclusions         TEXT                        NOT NULL DEFAULT '',
  approval_status     deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by         UUID                        REFERENCES auth.users(id),
  approved_at         TIMESTAMPTZ,
  final_signed_off_by UUID                        REFERENCES auth.users(id),
  final_signed_off_at TIMESTAMPTZ,
  exported_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_report_draft_objects_updated_at
  BEFORE UPDATE ON report_draft_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- ROW LEVEL SECURITY
-- Follows the audit-scoped pattern: visible to the audit's lead_auditor_id.
-- =============================================================================

ALTER TABLE report_draft_objects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "report_draft_objects_via_audit"
  ON report_draft_objects FOR ALL
  TO authenticated
  USING      (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
