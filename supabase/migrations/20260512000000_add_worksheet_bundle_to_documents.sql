-- Sprint 1B: Add worksheet_bundle column to documents.
-- Stored as a separate column alongside extracted_fields (Reducto raw output) on the same row
-- so that re-ingesting a document does not overwrite a compiled worksheet bundle.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS worksheet_bundle JSONB;
