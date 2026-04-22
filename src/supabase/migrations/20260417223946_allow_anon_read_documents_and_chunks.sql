/*
  # Allow anon role to read documents and chunks

  The dashboard does not require authentication, so the anon role
  needs SELECT access to both the documents and chunks tables so
  the Knowledge Base list loads correctly for all visitors.

  Changes:
  - Add SELECT policy on documents for anon role
  - Add SELECT policy on chunks for anon role
*/

CREATE POLICY "Anon users can read documents"
  ON documents
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Anon users can read chunks"
  ON chunks
  FOR SELECT
  TO anon
  USING (true);
