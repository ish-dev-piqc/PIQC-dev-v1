-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (3 of 7): visit_conditional_rules.
--
-- If/then rules derived from protocol footnotes that govern a specific
-- requirement (e.g. "If subject is of childbearing potential, perform
-- pregnancy testing before dosing"). Rules render inline as collapsed
-- amber callouts under the parent requirement in the UI.
--
-- A single requirement may have 0..N rules; ordinal preserves render order
-- when there are multiple.
-- =============================================================================

CREATE TABLE visit_conditional_rules (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id     UUID        NOT NULL REFERENCES visit_requirements(id) ON DELETE CASCADE,

  -- Render order within a requirement (0-based).
  ordinal            INTEGER     NOT NULL DEFAULT 0,

  condition_text     TEXT        NOT NULL,
  consequence_text   TEXT        NOT NULL,

  -- Where in the protocol the rule was derived from. Sparse; null when the
  -- parser couldn't localize the source.
  source_section     TEXT,
  source_page        INTEGER,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX visit_conditional_rules_req_idx
  ON visit_conditional_rules(requirement_id);


ALTER TABLE visit_conditional_rules ENABLE ROW LEVEL SECURITY;

-- Inherit visibility from the parent requirement's protocol ownership.
CREATE POLICY "visit_conditional_rules_owner"
  ON visit_conditional_rules FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_conditional_rules.requirement_id
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
       WHERE r.id = visit_conditional_rules.requirement_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_conditional_rules IS
  'If/then rules attached to a visit_requirement. Translated from protocol '
  'footnotes and cross-references by the Sprint 3 parser enrichment. Renders '
  'as inline amber callout under the parent requirement in the workspace.';
