-- =============================================================================
-- documents — async ingest support: content hash for dedup + reuse of the
-- existing reducto_job_id column for tracking in-flight async parses.
--
-- Motivation: today's /ingest function holds the HTTP connection open for the
-- entire Reducto parse + extract + embedding pipeline, which exceeds the
-- 150-second wall-clock cap on long protocols (504 IDLE_TIMEOUT). The async
-- refactor moves Reducto's parse off-cycle (their cloud → Svix webhook → our
-- /reducto-webhook). For that we need:
--
--   1. A content_hash column so re-uploading the same PDF (e.g., after a
--      page reload mid-parse) short-circuits to the existing in-flight or
--      completed document_id instead of triggering a second parse.
--   2. The existing reducto_job_id column is reused for the async parse job
--      id — no schema change needed for that, but documented here for the
--      reader.
--
-- The (user_id, content_hash) index supports the dedup-lookup SELECT in the
-- restructured /ingest. NOT a unique constraint — a row in status='failed'
-- should be re-tryable, not eternally blocked.
-- =============================================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS content_hash TEXT;

CREATE INDEX IF NOT EXISTS documents_user_hash_idx
  ON public.documents (user_id, content_hash)
  WHERE content_hash IS NOT NULL;
