-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (2 of 7): visit_requirements.
--
-- The core new table. One row per execution-ready requirement for a visit.
-- A single SoA cell (e.g. "Labs" at V3) may decompose into multiple
-- visit_requirements rows after Sprint 3 ingest enrichment.
--
-- Two-text-column design (mirrors protocol_extracted_items pattern):
--   derived_text  — parser output, FROZEN at ingest time. Re-ingest only
--                   overwrites when current_text is NULL.
--   current_text  — human-edited text. Takes precedence in the UI when set.
--
-- Traceability — preserves the existing SOTR chain rather than duplicating:
--   visit_requirements.extracted_item_id
--     → protocol_extracted_items.id
--     → protocol_item_evidence_links.extracted_item_id
--     → protocol_source_evidence.id   (page, section, bbox, quoted_text)
--
-- RLS — mirrors the canonical owner-scoped RLS v2 pattern from
-- 20260520000200_owner_scoped_rls_v2.sql. Joins through protocol_visit_templates
-- to reach protocols.owner_id / owner_org_id.
-- =============================================================================

CREATE TABLE visit_requirements (
  id                  UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_template_id   UUID                    NOT NULL REFERENCES protocol_visit_templates(id) ON DELETE CASCADE,

  -- Display ordering within a (visit, phase) bucket. ExecutionChecklist
  -- iterates EXECUTION_PHASE_ORDER then sorts by ordinal within each phase.
  ordinal             INTEGER                 NOT NULL,

  phase               execution_phase         NOT NULL DEFAULT 'assessment',
  classification      item_classification     NOT NULL DEFAULT 'required',
  origin              requirement_origin      NOT NULL DEFAULT 'soa_cell',

  -- Parser output, frozen at ingest. Never overwritten when current_text is set.
  derived_text        TEXT                    NOT NULL,
  -- Human-edited text. NULL = show derived_text. Set by visit_execution_edit_text RPC.
  current_text        TEXT,
  -- Optional additional context for the row (parser-extracted description).
  description         TEXT,

  -- "Coordinator", "Nurse", "Pharmacist + Coordinator" — free text from parser.
  role_hint           TEXT,
  -- Convenience flag — true if there's at least one visit_source_fields row.
  -- Maintained by trigger; lets the UI render the source-field indicator
  -- without a join.
  has_source_fields   BOOLEAN                 NOT NULL DEFAULT FALSE,

  -- Per-item traceability columns (visit-level traceability stays on
  -- protocol_visit_templates.cross_references JSONB).
  extracted_item_id   UUID                    REFERENCES protocol_extracted_items(id) ON DELETE SET NULL,
  protocol_section    TEXT,
  protocol_page       INTEGER,
  soa_column          TEXT,
  amendment_version   TEXT,

  -- Local review state — most-recent value. Full history in
  -- visit_requirement_human_edits.
  review_status       execution_review_status NOT NULL DEFAULT 'not_reviewed',
  review_note         TEXT,

  -- Increments only on edit_text action (mirrors protocol_extracted_items.version).
  version             INTEGER                 NOT NULL DEFAULT 1,

  created_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  UNIQUE (visit_template_id, ordinal)
);


-- Most common query: all requirements for one visit, grouped by phase.
CREATE INDEX visit_requirements_visit_idx
  ON visit_requirements(visit_template_id);
CREATE INDEX visit_requirements_phase_idx
  ON visit_requirements(visit_template_id, phase);

-- Reverse lookup from a SOTR extracted item to which visit requirements
-- reference it. Sparse — most requirements won't have an extracted_item_id
-- linked until Sprint 3 parser enrichment lands.
CREATE INDEX visit_requirements_extracted_item_idx
  ON visit_requirements(extracted_item_id)
  WHERE extracted_item_id IS NOT NULL;


-- updated_at maintenance — reuses the audit_mode_touch_updated_at function
-- (despite the name; it's been used by site-mode and SOTR migrations too).
CREATE TRIGGER touch_visit_requirements_updated_at
  BEFORE UPDATE ON visit_requirements
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


ALTER TABLE visit_requirements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_requirements_owner"
  ON visit_requirements FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM protocol_visit_templates t
        JOIN protocols p ON p.id = t.protocol_id
       WHERE t.id = visit_requirements.visit_template_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM protocol_visit_templates t
        JOIN protocols p ON p.id = t.protocol_id
       WHERE t.id = visit_requirements.visit_template_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_requirements IS
  'Execution-ready requirements per visit template. One row per item in the '
  'workflow-ordered checklist of the Visit Execution Workspace. Sprint 2.5 '
  'creates the table empty; Sprint 3 (parser enrichment) populates it from '
  'the extended CLINICAL_EXTRACT_SCHEMA in supabase/functions/ingest/.';

COMMENT ON COLUMN visit_requirements.derived_text IS
  'Parser output. Frozen at ingest. Never overwritten while current_text IS NOT NULL.';
COMMENT ON COLUMN visit_requirements.current_text IS
  'Human-edited text. NULL means show derived_text. Set by visit_execution_edit_text RPC.';
COMMENT ON COLUMN visit_requirements.version IS
  'Increments only on the edit_text human action. Captured into '
  'visit_requirement_human_edits.requirement_version at the time of each action.';
