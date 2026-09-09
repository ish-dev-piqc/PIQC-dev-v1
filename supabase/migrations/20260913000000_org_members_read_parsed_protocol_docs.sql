-- =============================================================================
-- Org-wide read access to already-parsed protocol documents.
--
-- Today, a protocol's parsed content (documents, protocol_extracted_items,
-- protocol_source_evidence, protocol_item_evidence_links) is only readable
-- by two paths:
--   (a) whoever uploaded the document (documents.user_id = auth.uid(),
--       20260430130000)
--   (b) the lead auditor of an audit pinned to that protocol
--       (20260912000000_sotr_audit_lead_read.sql)
--
-- Neither covers the common case this migration exists for: another member
-- of the SAME ORG wants to work with a protocol a teammate already parsed.
-- Without this, they see an empty worksheet / empty source drawer with no
-- error, and the natural (wrong) fix is to re-upload the same PDF — burning
-- another Reducto Extract pass on data that already exists.
--
-- This adds an ADDITIONAL permissive SELECT policy (existing owner-only and
-- lead-auditor policies are untouched — this only widens who can read, never
-- narrows): any member of an org holding protocol_org_access to the protocol
-- may read its parsed content. This is the exact same org-based model
-- site_participants / site_visits / site_team_members already use — see
-- 20260520020000_protocol_org_access.sql — just extended to the SOTR/parse
-- tables that model never originally covered.
--
-- Scope carve-outs (matching 20260912000000's precedent exactly):
--   - kind = 'PROTOCOL' only. AUDIT_EVIDENCE documents keep their own
--     via-audit-only reach (20260830000000) — not widened here.
--   - chunks and worksheet_review_events are intentionally NOT touched.
--     chunks backs Ask/chat hybrid_search and has its own user-scoped
--     policy (20260430130000); review actions in worksheet_review_events
--     are a per-reviewer audit trail, not parsed content. Widening either
--     is a separate decision, not implied by "let a teammate read a
--     parse someone else ran."
--   - Only SELECT is added. INSERT/UPDATE/DELETE remain uploader- or
--     service-role-only, unchanged — this does not let one org member
--     edit or delete another's upload.
--
-- Does NOT change ingest/re-parse dedup: documents_content_hash_idx
-- (20260523000000) is scoped to (user_id, content_hash), so a different org
-- member uploading the identical PDF today still triggers a fresh parse —
-- this migration only fixes READ reuse of an already-completed parse.
-- Making the dedup check org-scoped instead of user-scoped (so a re-upload
-- by a teammate is recognized and skipped, not just readable after the
-- fact) is a related but separate change to the ingest pipeline, not
-- included here — flagging as a natural follow-up.
--
-- Owner: @rv61 (supabase/ is Roger's exclusive domain per CODEOWNERS).
-- Drafted by Kiara for Roger's review — see
-- plans/kiara/org-wide-parsed-protocol-read.md. Not merged/deployed by
-- this commit; needs Roger's sign-off given the data-access surface this
-- touches.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- documents — protocol documents of every protocol any of the caller's orgs
-- has protocol_org_access to (owner or collaborator role, either counts).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_documents_read ON documents;
CREATE POLICY org_members_documents_read
  ON documents FOR SELECT TO authenticated
  USING (
    kind = 'PROTOCOL'
    AND protocol_id IN (
      SELECT poa.protocol_id
        FROM protocol_org_access poa
       WHERE poa.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_extracted_items — worksheet items of those documents.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_extracted_items_read ON protocol_extracted_items;
CREATE POLICY org_members_extracted_items_read
  ON protocol_extracted_items FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT d.id
        FROM documents d
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT poa.protocol_id
             FROM protocol_org_access poa
            WHERE poa.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
         )
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_source_evidence — page/section/quote evidence of those documents.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_source_evidence_read ON protocol_source_evidence;
CREATE POLICY org_members_source_evidence_read
  ON protocol_source_evidence FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT d.id
        FROM documents d
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT poa.protocol_id
             FROM protocol_org_access poa
            WHERE poa.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
         )
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_item_evidence_links — item ↔ evidence join for those items.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS org_members_item_evidence_links_read ON protocol_item_evidence_links;
CREATE POLICY org_members_item_evidence_links_read
  ON protocol_item_evidence_links FOR SELECT TO authenticated
  USING (
    extracted_item_id IN (
      SELECT ei.id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT poa.protocol_id
             FROM protocol_org_access poa
            WHERE poa.org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
         )
    )
  );
