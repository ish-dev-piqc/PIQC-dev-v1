-- =============================================================================
-- Audit Mode — ISA document request: schema slice (isa-document-request)
--
-- document_request_objects — the pre-visit document request of an
-- Investigator Site Audit, one row per audit. The 9th deliverable kind on
-- the generic pair (audit_mode_upsert_deliverable /
-- audit_mode_approve_deliverable); the kind arm and the delta-viewer branch
-- land in 20260920000100.
--
-- SOURCE-OF-TRUTH RULE: the request is DERIVED, deterministically and without
-- a model call, from the site audit scope (site_scope_objects, 20260918000000)
-- and a closed-world document vocabulary in the client
-- (src/lib/audit/documentRequestVocabulary.ts): a baseline set every site
-- audit asks for, plus the standard document set of each module in the
-- scope. The auditor then shapes it (include / exclude / add / note) and
-- sets the sampling approach the visit will apply. content stores that as a
-- document:
--
--   { built_from: { scope_id,                         -- provenance only
--                   scope_modules: [ { isa_domain, criticality } ],
--                   built_at },
--     items: [ { key, title, detail?, basis, included, note } ],
--     sampling_approach,                              -- free text, stated in the letter
--     instructions }                                  -- delivery instructions
--
-- basis is { kind: 'baseline' } | { kind: 'module', isa_domain, criticality }
-- | { kind: 'auditor', isa_domain }; key is the line's stable identity across
-- rebuilds (an auditor's include / note survives by key). built_from
-- .scope_modules is what the workspace compares against the live scope to
-- show drift — the (domain, criticality) pairs, NOT the scope row's
-- updated_at, which its touch trigger moves on the scope's own approve.
--
-- Subjects are selected during Audit conduct, never before: subject-level
-- lines read "for the subjects selected during the audit (subject numbers
-- only)" and content never carries a subject identifier of any kind.
--
-- Approval is the house latch: approving CAS-pins THIS row's version
-- (updated_at) — the standard, basis-less shape the letter / agenda /
-- checklist / site_scope kinds use. No basis_digest column, no generation
-- columns: nothing generates this document.
--
-- Enum value lives in THIS file, functions that reference it in the next —
-- ALTER TYPE ... ADD VALUE cannot be referenced in the same transaction
-- (20260707000200 precedent).
--
-- Owner: @rv61.
-- =============================================================================

ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'DOCUMENT_REQUEST_OBJECT';

CREATE TABLE document_request_objects (
  id              UUID                        PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id        UUID                        NOT NULL UNIQUE REFERENCES audits(id),
  content         JSONB                       NOT NULL DEFAULT '{}'::jsonb,
  approval_status deliverable_approval_status NOT NULL DEFAULT 'DRAFT',
  approved_by     UUID                        REFERENCES auth.users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_document_request_objects_updated_at
  BEFORE UPDATE ON document_request_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- Lead auditor of the audit, as every per-audit deliverable. TO authenticated
-- only: with RLS on and no anon policy, the public key reads nothing.
ALTER TABLE document_request_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_request_objects_via_audit"
  ON document_request_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
