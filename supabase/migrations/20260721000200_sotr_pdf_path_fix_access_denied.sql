-- =============================================================================
-- SOTR — fix dead access-denied branch in sotr_get_protocol_pdf_storage_path
-- (found by the extended smoke suite while verifying the post-#449 fixes).
--
-- The original body (20260508030000) did:
--
--   SELECT TRUE, storage_path INTO v_owned, v_path FROM documents WHERE ...;
--   IF NOT v_owned THEN RAISE ... 42501 'access denied';
--
-- On a lookup miss, SELECT ... INTO sets v_owned to NULL — not FALSE — and
-- `IF NOT NULL` is not true, so the 42501 branch is unreachable. Every
-- unauthorized or nonexistent (document, study) probe fell through to the
-- 02000 'No PDF retained' branch instead of being denied. No path/content
-- ever leaked (v_path is NULL on a miss), but the UI shows "no PDF stored"
-- where it should show access denied, and the intended single-error-path
-- design was not actually in effect.
--
-- Fix: test FOUND instead of the trapped boolean. Ownership semantics,
-- SECURITY INVOKER, and grants are unchanged (document.user_id = caller AND
-- protocol_id = study; RLS still applies inside the function).
--
-- Owner: @ish-dev-piqc (SOTR).
-- =============================================================================

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
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Verify ownership + study membership (single SELECT, single error path
  -- on miss to avoid leaking existence-of-id signal).
  SELECT storage_path
    INTO v_path
    FROM documents
   WHERE id          = p_document_id
     AND user_id     = v_user
     AND protocol_id = p_study_id;

  IF NOT FOUND THEN
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
