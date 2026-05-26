-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (4 of 7): visit_timing_rules.
--
-- Per-requirement timing constraints. Distinct from visit-level window
-- (which stays on protocol_visit_templates.window_minus_days / plus_days);
-- this is for finer constraints like "PK sample within 30 min of dosing"
-- or "vital signs 60 minutes ± 5 min post-dose".
--
-- 0-or-1 per requirement enforced by UNIQUE(requirement_id).
-- =============================================================================

CREATE TABLE visit_timing_rules (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id           UUID        NOT NULL UNIQUE REFERENCES visit_requirements(id) ON DELETE CASCADE,

  label                    TEXT        NOT NULL,
  -- Asymmetric windows: e.g. "must be done within 30 minutes BEFORE dosing"
  -- = window_before_minutes=30, window_after_minutes=0. Null = no constraint
  -- on that side.
  window_before_minutes    INTEGER,
  window_after_minutes     INTEGER,

  -- true  = protocol-mandated, no slip allowed (rendered amber-bold)
  -- false = guideline, slip permitted (rendered subdued)
  is_hard_constraint       BOOLEAN     NOT NULL DEFAULT FALSE,

  source_section           TEXT,

  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defensive: at least one of the window bounds should be non-null, or
  -- the label should describe a relative timing the bounds can't capture.
  -- Not enforced via CHECK because Sprint 1 fixture has rows like
  -- "Specimen must be drawn fasting" with both windows null but a label
  -- that's still meaningful.
  CHECK (
    window_before_minutes IS NULL
    OR window_before_minutes >= 0
  ),
  CHECK (
    window_after_minutes IS NULL
    OR window_after_minutes >= 0
  )
);


ALTER TABLE visit_timing_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_timing_rules_owner"
  ON visit_timing_rules FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_timing_rules.requirement_id
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
       WHERE r.id = visit_timing_rules.requirement_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_timing_rules IS
  'Per-requirement timing constraint. 0-or-1 per requirement. Visit-level '
  'windows stay on protocol_visit_templates.window_minus_days/plus_days.';
