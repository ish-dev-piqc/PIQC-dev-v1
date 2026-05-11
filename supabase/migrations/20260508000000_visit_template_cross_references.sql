-- =============================================================================
-- Phase B — calendar cross-doc consistency check.
--
-- Adds a `cross_references` JSONB column to protocol_visit_templates so the
-- ingest pipeline can attach every additional mention of a visit found
-- elsewhere in the protocol's documents.
--
-- Expected shape (array of objects):
--   [
--     {
--       "source_section": "7.4 Safety monitoring",
--       "snippet": "On Day 1, vital signs must be recorded prior to dosing.",
--       "page": 27,
--       "document_id": "uuid-of-source-document"
--     },
--     ...
--   ]
--
-- A null/empty array means "no cross-references found" and the UI hides the
-- section entirely. Frontend renders these grouped by source_section in
-- the visit drawer; nothing else consumes this column today.
--
-- Populated by the `ingest` Edge Function — both via the extended Reducto
-- Extract schema (intra-document references) and via a cross-document
-- fan-out pass that scans sibling documents tagged to the same protocol.
-- =============================================================================

ALTER TABLE protocol_visit_templates
  ADD COLUMN cross_references JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN protocol_visit_templates.cross_references IS
  'Aggregated mentions of this visit elsewhere in the protocol documents — '
  'array of { source_section, snippet, page?, document_id? }. Populated by '
  'the ingest pipeline; rendered in the visit drawer.';
