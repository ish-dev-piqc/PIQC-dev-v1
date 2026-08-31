-- =============================================================================
-- Audit Mode — evidence gap summary: schema slice (PR-D3)
--
-- 5th Stage-5 deliverable (v8's evidence_gap_summary): a generated document
-- checking scope coverage against collected evidence — per scope area (risk
-- summary focus areas / operational domains), what evidence exists in the
-- register and what is outstanding. Withheld register rows
-- (include_in_generation = false) are named as withheld by title, never
-- silently absent — and their content never reaches generation.
-- Letter-shaped content ({body_text, scope}); scope carries the area list.
--
-- Non-gating by design: the 5→6 gate stays {letter, agenda, checklist}
-- (20260730000000 untouched). This deliverable only carries its own
-- DRAFT/APPROVED latch.
--
-- Enum value lives in THIS file, functions that reference it in the next
-- (20260905000100) — ALTER TYPE ... ADD VALUE cannot be referenced in the
-- same transaction (see 20260707000200 for the precedent).
--
-- Generation columns inline — the table is born generation-capable
-- (20260904000000 precedent).
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'EVIDENCE_GAP_SUMMARY_OBJECT';

CREATE TABLE evidence_gap_summary_objects (
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
    CONSTRAINT evidence_gap_summary_generation_refs_is_array
    CHECK (generation_refs IS NULL OR jsonb_typeof(generation_refs) = 'array'),
  grounding_snapshot JSONB
    CONSTRAINT evidence_gap_summary_grounding_snapshot_is_object
    CHECK (grounding_snapshot IS NULL OR jsonb_typeof(grounding_snapshot) = 'object'),
  generated_at       TIMESTAMPTZ
);

CREATE TRIGGER touch_evidence_gap_summary_objects_updated_at
  BEFORE UPDATE ON evidence_gap_summary_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE evidence_gap_summary_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evidence_gap_summary_objects_via_audit"
  ON evidence_gap_summary_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
