-- =============================================================================
-- Audit Mode — Issues & CAPA schema (Phase 3 of the Audit Workspace arc)
--
-- A Stage 6 finding (audit_workspace_entry_objects) can be triaged into an
-- ISSUE (severity + regulatory/sponsor-reporting flags), which carries at most
-- one CAPA draft (root cause / corrective / preventive). The CAPA follows the
-- draft-only posture: DRAFT → NEEDS_REVISION → ACCEPTED. "Accepted" means
-- "ready to export" — there is deliberately NO approve/final state in-app;
-- formal CAPA finalization happens in the QMS after export.
--
-- Issue lifecycle is intentionally column-free in v1: an issue's state is
-- derived from its CAPA (none yet / in draft / accepted / exported). A status
-- column would drift against the CAPA's truth.
--
-- GCP nuance (deferred): for GCP vendors, vendor CAPAs are tracked by the VBO,
-- not QA. Surfacing that badge needs the GxP-path classification attribute
-- (Phase 4); no schema accommodation required here.
-- =============================================================================

-- Enum values first — a separate migration file from any use of these values,
-- because ALTER TYPE ADD VALUE cannot be referenced in the same transaction.
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'ISSUE_OBJECT';
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'CAPA_OBJECT';

-- CAPA review-loop status. Reuses nothing: deliverable_approval_status is
-- DRAFT|APPROVED and "approved" is exactly the word this surface must never
-- use. NEEDS_REVISION is a real reviewer verdict, not a soft DRAFT.
CREATE TYPE capa_status AS ENUM ('DRAFT', 'NEEDS_REVISION', 'ACCEPTED');

-- -----------------------------------------------------------------------------
-- issue_objects — triage record. Severity reuses the provisional_impact enum
-- (auditors already speak CRITICAL/MAJOR/MINOR from Stage 6); the UI constrains
-- choices to those three.
-- -----------------------------------------------------------------------------
CREATE TABLE issue_objects (
  id                    UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id              UUID               NOT NULL REFERENCES audits(id),
  -- The finding this issue was triaged from. Nullable: an issue can be raised
  -- directly (e.g. from a questionnaire inconsistency) without a Stage 6 entry.
  workspace_entry_id    UUID               REFERENCES audit_workspace_entry_objects(id) ON DELETE SET NULL,
  title                 TEXT               NOT NULL,
  description           TEXT               NOT NULL DEFAULT '',
  severity              provisional_impact NOT NULL,
  regulatory_reportable BOOLEAN            NOT NULL DEFAULT FALSE,
  sponsor_reportable    BOOLEAN            NOT NULL DEFAULT FALSE,
  created_by            UUID               NOT NULL REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_issue_objects_audit ON issue_objects(audit_id);
CREATE INDEX idx_issue_objects_workspace_entry ON issue_objects(workspace_entry_id)
  WHERE workspace_entry_id IS NOT NULL;

CREATE TRIGGER touch_issue_objects_updated_at
  BEFORE UPDATE ON issue_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- capa_objects — the draft-only CAPA deliverable. 1:1 with its issue (UNIQUE).
-- audit_id denormalized for RLS + fast per-audit queries (mirrors
-- questionnaire_response_objects).
-- -----------------------------------------------------------------------------
CREATE TABLE capa_objects (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id               UUID        NOT NULL UNIQUE REFERENCES issue_objects(id) ON DELETE CASCADE,
  audit_id               UUID        NOT NULL REFERENCES audits(id),
  root_cause_text        TEXT        NOT NULL DEFAULT '',
  corrective_action_text TEXT        NOT NULL DEFAULT '',
  preventive_action_text TEXT        NOT NULL DEFAULT '',
  status                 capa_status NOT NULL DEFAULT 'DRAFT',
  -- TRUE when the draft skeleton was PIQC-prefilled from the issue/finding
  -- context (Stage 5 prefill pattern). Flips to FALSE the first time an
  -- auditor edits any text field — provenance stays honest.
  piqc_prefilled         BOOLEAN     NOT NULL DEFAULT FALSE,
  accepted_at            TIMESTAMPTZ,
  accepted_by            UUID        REFERENCES auth.users(id),
  exported_at            TIMESTAMPTZ,
  created_by             UUID        NOT NULL REFERENCES auth.users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_capa_objects_audit ON capa_objects(audit_id);

CREATE TRIGGER touch_capa_objects_updated_at
  BEFORE UPDATE ON capa_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

-- -----------------------------------------------------------------------------
-- RLS — same via-audit scoping as every audit-scoped table.
-- -----------------------------------------------------------------------------
ALTER TABLE issue_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "issue_objects_via_audit"
  ON issue_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

ALTER TABLE capa_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "capa_objects_via_audit"
  ON capa_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));
