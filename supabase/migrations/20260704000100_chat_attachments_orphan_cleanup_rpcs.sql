-- =============================================================================
-- Chat attachments — orphan Storage cleanup RPCs.
--
-- Files in the `chat-attachments` Supabase Storage bucket whose `name` is
-- not referenced by any `chat_attachments.storage_path` are orphans. They
-- arise when a parent message row is deleted (CASCADE wipes the
-- chat_attachments row, but Storage isn't notified) or when a client-side
-- upload silently fails between Storage put + DB insert.
--
-- Two RPCs:
--   count_orphan_chat_attachments()  → integer — preview count.
--   delete_orphan_chat_attachments() → integer — actually deletes; returns count.
--
-- Both SECURITY DEFINER, both gated to org admins. Supabase Storage uses
-- storage.objects as source of truth; deleting the row removes the
-- underlying file.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Helper — is the calling user an admin of ANY org? Returns boolean. Used by
-- both cleanup RPCs since orphans aren't tenant-scoped (no org_id on a file
-- that has no parent message).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_is_any_org_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_members
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_is_any_org_admin() TO authenticated;


-- ---------------------------------------------------------------------------
-- count_orphan_chat_attachments — preview the orphan count without deleting.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.count_orphan_chat_attachments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.current_user_is_any_org_admin() THEN
    RAISE EXCEPTION 'permission denied: org admin required';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM storage.objects o
  WHERE o.bucket_id = 'chat-attachments'
    AND NOT EXISTS (
      SELECT 1 FROM public.chat_attachments ca
      WHERE ca.storage_path = o.name
    );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_orphan_chat_attachments() TO authenticated;


-- ---------------------------------------------------------------------------
-- delete_orphan_chat_attachments — perform the sweep. Returns deleted count.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_orphan_chat_attachments()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF NOT public.current_user_is_any_org_admin() THEN
    RAISE EXCEPTION 'permission denied: org admin required';
  END IF;

  WITH deleted AS (
    DELETE FROM storage.objects o
    WHERE o.bucket_id = 'chat-attachments'
      AND NOT EXISTS (
        SELECT 1 FROM public.chat_attachments ca
        WHERE ca.storage_path = o.name
      )
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_count FROM deleted;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_orphan_chat_attachments() TO authenticated;
