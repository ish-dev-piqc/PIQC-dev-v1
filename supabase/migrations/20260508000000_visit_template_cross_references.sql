-- =============================================================================
-- Phase B (calendar cross-doc consistency check) — migration B1.
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
--       "document_id": "uuid-of-source-document"   -- optional; null for
--                                                    -- intra-document refs
--                                                    -- pulled from the same
--                                                    -- doc that produced the
--                                                    -- SoA row.
--     },
--     ...
--   ]
--
-- A null/empty array means "no cross-references found" and the UI hides the
-- section entirely. The frontend renders these grouped by source_section in
-- VisitDetailDrawer; nothing else consumes this column today.
--
-- The column is populated by the `ingest` Edge Function — extending the
-- Reducto Extract schema to return cross_references per visit (Phase B2)
-- and by a follow-up cross-document fan-out pass (Phase B3) when a
-- non-SoA document is ingested against a protocol with existing templates.
--
-- Default '[]'::jsonb so existing rows don't break the frontend join.
-- =============================================================================

ALTER TABLE protocol_visit_templates
  ADD COLUMN cross_references JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN protocol_visit_templates.cross_references IS
  'Aggregated mentions of this visit elsewhere in the protocol documents — '
  'array of { source_section, snippet, page?, document_id? }. Populated by '
  'the ingest pipeline; rendered in VisitDetailDrawer.';
