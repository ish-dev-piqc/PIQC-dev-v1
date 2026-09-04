-- =============================================================================
-- SOTR read reach for lead auditors (F-011).
--
-- Every parsed-protocol read is owner-scoped: the four SOTR policies below the
-- fold all reduce to `documents.user_id = auth.uid()` (20260508000000 +
-- 20260430130000). Audit Mode pins an audit to a protocol (audits.protocol_id),
-- not to an uploader, so a lead auditor whose protocol PDF was uploaded under
-- another account sees an empty worksheet, an empty Records ▸ Protocol source
-- drawer and an empty source-item picker — with no error — while the drafting
-- edge functions (service role) cite that very document. F-011 named this
-- trigger: "the first deployment where an auditor account ≠ the uploading
-- account".
--
-- Decision: the lead auditor of an audit on protocol P may READ P's parsed
-- content regardless of who uploaded it. Nothing else widens:
--   - the owner FOR ALL policies stay, so INSERT/UPDATE/DELETE remain
--     uploader-only (permissive policies OR together);
--   - `worksheet_review_events` (review actions) and `chunks` (Ask/chat,
--     hybrid_search) are intentionally untouched;
--   - AUDIT_EVIDENCE documents are excluded by `kind = 'PROTOCOL'` — they keep
--     their own via-audit reach (20260830000000) and ingest refuses a
--     protocol_id pin on evidence anyway.
--
-- Predicate shape copied from audit_source_documents_via_audit
-- (20260830000000): protocol_id IN (SELECT protocol_id FROM audits WHERE
-- lead_auditor_id = auth.uid()). audits_select_lead_auditor already limits that
-- subquery to the caller's own audits. Subqueries on documents /
-- protocol_extracted_items inside a policy run as the caller (their own
-- policies apply); the explicit predicate keeps the result independent of
-- that, exactly like the existing owner policies.
--
-- No grants change: the tables already grant SELECT to authenticated. anon has
-- no policy on the three SOTR tables (RLS-empty 200) and no SELECT privilege
-- on documents (20260721000000) — both unchanged by this file.
--
-- Consumers that inherit the reach with no client change:
--   src/lib/sotr/sourceEvidenceApi.ts (worksheet list, evidence batch),
--   sotr_get_worksheet_item_evidence / _batch (SECURITY INVOKER,
--   20260509000000), RiskTaggingForm's SourceTruthListDrawer, and the Site
--   Mode Knowledge Base list (an auditor now sees the audited protocol's
--   document there — read-only, no delete control).
--
-- Re-runnable: DROP POLICY IF EXISTS before each CREATE (20260726000000).
-- No type impact: policies only, no schema or column change.
--
-- Owner: @rv61. Plan: plans/sixonelabs-piqc/sotr-audit-lead-read.md
-- =============================================================================


-- -----------------------------------------------------------------------------
-- documents — protocol documents of every protocol the caller leads an audit on.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS sotr_documents_audit_lead_read ON documents;
CREATE POLICY sotr_documents_audit_lead_read
  ON documents FOR SELECT TO authenticated
  USING (
    kind = 'PROTOCOL'
    AND protocol_id IN (
      SELECT a.protocol_id FROM audits a WHERE a.lead_auditor_id = auth.uid()
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_extracted_items — worksheet items of those documents.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS sotr_extracted_items_audit_lead_read ON protocol_extracted_items;
CREATE POLICY sotr_extracted_items_audit_lead_read
  ON protocol_extracted_items FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT d.id
        FROM documents d
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT a.protocol_id FROM audits a WHERE a.lead_auditor_id = auth.uid()
         )
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_source_evidence — page/section/quote evidence of those documents.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS sotr_source_evidence_audit_lead_read ON protocol_source_evidence;
CREATE POLICY sotr_source_evidence_audit_lead_read
  ON protocol_source_evidence FOR SELECT TO authenticated
  USING (
    document_id IN (
      SELECT d.id
        FROM documents d
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT a.protocol_id FROM audits a WHERE a.lead_auditor_id = auth.uid()
         )
    )
  );


-- -----------------------------------------------------------------------------
-- protocol_item_evidence_links — item ↔ evidence join for those items.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS sotr_item_evidence_links_audit_lead_read ON protocol_item_evidence_links;
CREATE POLICY sotr_item_evidence_links_audit_lead_read
  ON protocol_item_evidence_links FOR SELECT TO authenticated
  USING (
    extracted_item_id IN (
      SELECT ei.id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
       WHERE d.kind = 'PROTOCOL'
         AND d.protocol_id IN (
           SELECT a.protocol_id FROM audits a WHERE a.lead_auditor_id = auth.uid()
         )
    )
  );
