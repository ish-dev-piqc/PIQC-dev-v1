-- Add user_id to documents to scope knowledge base per user.
-- Users see and manage only their own documents.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS documents_user_id_idx ON documents(user_id);

-- Replace shared-access policies with user-scoped ones.
DROP POLICY IF EXISTS "Authenticated users can read documents" ON documents;
DROP POLICY IF EXISTS "Authenticated users can delete documents" ON documents;

CREATE POLICY "Users can read own documents"
  ON documents FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete own documents"
  ON documents FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- Chunks inherit access via document ownership.
DROP POLICY IF EXISTS "Authenticated users can read chunks" ON chunks;

CREATE POLICY "Users can read chunks of own documents"
  ON chunks FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = chunks.document_id AND d.user_id = auth.uid()
    )
  );

-- hybrid_search must filter to caller's documents to prevent cross-user leakage.
-- The function runs as SECURITY INVOKER so RLS on chunks applies automatically,
-- but we make it explicit for clarity.
