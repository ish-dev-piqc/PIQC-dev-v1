/*
  # Chunk metadata + document ingest status

  Adds the metadata needed for citations (page numbers, section heading) and
  composable content-type filtering (block_types jsonb), plus a document
  ingest lifecycle so half-ingested docs don't leak into retrieval.

  ## Changes
  - chunks: page_start, page_end, section_heading, block_types, is_boilerplate
  - chunks: GIN index on block_types for fast "contains type X" queries
  - documents: status ('pending' | 'ready' | 'failed'), error_message, updated_at
  - documents: trigger that keeps updated_at fresh
  - backfill: existing documents marked 'ready' (they've completed ingest)

  ## Notes
  - All new chunk columns are nullable. Existing rows keep NULL until re-ingested.
  - is_boilerplate is GENERATED STORED so it stays in sync with block_types.
  - COALESCE keeps is_boilerplate a strict boolean (false for NULL block_types).
*/

-- ─── Chunks: metadata columns ──────────────────────────────────────
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_start int;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS page_end int;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS section_heading text;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS block_types jsonb;

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS is_boilerplate boolean GENERATED ALWAYS AS (
  COALESCE(block_types <@ '["Footer", "Header"]'::jsonb, false)
) STORED;

CREATE INDEX IF NOT EXISTS chunks_block_types_gin_idx ON chunks USING gin(block_types);

-- ─── Documents: ingest lifecycle ───────────────────────────────────
ALTER TABLE documents ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Existing docs have finished ingest; mark them ready
UPDATE documents SET status = 'ready' WHERE status = 'pending';

-- Fail fast on invalid status values
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_status_check;
ALTER TABLE documents ADD CONSTRAINT documents_status_check
  CHECK (status IN ('pending', 'ready', 'failed'));

-- Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS documents_set_updated_at ON documents;
CREATE TRIGGER documents_set_updated_at
  BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
