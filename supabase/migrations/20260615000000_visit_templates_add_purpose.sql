-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5a (1 of 5):
-- Add purpose + parser_confidence columns to protocol_visit_templates.
--
-- Per parser-integration.md §8.1:
--   purpose             — LLM-generated 1-3 sentence visit purpose statement.
--                         Populated by Sprint 3.5b's purpose-prose extraction
--                         LLM pass. NULL on pre-Sprint-3.5b rows.
--   parser_confidence   — Reducto/LLM confidence in the structured extraction
--                         for this visit. Surfaces in the snapshot card so the
--                         user knows when to look closer. NULL until 3.5b.
--
-- Both columns are nullable + additive — no impact on existing readers.
-- Sprint 2.5 RPC body (visit_execution_get_workspace) currently falls back
-- to a hard-coded placeholder string for purpose; migration 5 in this batch
-- (20260615000400_visit_execution_get_workspace_v2.sql) updates that RPC to
-- read this column once it exists.
--
-- confidence_state enum was created in 20260508000000_sotr_schema.sql. Cross-
-- namespace reuse of a primitive Postgres type is acceptable (it's not a code
-- import — no mode-isolation concern).
-- =============================================================================

ALTER TABLE protocol_visit_templates
  ADD COLUMN purpose             TEXT,
  ADD COLUMN parser_confidence   confidence_state;


COMMENT ON COLUMN protocol_visit_templates.purpose IS
  'LLM-generated 1-3 sentence purpose statement for this visit, produced by '
  'Sprint 3.5b''s purpose-prose extraction pass. NULL means extraction failed '
  'or the row predates Sprint 3.5b.';

COMMENT ON COLUMN protocol_visit_templates.parser_confidence IS
  'Confidence in the structured extraction for this visit (procedures_structured, '
  'window, purpose). NULL until Sprint 3.5b ingest pipeline writes it.';
