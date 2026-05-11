-- =============================================================================
-- Phase B3 (calendar cross-doc consistency check) — persist Reducto job_id.
--
-- The `ingest` Edge Function uploads a PDF to Reducto and gets a parse job_id
-- back. Today the id only lives in memory for the duration of the ingest
-- call; once the function returns, there's no way to re-Extract against the
-- same parse output later.
--
-- For Phase B3 we need to call Reducto Extract on *previously-ingested*
-- documents with a fresh schema (the list of known visits from a newly
-- parsed SoA). Storing the job_id makes that possible without re-parsing
-- the PDF (which would double Reducto cost and require the original bytes
-- the function no longer has).
--
-- Nullable: documents ingested before this migration won't have a job_id
-- and are skipped by the fan-out path. Text-source ingests (no PDF) never
-- get a job_id either.
-- =============================================================================

ALTER TABLE documents
  ADD COLUMN reducto_job_id TEXT;

COMMENT ON COLUMN documents.reducto_job_id IS
  'Reducto Parse job_id used to drive Extract calls (jobid://...). Persisted '
  'so Phase B3 fan-out can re-Extract against past documents to surface '
  'cross-references to newly-known visits. Null for pre-B3 documents and for '
  'text-source ingests.';
