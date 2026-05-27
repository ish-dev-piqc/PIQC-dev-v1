-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (5 of 7): visit_source_fields.
--
-- Form-field scaffolds for source document capture during the visit. Each
-- row describes one piece of data the site coordinator must record at
-- execution time (e.g. "Systolic BP" — number, mmHg, normal range 90-140).
--
-- Sprint 2.5 creates the table. Sprint 3 parser populates from
-- procedures_structured[].source_fields[]. Sprint 4 will add the human
-- form-fill UI; Sprint 1 currently only surfaces the COUNT of source
-- fields on each checklist row.
-- =============================================================================

CREATE TYPE source_field_type AS ENUM (
  'text',
  'number',
  'boolean',
  'select',
  'date'
);


CREATE TABLE visit_source_fields (
  id             UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id UUID                NOT NULL REFERENCES visit_requirements(id) ON DELETE CASCADE,

  -- Render order within a requirement.
  ordinal        INTEGER             NOT NULL DEFAULT 0,

  field_label    TEXT                NOT NULL,
  field_type     source_field_type   NOT NULL DEFAULT 'text',

  -- Display-only metadata. Null when not applicable.
  units          TEXT,
  normal_range   TEXT,

  is_required    BOOLEAN             NOT NULL DEFAULT FALSE,

  created_at     TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);


CREATE INDEX visit_source_fields_req_idx
  ON visit_source_fields(requirement_id);


-- Trigger keeps visit_requirements.has_source_fields in sync so the
-- workspace UI can render the "N source fields" indicator without a join.
CREATE OR REPLACE FUNCTION _vew_touch_has_source_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_req_id UUID;
BEGIN
  v_req_id := COALESCE(NEW.requirement_id, OLD.requirement_id);
  UPDATE visit_requirements
     SET has_source_fields = EXISTS (
       SELECT 1 FROM visit_source_fields WHERE requirement_id = v_req_id
     )
   WHERE id = v_req_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER vew_source_fields_touch_after_insert
  AFTER INSERT ON visit_source_fields
  FOR EACH ROW EXECUTE FUNCTION _vew_touch_has_source_fields();

CREATE TRIGGER vew_source_fields_touch_after_delete
  AFTER DELETE ON visit_source_fields
  FOR EACH ROW EXECUTE FUNCTION _vew_touch_has_source_fields();


ALTER TABLE visit_source_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_source_fields_owner"
  ON visit_source_fields FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_source_fields.requirement_id
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
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_source_fields.requirement_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_source_fields IS
  'Source-document capture scaffolds per requirement. Sprint 1 surfaces '
  'counts only; full form-fill is Sprint 4. Trigger keeps '
  'visit_requirements.has_source_fields in sync.';
