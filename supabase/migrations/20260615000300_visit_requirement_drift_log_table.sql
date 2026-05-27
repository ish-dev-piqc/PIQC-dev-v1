-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5a (4 of 5):
-- visit_requirement_drift_log table.
--
-- Per parser-integration.md §8.4 + §7.3.
--
-- Append-only log of parser-text drift. Captures the before/after of
-- visit_requirements.derived_text across re-ingest cycles, plus the
-- current_text that was preserved through the change. Mirrors the
-- worksheet_review_events / visit_requirement_human_edits pattern: an
-- append-only forensic record for the audit timeline.
--
-- Two row shapes:
--   1. Initial-parse trace event:  parser_text_before IS NULL,
--                                  parser_text_after = the initial derived_text.
--   2. Drift event: both parser_text_before and parser_text_after populated.
--
-- Sprint 3.5b's ingest pipeline writes here when re-ingesting an existing
-- protocol and detecting that derived_text would change for an existing
-- requirement. The actual current_text never changes — the log just records
-- what the parser now sees so a human can decide to update.
-- =============================================================================

CREATE TABLE visit_requirement_drift_log (
  id                       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  requirement_id           UUID            NOT NULL REFERENCES visit_requirements(id) ON DELETE CASCADE,

  -- NULLABLE: the first log entry for a requirement has no "before" yet.
  -- A drift event always has both columns populated.
  parser_text_before       TEXT,
  parser_text_after        TEXT            NOT NULL,

  -- Snapshot of current_text at the time of the drift event. Lets the audit
  -- timeline answer "what was the auditor seeing when this drift happened?"
  -- without joining back to a point-in-time visit_requirements row.
  current_text_preserved   TEXT            NOT NULL,

  -- Correlates events from the same re-ingest run (Sprint 3.5b populates this
  -- from the ingest pipeline's per-run UUID). Nullable for legacy or manual
  -- entries.
  reingest_run_id          TEXT,

  detected_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);


-- Most common query: the drift timeline for one requirement, newest first.
CREATE INDEX visit_requirement_drift_log_req_idx
  ON visit_requirement_drift_log(requirement_id, detected_at DESC);


ALTER TABLE visit_requirement_drift_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "visit_requirement_drift_log_owner"
  ON visit_requirement_drift_log FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM visit_requirements r
        JOIN protocol_visit_templates t ON t.id = r.visit_template_id
        JOIN protocols p ON p.id = t.protocol_id
       WHERE r.id = visit_requirement_drift_log.requirement_id
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
       WHERE r.id = visit_requirement_drift_log.requirement_id
         AND (
           p.owner_id = auth.uid()
           OR p.owner_org_id IN (
             SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
           )
         )
    )
  );


COMMENT ON TABLE visit_requirement_drift_log IS
  'Append-only log of parser-text drift across re-ingest cycles. Records the '
  'parser_text_before/after delta plus the current_text that was preserved, '
  'so the audit timeline can show when the parser changed its mind and what '
  'the auditor was seeing at the time.';

COMMENT ON COLUMN visit_requirement_drift_log.parser_text_before IS
  'Previous derived_text. NULL on the first log entry (initial-parse trace).';

COMMENT ON COLUMN visit_requirement_drift_log.current_text_preserved IS
  'Snapshot of visit_requirements.current_text at the moment of drift. Column '
  'is NOT NULL — Sprint 3.5b writes the empty string when the source row''s '
  'current_text is NULL (i.e. no human edit yet).';
