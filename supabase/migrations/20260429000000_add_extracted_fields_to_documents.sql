-- Stores structured fields extracted by Reducto Extract after PDF ingestion.
-- Nullable so existing documents and plain-text ingestions are unaffected.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extracted_fields JSONB;
