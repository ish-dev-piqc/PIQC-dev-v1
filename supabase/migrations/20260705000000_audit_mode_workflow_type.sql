-- =============================================================================
-- Audit Mode — audit workflow type (two-workflow Audit Workspace foundation)
--
-- Audit Mode's vision is a single Audit Workspace where the auditor initiates a
-- Vendor Audit workflow OR an Investigator Site Audit workflow. This migration
-- introduces the workflow-type seam. Only VENDOR_AUDIT is live today; the
-- INVESTIGATOR_SITE_AUDIT value exists so the stage resolver + hub + initiation
-- chooser can be built now (the investigator stage set + site/PI enrichment land
-- in their own initiative).
--
-- Backward compat / rollout ordering (expand-then-contract):
--   - Column is NOT NULL with DEFAULT 'VENDOR_AUDIT'; ADD COLUMN backfills every
--     existing row to VENDOR_AUDIT in place. No data migration needed.
--   - The frontend defaults workflow_type to VENDOR_AUDIT in AuditContext without
--     SELECTing this column yet, so applying this migration is decoupled from the
--     app deploy. When the investigator initiative ships, flip the AuditContext
--     read on (add `workflow_type` to the audits select).
--   - audit_mode_create_audit is intentionally NOT modified: the disabled
--     investigator chooser means every created audit is VENDOR_AUDIT, which the
--     column default already produces. The create RPC gains the param when the
--     investigator workflow goes live.
--
-- RLS: workflow_type inherits the audits table's existing row-level security;
-- it is a scalar attribute of a row the caller can already see. No policy change.
-- =============================================================================

CREATE TYPE audit_workflow_type AS ENUM ('VENDOR_AUDIT', 'INVESTIGATOR_SITE_AUDIT');

ALTER TABLE audits
  ADD COLUMN workflow_type audit_workflow_type NOT NULL DEFAULT 'VENDOR_AUDIT';

-- Hub segmentation filters/counts audits by workflow; index the discriminator.
CREATE INDEX idx_audits_workflow_type ON audits(workflow_type);
