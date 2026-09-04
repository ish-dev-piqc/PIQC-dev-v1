-- 20260915000000_protocol_risk_domain_nullable.sql
--
-- Audit Mode — protocol_risk_objects.operational_domain_tag becomes nullable.
--
-- The operational domain (ECG | imaging | ePRO | randomization | central_lab |
-- IVRS …) is the vendor-workflow axis of a protocol risk: which vendor
-- capability the tagged section depends on. The Investigator Site Audit
-- workflow now tags protocol risks at its Risk assessment stage through the
-- same flow (plans/sixonelabs-piqc/isa-risk-tagging.md); a site-tagged risk
-- has no vendor domain, and the site axis lives on the site scope mapping
-- that follows (isa_domain). Storing a sentinel ('' or 'OTHER') would be a
-- hidden assumption every consumer has to know about; NULL is the honest
-- value.
--
-- Widening only: every existing row keeps its value, every applied RPC keeps
-- working — audit_mode_create_protocol_risk and
-- audit_mode_create_protocol_risk_from_candidate insert the parameter as
-- given (NULL now allowed), audit_mode_update_protocol_risk COALESCEs a NULL
-- parameter to the current value (unchanged semantics), the delete RPC's
-- delta already records a nullable 'from'. Readers that assumed a string
-- (Intake row chip, Scope review chip, Risk summary rail, the deliverable
-- drafter's scope areas) skip a NULL — see the plan MD.
--
-- No type impact under src/types/audit: the row mirror (TaggedSection /
-- ProtocolRiskRow) lives in src/lib/audit and is updated in the same PR.

ALTER TABLE protocol_risk_objects
  ALTER COLUMN operational_domain_tag DROP NOT NULL;

COMMENT ON COLUMN protocol_risk_objects.operational_domain_tag IS
  'Vendor-workflow axis (controlled vocab, client-enforced). NULL on risks tagged from an investigator site audit, which carries no vendor domain.';
