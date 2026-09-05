-- =============================================================================
-- Audit Mode — ISA site module mapping schema (isa-site-modules)
--
-- site_module_mapping_objects — which site audit MODULES a tagged protocol
-- risk lands in, on an Investigator Site Audit. The ISA counterpart of
-- vendor_service_mapping_objects (20260427120000): the vendor lane maps each
-- risk to the audit's single vendor service; a site audit has no service
-- object, so the mapping keys on the audit and on a module.
--
--   module               — the existing isa_domain enum (20260723000000).
--                          Findings and notes already tag on it, so a risk
--                          mapped to INFORMED_CONSENT and a finding filed
--                          under INFORMED_CONSENT line up with no crosswalk.
--                          Deliberately NOT a new module vocabulary.
--   derived_criticality  — audit_mode_derive_criticality(tier, surface,
--                          time) — the same immutable rule the vendor lane
--                          uses, so a risk scores identically in both
--                          workflows. Set by the create RPC, never by the
--                          client.
--   criticality_rationale — audit_mode_build_default_rationale(...), always
--                          present (no override path; see the RPC file).
--
-- One row per (audit, risk, module); a risk may sit in several modules.
-- The Scope builder (next stage) rolls criticality up per module from these
-- rows and emits the checklist that traces back to them.
--
-- protocol_risk_id is RESTRICT (as the vendor FK): a risk with mappings
-- cannot be deleted out from under them. audit_id cascades with the audit,
-- like every other per-audit object.
--
-- New tracked type; 20260917000100 extends audit_mode_can_view_tracked_object
-- (the state_history_deltas INSERT policy runs it, so the branch must exist
-- before the first create writes a delta).
--
-- Owner: @rv61.
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'SITE_MODULE_MAPPING_OBJECT';

CREATE TABLE site_module_mapping_objects (
  id                    UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              UUID                NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  protocol_risk_id      UUID                NOT NULL REFERENCES protocol_risk_objects(id),
  isa_domain            isa_domain          NOT NULL,
  derived_criticality   derived_criticality NOT NULL,
  criticality_rationale TEXT                NOT NULL,
  created_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  UNIQUE (audit_id, protocol_risk_id, isa_domain)
);

CREATE INDEX idx_site_module_mapping_objects_audit
  ON site_module_mapping_objects (audit_id, created_at);

CREATE TRIGGER touch_site_module_mapping_objects_updated_at
  BEFORE UPDATE ON site_module_mapping_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- Lead auditor of the audit, as every per-audit object. Policies are
-- TO authenticated only: with RLS on and no anon policy, the public key
-- reads nothing.
ALTER TABLE site_module_mapping_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_module_mapping_objects_via_audit"
  ON site_module_mapping_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
