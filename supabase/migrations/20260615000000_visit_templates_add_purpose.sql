-- =============================================================================
-- Visit Execution Workspace — Sprint 3.5a (1 of 5):
-- Add purpose + confidence_state columns to protocol_visit_templates.
--
-- Per parser-integration.md §8.1:
--   purpose             — LLM-generated 1-3 sentence visit purpose statement.
--                         Populated by Sprint 3.5b's purpose-prose extraction
--                         LLM pass. NULL on pre-Sprint-3.5b rows.
--   confidence_state    — Reducto/LLM confidence in the structured extraction
--                         for this visit. Surfaces on the snapshot card so the
--                         user knows when to look closer. NULL until 3.5b.
--
-- Both columns are nullable + additive — no impact on existing readers.
-- Sprint 2.5 RPC body (visit_execution_get_workspace) currently falls back
-- to a hard-coded placeholder string for purpose; migration 5 in this batch
-- (20260615000400_visit_execution_get_workspace_v2.sql) updates that RPC to
-- read this column once it exists.
--
-- Naming: protocol_extracted_items.confidence_state already exists with the
-- same SOTR enum; same semantic ("how confident is the parser in this thing").
-- Reusing the column name keeps the cross-domain mental model consistent.
-- Cross-namespace SQL enum reuse is acceptable — it's a primitive Postgres
-- type, not a code import (no mode-isolation concern).
--
-- NOT the same as visit_completeness_signals.detection_confidence — that one
-- answers "is this detected gap real?" rather than "is this extraction
-- correct?". Different semantic, kept under a different name to avoid drift.
-- =============================================================================

ALTER TABLE protocol_visit_templates
  ADD COLUMN purpose             TEXT,
  ADD COLUMN confidence_state    confidence_state;


COMMENT ON COLUMN protocol_visit_templates.purpose IS
  'LLM-generated 1-3 sentence purpose statement for this visit, produced by '
  'Sprint 3.5b''s purpose-prose extraction pass. NULL means extraction failed '
  'or the row predates Sprint 3.5b.';

COMMENT ON COLUMN protocol_visit_templates.confidence_state IS
  'Confidence in the structured extraction for this visit (procedures_structured, '
  'window, purpose). Same SOTR enum semantic as protocol_extracted_items.confidence_state. '
  'NULL until Sprint 3.5b ingest pipeline writes it.';
