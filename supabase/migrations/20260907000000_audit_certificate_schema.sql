-- =============================================================================
-- Audit Mode — audit certificate: schema slice (PR-D6)
--
-- 7th deliverable kind: the terminal certificate recording THAT the audit
-- happened — audit object, scope covered, dates, standard. It never states a
-- result: [Outcome: to be determined by QA] and the blank certificate date
-- are code-owned template lines the sponsor's QA fills outside PIQC.
-- Non-gating; the Stage-7 report gates IT, not the reverse.
--
-- SOURCE-OF-TRUTH RULE: content stores ONLY the descriptive narrative
-- ({body_text, scope}). The audit facts header (vendor, dates, protocol) and
-- the outcome/date template lines derive from the audit record at render
-- time — never copied in, never model-written. What makes the latch honest
-- is basis_digest: approving CAS-pins the approved Stage-7 report's
-- readiness_fingerprint (see 20260907000100), so "approved" always names
-- WHICH report version this certificate certifies.
--
-- Enum value lives in THIS file, functions that reference it in the next
-- (20260907000100) — ALTER TYPE ... ADD VALUE cannot be referenced in the
-- same transaction (see 20260707000200 for the precedent).
--
-- Generation columns inline — the table is born generation-capable
-- (20260904000000 precedent).
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'AUDIT_CERTIFICATE_OBJECT';

CREATE TABLE audit_certificate_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  -- The approved report's readiness_fingerprint sealed by approve
  -- (audit_mode_approve_deliverable), cleared by demote-on-edit. NULL = not
  -- approved. Compare against the live fingerprint to detect a report that
  -- moved after this certificate was approved.
  basis_digest    TEXT,
  -- Grounded-generation provenance (set by the apply RPC, never by hand)
  generation_refs    JSONB
    CONSTRAINT audit_certificate_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  grounding_snapshot JSONB
    CONSTRAINT audit_certificate_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  generated_at       TIMESTAMPTZ
);

CREATE TRIGGER touch_audit_certificate_objects_updated_at
  BEFORE UPDATE ON audit_certificate_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE audit_certificate_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_certificate_objects_via_audit"
  ON audit_certificate_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
