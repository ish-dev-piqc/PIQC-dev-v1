-- =============================================================================
-- Audit Mode — Investigator Site Audit (ISA) foundation: stages + sites + auditee
--
-- Phase 1 of the Investigator Site Audit workflow. Audit Mode is a two-workflow
-- Audit Workspace (audit_workflow_type, 20260705000000). This migration gives the
-- INVESTIGATOR_SITE_AUDIT workflow its own stage pipeline and its own auditee
-- (a site + PI, not a vendor) — without disturbing the live vendor flow.
--
-- Three changes, none of which reference the new audit_stage values in this same
-- transaction, so the companion RPC migration (20260709000100) can use
-- ISA_SITE_INTAKE once this one commits (mirrors the issue/capa schema→rpcs split):
--   1. audit_stage gains 7 ISA_* values — the investigator pipeline.
--   2. New `sites` table — the investigator auditee, mirroring `vendors`
--      (shared namespace, SELECT-to-authenticated, INSERT via SECURITY DEFINER).
--   3. audits generalized: vendor_id becomes nullable, site_id added, and a CHECK
--      ties the auditee to workflow_type. Existing vendor rows already satisfy it
--      (VENDOR_AUDIT + vendor_id set + site_id null), so validation passes.
-- =============================================================================

-- 1. Investigator stage pipeline ---------------------------------------------
-- ISA_-prefixed so stage → component dispatch never collides with a vendor stage.
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_SITE_INTAKE';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_RISK_ASSESSMENT';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_SCOPE_BUILDER';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_PREP';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_CONDUCT';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_REPORT';
ALTER TYPE audit_stage ADD VALUE IF NOT EXISTS 'ISA_EXPORT';

-- 2. sites — investigator auditee (mirrors vendors) --------------------------
-- Shared namespace like vendors (no created_by): audit contractors share the
-- site namespace for V1. PI name is a professional identity, not participant PHI.
CREATE TABLE sites (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                   TEXT        NOT NULL,
  site_number            TEXT,
  principal_investigator TEXT,
  country                TEXT        NOT NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every table with an updated_at column carries the shared touch trigger
-- (schema-wide invariant from 20260427120000). No UPDATE path exists today
-- (SELECT-only RLS + insert-only RPC), but a future site-edit RPC would
-- silently leave updated_at stale without it.
CREATE TRIGGER touch_sites_updated_at
  BEFORE UPDATE ON sites
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE sites ENABLE ROW LEVEL SECURITY;

-- Any authenticated auditor can read sites; INSERT is gated through the
-- SECURITY DEFINER audit_mode_create_site RPC (20260709000100).
CREATE POLICY "sites_select_authenticated"
  ON sites FOR SELECT TO authenticated USING (TRUE);

-- 3. audits — generalize the auditee -----------------------------------------
ALTER TABLE audits ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE audits ADD COLUMN site_id UUID REFERENCES sites(id);
CREATE INDEX idx_audits_site ON audits(site_id);

-- The auditee must match the workflow: a vendor audit carries a vendor (no site),
-- an investigator site audit carries a site (no vendor). Existing rows are all
-- VENDOR_AUDIT with vendor_id set + site_id null, so they pass on ADD CONSTRAINT.
ALTER TABLE audits ADD CONSTRAINT audits_auditee_matches_workflow CHECK (
  (workflow_type = 'VENDOR_AUDIT'            AND vendor_id IS NOT NULL AND site_id IS NULL)
  OR
  (workflow_type = 'INVESTIGATOR_SITE_AUDIT' AND site_id   IS NOT NULL AND vendor_id IS NULL)
);
