-- =============================================================================
-- chat_attachments — file attachments tied to a chat message.
--
-- One row per attachment. Files live in the `chat-attachments` Supabase
-- Storage bucket at `<uploader_user_id>/<uuid>-<filename>`; the
-- `storage_path` column stores that path. Storage RLS gates SELECT on
-- the path against the parent message's channel access (so removing
-- the chat_attachments row, or losing access to the channel, also
-- denies the storage read).
--
-- Channel xor matches chat_mentions / chat_decisions. ON DELETE CASCADE
-- on the message FKs cleans up the rows when the message is deleted;
-- the Storage objects themselves are NOT removed by the cascade — a
-- background sweep can clean orphans later (Storage RLS denies SELECT
-- anyway once the row is gone, so orphan files are inaccessible).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Storage bucket
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('chat-attachments', 'chat-attachments', FALSE, 10 * 1024 * 1024)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  public = EXCLUDED.public;


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_message_id           UUID         REFERENCES public.org_messages(id)      ON DELETE CASCADE,
  protocol_message_id      UUID         REFERENCES public.protocol_messages(id) ON DELETE CASCADE,
  org_id                   UUID         REFERENCES public.orgs(id)              ON DELETE CASCADE,
  protocol_id              UUID         REFERENCES public.protocols(id)         ON DELETE CASCADE,
  storage_path             TEXT         NOT NULL UNIQUE,
  mime_type                TEXT         NOT NULL,
  size_bytes               BIGINT       NOT NULL CHECK (size_bytes > 0),
  original_filename        TEXT         NOT NULL,
  uploaded_by_user_id      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chat_attachments_channel_xor CHECK (
    (org_message_id IS NOT NULL AND protocol_message_id IS NULL
      AND org_id IS NOT NULL AND protocol_id IS NULL)
    OR
    (org_message_id IS NULL AND protocol_message_id IS NOT NULL
      AND org_id IS NULL AND protocol_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS chat_attachments_org_message_id_idx
  ON public.chat_attachments(org_message_id) WHERE org_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_attachments_protocol_message_id_idx
  ON public.chat_attachments(protocol_message_id) WHERE protocol_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_attachments_org_id_idx
  ON public.chat_attachments(org_id, created_at DESC) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_attachments_protocol_id_idx
  ON public.chat_attachments(protocol_id, created_at DESC) WHERE protocol_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- RLS — mirror message access
-- ---------------------------------------------------------------------------
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chat_attachments_channel_select" ON public.chat_attachments
  FOR SELECT TO authenticated
  USING (
    (org_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.org_members om
      WHERE om.org_id = chat_attachments.org_id
        AND om.user_id = auth.uid()
    ))
    OR
    (protocol_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.protocol_members pm
        WHERE pm.protocol_id = chat_attachments.protocol_id
          AND pm.user_id = auth.uid()
          AND pm.role IN ('coordinator', 'member')
      )
      OR EXISTS (
        SELECT 1 FROM public.protocols p
        WHERE p.id = chat_attachments.protocol_id
          AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
      )
    ))
  );

CREATE POLICY "chat_attachments_channel_insert" ON public.chat_attachments
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by_user_id = auth.uid()
    AND (
      (org_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.org_members om
        WHERE om.org_id = chat_attachments.org_id
          AND om.user_id = auth.uid()
      ))
      OR
      (protocol_id IS NOT NULL AND (
        EXISTS (
          SELECT 1 FROM public.protocol_members pm
          WHERE pm.protocol_id = chat_attachments.protocol_id
            AND pm.user_id = auth.uid()
            AND pm.role IN ('coordinator', 'member')
        )
        OR EXISTS (
          SELECT 1 FROM public.protocols p
          WHERE p.id = chat_attachments.protocol_id
            AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
        )
      ))
    )
  );

CREATE POLICY "chat_attachments_self_admin_coordinator_delete" ON public.chat_attachments
  FOR DELETE TO authenticated
  USING (
    uploaded_by_user_id = auth.uid()
    OR (org_id IS NOT NULL AND org_id IN (SELECT public.current_user_admin_org_ids()))
    OR (protocol_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.protocols p
        WHERE p.id = chat_attachments.protocol_id
          AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
      )
      OR EXISTS (
        SELECT 1 FROM public.protocol_members pm
        WHERE pm.protocol_id = chat_attachments.protocol_id
          AND pm.user_id = auth.uid()
          AND pm.role = 'coordinator'
      )
    ))
  );

-- No UPDATE policy — attachments are immutable.


-- ---------------------------------------------------------------------------
-- Storage RLS — gate object access via the chat_attachments row
-- ---------------------------------------------------------------------------

-- INSERT — any authenticated user can upload to their own user-id subpath.
-- Orphan files (uploaded but never linked to a chat_attachments row) are
-- possible but harmless: Storage SELECT requires a matching attachments row.
CREATE POLICY "chat_attachments_storage_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- SELECT — readable if there's a chat_attachments row pointing at this
-- object AND the caller has channel access to the parent message.
CREATE POLICY "chat_attachments_storage_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM public.chat_attachments ca
      WHERE ca.storage_path = storage.objects.name
        AND (
          (ca.org_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.org_members om
            WHERE om.org_id = ca.org_id
              AND om.user_id = auth.uid()
          ))
          OR
          (ca.protocol_id IS NOT NULL AND (
            EXISTS (
              SELECT 1 FROM public.protocol_members pm
              WHERE pm.protocol_id = ca.protocol_id
                AND pm.user_id = auth.uid()
                AND pm.role IN ('coordinator', 'member')
            )
            OR EXISTS (
              SELECT 1 FROM public.protocols p
              WHERE p.id = ca.protocol_id
                AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
            )
          ))
        )
    )
  );

-- DELETE — uploader can remove their own; org admins + protocol coordinators
-- can remove any in their scope. Matches the chat_attachments DELETE policy
-- so the storage object can be cleaned up when the row is deleted.
CREATE POLICY "chat_attachments_storage_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (
      (storage.foldername(name))[1] = auth.uid()::TEXT
      OR EXISTS (
        SELECT 1 FROM public.chat_attachments ca
        WHERE ca.storage_path = storage.objects.name
          AND (
            (ca.org_id IS NOT NULL AND ca.org_id IN (SELECT public.current_user_admin_org_ids()))
            OR (ca.protocol_id IS NOT NULL AND (
              EXISTS (
                SELECT 1 FROM public.protocols p
                WHERE p.id = ca.protocol_id
                  AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
              )
              OR EXISTS (
                SELECT 1 FROM public.protocol_members pm
                WHERE pm.protocol_id = ca.protocol_id
                  AND pm.user_id = auth.uid()
                  AND pm.role = 'coordinator'
              )
            ))
          )
      )
    )
  );


-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_attachments;
  END IF;
END $$;
