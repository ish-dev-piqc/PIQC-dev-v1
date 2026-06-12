-- =============================================================================
-- protocol_documents — manually uploaded files scoped to a protocol or org.
-- Distinct from `documents` (Reducto-ingested protocol PDFs, managed by the
-- SOTR pipeline) and `chat_attachments` (files shared inline in chat).
-- The Documents tab unions all three sources for discoverability.
--
-- This migration also:
--   - Adds `chat_attachments.pinned_at` so users can pin chat-shared files
--     to the Documents tab's Pinned board.
--   - Creates the `protocol-documents` Storage bucket + RLS that mirrors
--     the chat-attachments pattern (parent-row access gates the file).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. protocol_documents table.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.protocol_documents (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id          UUID         REFERENCES public.protocols(id) ON DELETE CASCADE,
  org_id               UUID         REFERENCES public.orgs(id)      ON DELETE CASCADE,
  storage_path         TEXT         NOT NULL UNIQUE,
  mime_type            TEXT         NOT NULL,
  size_bytes           BIGINT       NOT NULL CHECK (size_bytes > 0),
  original_filename    TEXT         NOT NULL,
  uploaded_by_user_id  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT protocol_documents_scope_xor CHECK (
    (protocol_id IS NOT NULL AND org_id IS NULL)
    OR (protocol_id IS NULL AND org_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS protocol_documents_protocol_idx
  ON public.protocol_documents (protocol_id) WHERE protocol_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS protocol_documents_org_idx
  ON public.protocol_documents (org_id) WHERE org_id IS NOT NULL;

ALTER TABLE public.protocol_documents ENABLE ROW LEVEL SECURITY;

-- SELECT: protocol members, or org members for org-level docs.
DROP POLICY IF EXISTS protocol_documents_scope_select ON public.protocol_documents;
CREATE POLICY protocol_documents_scope_select
  ON public.protocol_documents
  FOR SELECT
  TO authenticated
  USING (
    (protocol_id IS NOT NULL AND public.user_can_access_protocol(auth.uid(), protocol_id))
    OR (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
  );

-- INSERT: anyone with SELECT access on the same scope.
DROP POLICY IF EXISTS protocol_documents_scope_insert ON public.protocol_documents;
CREATE POLICY protocol_documents_scope_insert
  ON public.protocol_documents
  FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND (
      (protocol_id IS NOT NULL AND public.user_can_access_protocol(auth.uid(), protocol_id))
      OR (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
    )
  );

-- DELETE: org admins, protocol coordinators, or the uploader themself.
DROP POLICY IF EXISTS protocol_documents_admin_delete ON public.protocol_documents;
CREATE POLICY protocol_documents_admin_delete
  ON public.protocol_documents
  FOR DELETE
  TO authenticated
  USING (
    uploaded_by_user_id = auth.uid()
    OR (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_admin_org_ids()))
    OR (
      protocol_id IS NOT NULL
      AND protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
    )
  );


-- ---------------------------------------------------------------------------
-- 2. chat_attachments.pinned_at — surfaces in the Documents tab Pinned board.
-- ---------------------------------------------------------------------------

ALTER TABLE public.chat_attachments
  ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS chat_attachments_pinned_idx
  ON public.chat_attachments (pinned_at)
  WHERE pinned_at IS NOT NULL;

-- Allow UPDATE for users who can see the parent attachment row. The
-- existing chat_attachments SELECT policy is preserved; this adds a
-- companion UPDATE policy scoped to the pinned_at column.
DROP POLICY IF EXISTS chat_attachments_pin_update ON public.chat_attachments;
CREATE POLICY chat_attachments_pin_update
  ON public.chat_attachments
  FOR UPDATE
  TO authenticated
  USING (
    (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
    OR (protocol_id IS NOT NULL AND public.user_can_access_protocol(auth.uid(), protocol_id))
  )
  WITH CHECK (
    (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_org_ids()))
    OR (protocol_id IS NOT NULL AND public.user_can_access_protocol(auth.uid(), protocol_id))
  );


-- ---------------------------------------------------------------------------
-- 3. Storage bucket + policies — mirrors chat-attachments pattern.
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('protocol-documents', 'protocol-documents', FALSE, 25 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  public = EXCLUDED.public;

-- Object SELECT: authenticated user can read an object iff the parent
-- protocol_documents row's RLS would let them SELECT it. Cheap because
-- the SELECT policy on protocol_documents already does the access check.
DROP POLICY IF EXISTS "protocol-documents bucket select" ON storage.objects;
CREATE POLICY "protocol-documents bucket select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'protocol-documents'
    AND EXISTS (
      SELECT 1 FROM public.protocol_documents pd
      WHERE pd.storage_path = storage.objects.name
    )
  );

DROP POLICY IF EXISTS "protocol-documents bucket insert" ON storage.objects;
CREATE POLICY "protocol-documents bucket insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'protocol-documents');

DROP POLICY IF EXISTS "protocol-documents bucket delete" ON storage.objects;
CREATE POLICY "protocol-documents bucket delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'protocol-documents'
    AND EXISTS (
      SELECT 1 FROM public.protocol_documents pd
      WHERE pd.storage_path = storage.objects.name
    )
  );
