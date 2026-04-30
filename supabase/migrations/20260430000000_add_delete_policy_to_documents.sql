-- Enable authenticated users to delete their own documents
-- This allows the frontend to remove documents from the knowledge base

CREATE POLICY "Authenticated users can delete documents"
  ON documents FOR DELETE
  TO authenticated
  USING (true);
