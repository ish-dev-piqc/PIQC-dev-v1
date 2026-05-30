-- Add filename to documents so an uploaded protocol's title can be traced back
-- to its source file. Populated by the ingest edge function from the original
-- PDF name. Nullable — rows created before this column predate filename capture.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS filename text;
