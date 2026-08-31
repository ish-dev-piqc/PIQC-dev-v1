-- =============================================================================
-- Audit Mode — internal audit notification: schema slice (PR-D1)
--
-- 4th Stage-5 deliverable (v8's internal_audit_notification): a short document
-- addressed to INTERNAL stakeholders announcing the upcoming vendor audit and
-- inviting scope input before the opening meeting. Letter-shaped content
-- ({body_text, scope}) with NO recipients field — internal distribution
-- happens outside PIQC, and roles-only addressing keeps the deliverable
-- name-free end to end.
--
-- Non-gating by design: the 5→6 gate stays {letter, agenda, checklist}
-- (20260730000000 untouched). This deliverable only carries its own
-- DRAFT/APPROVED latch.
--
-- Enum value lives in THIS file, functions that reference it in the next
-- (20260904000100) — ALTER TYPE ... ADD VALUE cannot be referenced in the
-- same transaction (see 20260707000200 for the precedent).
--
-- Unlike the three phase-1 deliverables, the generation columns
-- (20260831000000/20260901000000 pattern) are inline here — the table is born
-- generation-capable.
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'INTERNAL_NOTIFICATION_OBJECT';

CREATE TABLE internal_notification_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  -- Grounded-generation provenance (set by the apply RPC, never by hand)
  generation_refs    JSONB
    CONSTRAINT internal_notification_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  grounding_snapshot JSONB
    CONSTRAINT internal_notification_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  generated_at       TIMESTAMPTZ
);

CREATE TRIGGER touch_internal_notification_objects_updated_at
  BEFORE UPDATE ON internal_notification_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE internal_notification_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "internal_notification_objects_via_audit"
  ON internal_notification_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
