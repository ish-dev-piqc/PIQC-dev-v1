-- =============================================================================
-- Audit Mode — findings report: schema slice (PR-D4)
--
-- 6th deliverable kind: the formal narrative document packaging the Stage-6
-- observation blocks for hand-off. Distinct from report_draft_objects (the
-- Stage-7 working report that gates Stage 8 — untouched). Non-gating.
--
-- SOURCE-OF-TRUTH RULE: content stores ONLY the connective narrative
-- ({intro_text, closing_text}). The observation blocks are NEVER copied in —
-- they derive live from audit_workspace_entry_objects at render/export time.
-- What makes the latch honest anyway is basis_digest: approving CAS-pins the
-- entry-set digest the reviewer saw (see 20260906000100), so "approved"
-- always names WHICH entry set it covered, and divergence is detectable.
--
-- Enum value lives in THIS file, functions that reference it in the next
-- (20260906000100) — ALTER TYPE ... ADD VALUE cannot be referenced in the
-- same transaction (see 20260707000200 for the precedent).
--
-- Generation columns inline — the table is born generation-capable
-- (20260904000000 precedent).
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'FINDINGS_REPORT_OBJECT';

CREATE TABLE findings_report_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  -- The entry-set digest sealed by approve (audit_mode_approve_deliverable),
  -- cleared by demote-on-edit. NULL = not approved, or approved before the
  -- basis pin existed (impossible here — the pin ships with the table).
  basis_digest    TEXT,
  -- Grounded-generation provenance (set by the apply RPC, never by hand)
  generation_refs    JSONB
    CONSTRAINT findings_report_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  grounding_snapshot JSONB
    CONSTRAINT findings_report_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  generated_at       TIMESTAMPTZ
);

CREATE TRIGGER touch_findings_report_objects_updated_at
  BEFORE UPDATE ON findings_report_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE findings_report_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "findings_report_objects_via_audit"
  ON findings_report_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
