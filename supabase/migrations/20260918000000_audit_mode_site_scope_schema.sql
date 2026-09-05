-- =============================================================================
-- Audit Mode — ISA site audit scope: schema slice (isa-scope-builder)
--
-- site_scope_objects — the risk-based audit scope of an Investigator Site
-- Audit, one row per audit. The 8th deliverable kind on the generic pair
-- (audit_mode_upsert_deliverable / audit_mode_approve_deliverable); the kind
-- arm and the delta-viewer branch land in 20260918000100.
--
-- SOURCE-OF-TRUTH RULE: the scope is DERIVED, deterministically and without
-- a model call, from site_module_mapping_objects (20260917000000) — the
-- modules a tagged protocol risk lands in, each with its server-derived
-- criticality. content stores that derivation as a document:
--
--   { built_from: { mapping_ids: uuid[], built_at: timestamptz },
--     modules: [ { isa_domain, criticality,           -- max over its items
--                  items: [ { id,                     -- the mapping id
--                             protocol_risk_id, isa_domain,
--                             section_identifier, section_title,
--                             criticality, rationale } ] } ] }
--
-- Every item traces to one mapping row (its id) and through it to the
-- protocol risk and the module; the mapping's derived criticality and
-- rationale are copied at build time so the approved document reads the
-- same later even if the mappings move on. built_from is what the
-- workspace compares against the live mapping set to show drift.
--
-- Approval is the house latch: approving CAS-pins THIS row's version
-- (updated_at) — the standard, basis-less shape the letter / agenda /
-- checklist kinds use. No basis_digest column: the kind declares no
-- server-side basis pin (a pin on the mapping set is ledgered in
-- plans/sixonelabs-piqc/isa-scope-builder.md). No generation columns:
-- nothing generates this document.
--
-- Enum value lives in THIS file, functions that reference it in the next —
-- ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction
-- (20260707000200 precedent).
--
-- Owner: @rv61.
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'SITE_SCOPE_OBJECT';

CREATE TABLE site_scope_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_site_scope_objects_updated_at
  BEFORE UPDATE ON site_scope_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- Lead auditor of the audit, as every per-audit deliverable. TO authenticated
-- only: with RLS on and no anon policy, the public key reads nothing.
ALTER TABLE site_scope_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "site_scope_objects_via_audit"
  ON site_scope_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
