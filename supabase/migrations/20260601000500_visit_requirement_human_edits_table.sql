-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (6 of 7): visit_requirement_human_edits.
--
-- Append-only audit log of every state change to a visit_requirement.
-- Mirrors the worksheet_review_events pattern from SOTR PR-5
-- (20260508040000_sotr_draft_review_schema.sql).
--
-- The base table (visit_requirements) holds the latest state for fast reads.
-- This table holds the full history for compliance reconstruction.
--
-- Sprint 2.5 creates the table empty. Sprint 4 (human review/edit loop)
-- wires the writes via the visit_execution_set_review_status and
-- visit_execution_edit_text RPCs in 20260601000600. Sprint 1's existing UI
-- (review state cycling, ⋯ overflow menu) is currently client-local and
-- moves to RPC-backed when Sprint 4 lands.
-- =============================================================================

-- Naming: the SOTR equivalent uses draft_review_action. This enum is
-- SEMANTICALLY DIFFERENT — visit-execution review tracks "ready to execute",
-- not "parser output accurate". Don't reuse the SOTR enum.
CREATE TYPE visit_requirement_edit_action AS ENUM (
  'mark_reviewed',
  'unmark_reviewed',
  'edit_text',
  'add_site_note',
  'flag_for_review',
  'mark_needs_clarification'
);


CREATE TABLE visit_requirement_human_edits (
  id                       UUID                          PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id           UUID                          NOT NULL REFERENCES visit_requirements(id) ON DELETE CASCADE,
  reviewer_id              UUID                          NOT NULL REFERENCES auth.users(id),
  action                   visit_requirement_edit_action NOT NULL,

  -- For edit_text only. NULL for non-edit actions.
  previous_text            TEXT,
  new_text                 TEXT,

  -- Sensitive. Never log. Site coordinator's free-text note (e.g. "site
  -- uses different lab kit at this location").
  reviewer_note            TEXT,

  -- Captured at moment of action — snapshots the protocol context so the
  -- edit history is self-contained even if the parent requirement is
  -- re-ingested or the protocol is amended.
  requirement_version      INTEGER                       NOT NULL,
  protocol_id              UUID                          NOT NULL REFERENCES protocols(id),
  amendment_version        TEXT,

  created_at               TIMESTAMPTZ                   NOT NULL DEFAULT NOW()
);


-- All edits for a requirement, newest first (timeline view).
CREATE INDEX visit_requirement_human_edits_req_idx
  ON visit_requirement_human_edits(requirement_id, created_at DESC);

-- All edits by a specific reviewer (audit / activity reports).
CREATE INDEX visit_requirement_human_edits_reviewer_idx
  ON visit_requirement_human_edits(reviewer_id, created_at DESC);

-- All edits by action type within a requirement (e.g. "show me only the
-- text edits, not the review-state toggles").
CREATE INDEX visit_requirement_human_edits_action_idx
  ON visit_requirement_human_edits(requirement_id, action);


ALTER TABLE visit_requirement_human_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_requirement_human_edits_owner"
  ON visit_requirement_human_edits FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_requirement_human_edits.requirement_id
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
       WHERE r.id = visit_requirement_human_edits.requirement_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_requirement_human_edits IS
  'Append-only event log of human edits to visit_requirements. Append-only '
  'is enforced by convention (no UPDATE/DELETE policies); rows survive their '
  'requirement via ON DELETE CASCADE only when the requirement itself is '
  'dropped (rare; happens on protocol-level deletes).';
