-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-4: PDF storage + secure access.
--
-- Foundation for the embedded PDF viewer (deferred to PR-5). This migration
-- only sets up the *retention + access* layer:
--
--   1. documents.storage_path TEXT NULL — set by ingest after the PDF is
--      written to the protocol-pdfs bucket. NULL means "ingested before this
--      PR landed" or "no PDF was uploaded for this row" — UI hides the PDF
--      action gracefully.
--
--   2. storage.buckets row — private bucket protocol-pdfs, 50 MB limit,
--      application/pdf only. Same size cap as ingest's MAX_BODY_BYTES.
--
--   3. RLS on storage.objects — users can SELECT objects they own (path
--      convention: "{user_id}/{document_id}.pdf"; folder check via
--      storage.foldername()[1]). The ingest edge function uses the service
--      role and bypasses these policies on UPLOAD.
--
--   4. sotr_get_protocol_pdf_storage_path RPC — validates ownership AND
--      study membership, then returns the path. Caller signs the URL via
--      the client storage SDK so the signed URL never appears in DB logs.
--
-- No PDF viewer in this PR — see PR-5.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- documents.storage_path
-- ---------------------------------------------------------------------------

ALTER TABLE documents ADD COLUMN storage_path TEXT;

CREATE INDEX documents_storage_path_idx ON documents(storage_path)
  WHERE storage_path IS NOT NULL;

COMMENT ON COLUMN documents.storage_path IS
  'Object key in the protocol-pdfs bucket. NULL means no PDF retained '
  'for this document. Convention: "{user_id}/{document_id}.pdf".';


-- ---------------------------------------------------------------------------
-- protocol-pdfs bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'protocol-pdfs',
  'protocol-pdfs',
  false,                              -- private — never public
  52428800,                           -- 50 MB; matches ingest MAX_BODY_BYTES
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
  public             = EXCLUDED.public,
  file_size_limit    = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


-- ---------------------------------------------------------------------------
-- RLS on storage.objects for protocol-pdfs
--
-- Path convention: {user_id}/{document_id}.pdf
-- Users can read only objects in their own user_id folder. Service role
-- (used by ingest) bypasses RLS for INSERT.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "protocol_pdfs_owner_select" ON storage.objects;
CREATE POLICY "protocol_pdfs_owner_select"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'protocol-pdfs'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- We deliberately omit INSERT/UPDATE/DELETE policies for authenticated users:
-- direct uploads from the browser are not part of the SOTR flow. Ingest
-- (service role) handles writes; deletes happen via the documents cascade
-- pattern only if the user owns the document.


-- ---------------------------------------------------------------------------
-- sotr_get_protocol_pdf_storage_path
--
-- Returns the storage_path for the document iff:
--   - caller is authenticated
--   - caller owns the document
--   - the document belongs to the requested study (protocol_id)
--   - a PDF has been retained (storage_path IS NOT NULL)
--
-- Caller then passes the path to supabase.storage.createSignedUrl client-side.
-- The signed URL itself is never returned by the DB.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION sotr_get_protocol_pdf_storage_path(
  p_study_id    UUID,
  p_document_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_path TEXT;
  v_owned BOOLEAN := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Verify ownership + study membership (single SELECT, single error path
  -- on miss to avoid leaking existence-of-id signal).
  SELECT TRUE, storage_path
    INTO v_owned, v_path
    FROM documents
   WHERE id          = p_document_id
     AND user_id     = v_user
     AND protocol_id = p_study_id;

  IF NOT v_owned THEN
    RAISE EXCEPTION 'Document not found in study or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Document is owned but no PDF retained — distinct error so the UI can
  -- show "no PDF stored for this document" rather than a generic failure.
  IF v_path IS NULL THEN
    RAISE EXCEPTION 'No PDF retained for this document' USING ERRCODE = '02000';
  END IF;

  RETURN v_path;
END;
$$;
