-- =============================================================================
-- Audit Mode — ISA findings schema (S2 of the notes → findings → report arc)
--
-- isa_finding_objects — formal findings on an Investigator Site Audit.
-- Append-only like the vendor lane's audit_workspace_entry_objects (updates
-- allowed with delta tracking; no delete), but site-shaped and structured per
-- the S0 writing contract:
--
--   observation  — the GENERALIZED deficiency statement
--   evidence     — JSONB array [{ text, source_note_ids: uuid[] }]: the
--                  specific instances cited under the observation, each
--                  traced to the S1 pad notes it came from. One finding =
--                  one root cause; evidence items are its instances.
--                  JSONB (not a child table): no per-item query need, and
--                  edits are delta-tracked like any other field.
--   reference    — regulatory citation, CLOSED-WORLD: selected from the
--                  curated E6(R3)/CFR map (supabase/functions/
--                  isa-finding-draft/citationMap.ts), never free-composed.
--   severity     — dedicated 4-tier isa_severity. Deliberate deviation from
--                  reusing provisional_impact: the ISA templates rate
--                  Critical/Major/Minor/Recommendation as ONE axis; reusing
--                  the vendor 5-value enum would leave two dead values and
--                  split Recommendation across a second column.
--   origin       — provenance honesty (PrefillAgentNote doctrine): a PIQC
--                  draft accepted verbatim stays PIQC_DRAFTED; ANY content
--                  edit (before accept via client, after accept via the
--                  update RPC) flips it to PIQC_EDITED. Auditor-authored
--                  findings are AUDITOR.
--
-- Promotion: accepting a finding stamps promoted_finding_id on every note its
-- evidence cites (atomic, in the create RPC). Promoted notes are excluded
-- from subsequent drafting rounds — re-runs propose only new ground.
--
-- LLM data-handling stance (mirrors 20260516010000): the isa-finding-draft
-- edge function sends OpenAI the pad notes' body/domain, the protocol title,
-- and the audit type. It never sends sponsor/client names, site personnel
-- names, or participant identifiers — the S1 pad instructs subject numbers
-- only, and the S1 microcopy is the capture-time guard. The function returns
-- proposals only; nothing is written until the auditor accepts (D-008).
-- =============================================================================

CREATE TYPE isa_severity AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'RECOMMENDATION');

CREATE TYPE isa_finding_origin AS ENUM ('AUDITOR', 'PIQC_DRAFTED', 'PIQC_EDITED');

-- Who owns the response to the finding (from the Audit Observation Form).
CREATE TYPE isa_response_owner AS ENUM ('SITE', 'CLIENT', 'CRO');

-- New tracked type; 20260724000100 extends audit_mode_can_view_tracked_object.
ALTER TYPE tracked_object_type ADD VALUE IF NOT EXISTS 'ISA_FINDING_OBJECT';

CREATE TABLE isa_finding_objects (
  id             UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id       UUID               NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  title          TEXT               NOT NULL,
  isa_domain     isa_domain         NOT NULL,
  subcategory    TEXT,
  severity       isa_severity       NOT NULL,
  -- Which severity decision/escalation rule fired — makes the (proposed)
  -- rating auditable instead of vibes. PIQC drafts always carry it; manual
  -- findings may leave it NULL.
  severity_rule  TEXT,
  observation    TEXT               NOT NULL,
  evidence       JSONB              NOT NULL DEFAULT '[]'::jsonb,
  reference      TEXT,
  response_owner isa_response_owner NOT NULL DEFAULT 'SITE',
  origin         isa_finding_origin NOT NULL,
  created_by     UUID               NOT NULL REFERENCES auth.users(id),
  created_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  CONSTRAINT isa_finding_evidence_is_array CHECK (jsonb_typeof(evidence) = 'array')
);

CREATE INDEX idx_isa_finding_objects_audit
  ON isa_finding_objects (audit_id, created_at);

CREATE TRIGGER touch_isa_finding_objects_updated_at
  BEFORE UPDATE ON isa_finding_objects
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE isa_finding_objects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "isa_finding_objects_via_audit"
  ON isa_finding_objects FOR ALL
  TO authenticated
  USING       (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()))
  WITH CHECK  (audit_id IN (SELECT id FROM audits WHERE lead_auditor_id = auth.uid()));

-- S1 reserved this: a note promoted into a finding records where it went.
-- Nullable FK (not CASCADE): findings are never deleted, and a note must not
-- be hard-deletable out from under a finding — notes are soft-delete only.
ALTER TABLE audit_note_objects
  ADD COLUMN promoted_finding_id UUID REFERENCES isa_finding_objects(id);

CREATE INDEX idx_audit_note_objects_promoted
  ON audit_note_objects (promoted_finding_id)
  WHERE promoted_finding_id IS NOT NULL;
