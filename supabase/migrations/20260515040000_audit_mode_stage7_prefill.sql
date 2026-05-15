-- =============================================================================
-- Audit Mode — Stage 7 pre-fill from approved Stage 4 + Stage 6 context
--
-- Bootstraps the report draft's two auditor-authored prose fields
-- (executive_summary, conclusions) from the auditor's approved upstream
-- context. The pre-fill is one-shot and snapshot-based: once the report row
-- exists, edits are owned by the deliverable. Upstream amendments do not
-- clobber.
--
-- This is the same agentic pattern PR #58 established for Stage 5
-- (PRE_AUDIT_DRAFTING). Extending it to Stage 7 makes the pattern
-- system-wide rather than a one-off feature.
--
-- Sources:
--   vendor_risk_summary_objects.vendor_relevance_narrative
--     → executive_summary scaffold (internal-facing prose is appropriate here,
--       unlike the confirmation letter which is vendor-facing — see PR #58)
--   vendor_risk_summary_objects.focus_areas
--     → executive_summary "audit attention centered on:" bullet list
--   audit_workspace_entry_objects grouped by provisional_classification
--     → executive_summary counts (N findings, M observations, K OFIs)
--   audits.audit_name, vendors.name, protocols.title
--     → executive_summary context sentence (sponsor-name-free)
--
-- Pre-conditions enforced server-side:
--   - Caller is the lead auditor on the target audit
--   - No existing report_draft_objects row (don't clobber)
--   - vendor_risk_summary_objects.approval_status = 'APPROVED'
--
-- conclusions is a short templated scaffold the auditor edits into a real
-- recommendation. No content judgement is encoded here — that's an LLM
-- refinement for a later PR.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema additions — additive, nullable. Pre-existing report drafts (audit-003
-- in the mock) remain valid with NULL on both.
-- -----------------------------------------------------------------------------
ALTER TABLE report_draft_objects
  ADD COLUMN source_risk_summary_id UUID
    REFERENCES vendor_risk_summary_objects(id) ON DELETE SET NULL,
  ADD COLUMN prefilled_at TIMESTAMPTZ;


-- -----------------------------------------------------------------------------
-- audit_mode_prefill_report_draft
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_mode_prefill_report_draft(p_audit_id uuid)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user             uuid := auth.uid();
  v_audit            audits;
  v_vendor_name      text;
  v_protocol_title   text;
  v_risk_summary     vendor_risk_summary_objects;
  v_focus_bullets    text := '';
  v_focus            text;
  v_n_findings       integer := 0;
  v_n_observations   integer := 0;
  v_n_ofis           integer := 0;
  v_executive        text;
  v_conclusions      text;
  v_after            report_draft_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT audit_mode_is_lead_auditor(p_audit_id) THEN
    RAISE EXCEPTION 'Not authorised to pre-fill report draft for audit %', p_audit_id
      USING ERRCODE = '42501';
  END IF;

  -- Idempotent on absence.
  IF EXISTS (SELECT 1 FROM report_draft_objects WHERE audit_id = p_audit_id) THEN
    RAISE EXCEPTION 'Report draft already exists for audit %', p_audit_id
      USING ERRCODE = '23505';
  END IF;

  SELECT * INTO v_audit FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  SELECT v.name INTO v_vendor_name FROM vendors v WHERE v.id = v_audit.vendor_id;
  SELECT p.title INTO v_protocol_title FROM protocols p WHERE p.id = v_audit.protocol_id;

  SELECT * INTO v_risk_summary
    FROM vendor_risk_summary_objects WHERE audit_id = p_audit_id;
  IF v_risk_summary.id IS NULL OR v_risk_summary.approval_status <> 'APPROVED' THEN
    RAISE EXCEPTION 'Risk summary must be APPROVED before pre-fill'
      USING ERRCODE = '23514';
  END IF;

  -- Focus-area bullets. Empty focus_areas → no bullet block (rare; risk
  -- summary should have at least one).
  FOREACH v_focus IN ARRAY v_risk_summary.focus_areas LOOP
    v_focus_bullets := v_focus_bullets || '  • ' || v_focus || E'\n';
  END LOOP;

  -- Workspace-entry counts grouped by classification. NOT_YET_CLASSIFIED is
  -- excluded from the report-facing counts (those represent in-progress
  -- observations the auditor hasn't decided on yet).
  SELECT
    COUNT(*) FILTER (WHERE provisional_classification = 'FINDING'),
    COUNT(*) FILTER (WHERE provisional_classification = 'OBSERVATION'),
    COUNT(*) FILTER (WHERE provisional_classification = 'OPPORTUNITY_FOR_IMPROVEMENT')
  INTO v_n_findings, v_n_observations, v_n_ofis
  FROM audit_workspace_entry_objects
  WHERE audit_id = p_audit_id;

  -- ---------------------------------------------------------------------------
  -- Executive summary scaffold.
  --
  -- Sponsor-name-free by rule. Uses vendor name + protocol title (which is
  -- sponsor-content but anchored to the protocol, not the sponsor identity).
  -- The vendor_relevance_narrative is the auditor's own approved synthesis
  -- and goes in verbatim — they wrote it, they own it.
  -- ---------------------------------------------------------------------------
  v_executive :=
    'This audit reviewed the contracted services provided by '
    || COALESCE(v_vendor_name, 'the vendor')
    || ' against the protocol "'
    || COALESCE(v_protocol_title, 'Protocol')
    || '".'
    || E'\n\n'
    || COALESCE(v_risk_summary.vendor_relevance_narrative, '')
    || E'\n\n'
    || 'Audit observations are summarized below: '
    || v_n_findings || ' finding' || CASE WHEN v_n_findings = 1 THEN '' ELSE 's' END
    || ', ' || v_n_observations || ' observation' || CASE WHEN v_n_observations = 1 THEN '' ELSE 's' END
    || ', and ' || v_n_ofis || ' opportunit' || CASE WHEN v_n_ofis = 1 THEN 'y' ELSE 'ies' END
    || ' for improvement were recorded during the audit conduct.';

  IF length(v_focus_bullets) > 0 THEN
    v_executive := v_executive
      || E'\n\n'
      || 'Audit attention centered on:'
      || E'\n'
      || rtrim(v_focus_bullets, E'\n');
  END IF;

  v_executive := v_executive
    || E'\n\n'
    || 'Trust posture and operational fitness conclusions are recorded in the Conclusions section.';

  -- ---------------------------------------------------------------------------
  -- Conclusions scaffold. Short — the auditor writes the actual recommendation.
  -- ---------------------------------------------------------------------------
  v_conclusions :=
    '[Auditor recommendation — replace with your assessment of '
    || COALESCE(v_vendor_name, 'the vendor')
    || E'''s suitability to continue providing contracted services for this study, including any conditions or remediation commitments.]\n\n'
    || 'The findings will be tracked through the standard CAPA process; closure timing is captured in the report appendix.';

  -- ---------------------------------------------------------------------------
  -- Insert + delta
  -- ---------------------------------------------------------------------------
  INSERT INTO report_draft_objects (
    audit_id, executive_summary, conclusions, approval_status,
    source_risk_summary_id, prefilled_at
  ) VALUES (
    p_audit_id, v_executive, v_conclusions, 'DRAFT',
    v_risk_summary.id, NOW()
  )
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'REPORT_DRAFT_OBJECT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'executive_summary',      jsonb_build_object('from', NULL, 'to', v_after.executive_summary),
      'conclusions',            jsonb_build_object('from', NULL, 'to', v_after.conclusions),
      'approval_status',        jsonb_build_object('from', NULL, 'to', v_after.approval_status),
      'source_risk_summary_id', jsonb_build_object('from', NULL, 'to', v_after.source_risk_summary_id),
      'prefilled_at',           jsonb_build_object('from', NULL, 'to', v_after.prefilled_at)
    ),
    v_user,
    'Report draft pre-filled from approved Stage 4 risk summary + Stage 6 workspace entries'
  );

  RETURN v_after;
END;
$$;


GRANT EXECUTE ON FUNCTION audit_mode_prefill_report_draft(uuid) TO authenticated;
