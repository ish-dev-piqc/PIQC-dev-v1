-- =============================================================================
-- Risk summary demote-on-edit (latch-integrity follow-up to 20260730000000).
--
-- The report object demotes APPROVED → DRAFT when its upsert changes content
-- (20260730000000), and the three Stage-5 deliverables have done the same
-- since 20260430170000 — but audit_mode_upsert_risk_summary (20260430160000)
-- never touched approval_status on update. An auditor could approve the risk
-- summary, edit the narrative/focus areas, and the row stayed APPROVED with
-- approved_at/approved_by attesting to content the approver never saw; the
-- PRE_AUDIT_DRAFTING advance gate stayed green. The RiskSummaryPanel UI has
-- promised "Saving demotes to Draft" all along — this makes it true.
--
-- Recreate the upsert so an update that actually changes study_context,
-- narrative, or focus_areas demotes to DRAFT and clears approved_at/by.
-- This upsert's params are NULL = "don't change" (unlike the full-content
-- report/deliverable upserts), so "changed" is computed on the post-COALESCE
-- values — saving with no edits, or a partial call, never demotes.
--
-- Same signature as 20260430160000 → plain CREATE OR REPLACE (no PostgREST
-- overload risk, existing grants preserved). The insert branch is unchanged.
--
-- Deliberately NOT addressed here (workflow decisions, tracked in
-- plans/sixonelabs-piqc/audit-risk-summary-demote-on-edit.md):
--   - link/unlink of protocol risks after approval (neither demotes nor bumps
--     updated_at, so the approve CAS can't see it either)
--   - questionnaire response edits after instance approval
--
-- No type impact: no schema/column change.
-- =============================================================================

CREATE OR REPLACE FUNCTION audit_mode_upsert_risk_summary(
  p_audit_id      uuid,
  p_study_context jsonb DEFAULT NULL,
  p_narrative     text  DEFAULT NULL,
  p_focus_areas   text[] DEFAULT NULL,
  p_reason        text  DEFAULT NULL
)
RETURNS vendor_risk_summary_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          vendor_risk_summary_objects;
  v_after           vendor_risk_summary_objects;
  v_diff            jsonb;
  v_content_changed boolean := FALSE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    INSERT INTO vendor_risk_summary_objects (
      audit_id, study_context, vendor_relevance_narrative, focus_areas, approval_status
    ) VALUES (
      p_audit_id,
      COALESCE(p_study_context, '{}'::jsonb),
      COALESCE(p_narrative, ''),
      COALESCE(p_focus_areas, '{}'),
      'DRAFT'
    )
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'study_context',              jsonb_build_object('from', NULL, 'to', v_after.study_context),
        'vendor_relevance_narrative', jsonb_build_object('from', NULL, 'to', v_after.vendor_relevance_narrative),
        'focus_areas',                jsonb_build_object('from', NULL, 'to', to_jsonb(v_after.focus_areas)),
        'approval_status',            jsonb_build_object('from', NULL, 'to', v_after.approval_status)
      ),
      v_user,
      COALESCE(p_reason, 'Risk summary created')
    );

    RETURN v_after;
  END IF;

  v_content_changed :=
       (v_before.study_context              IS DISTINCT FROM COALESCE(p_study_context, v_before.study_context))
    OR (v_before.vendor_relevance_narrative IS DISTINCT FROM COALESCE(p_narrative,     v_before.vendor_relevance_narrative))
    OR (v_before.focus_areas               IS DISTINCT FROM COALESCE(p_focus_areas,   v_before.focus_areas));

  UPDATE vendor_risk_summary_objects SET
    study_context              = COALESCE(p_study_context, study_context),
    vendor_relevance_narrative = COALESCE(p_narrative,     vendor_relevance_narrative),
    focus_areas                = COALESCE(p_focus_areas,   focus_areas),
    approval_status            = CASE WHEN v_content_changed THEN 'DRAFT'::risk_summary_approval_status ELSE approval_status END,
    approved_at                = CASE WHEN v_content_changed THEN NULL ELSE approved_at END,
    approved_by                = CASE WHEN v_content_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'study_context',              v_before.study_context,
      'vendor_relevance_narrative', v_before.vendor_relevance_narrative,
      'focus_areas',                to_jsonb(v_before.focus_areas),
      'approval_status',            v_before.approval_status,
      'approved_at',                v_before.approved_at
    ),
    jsonb_build_object(
      'study_context',              v_after.study_context,
      'vendor_relevance_narrative', v_after.vendor_relevance_narrative,
      'focus_areas',                to_jsonb(v_after.focus_areas),
      'approval_status',            v_after.approval_status,
      'approved_at',                v_after.approved_at
    )
  );

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    v_after.id,
    v_diff,
    v_user,
    COALESCE(p_reason, CASE WHEN v_content_changed AND v_before.approval_status = 'APPROVED'
                            THEN 'Risk summary edited (auto-demoted to DRAFT)' ELSE NULL END)
  );

  RETURN v_after;
END;
$$;
