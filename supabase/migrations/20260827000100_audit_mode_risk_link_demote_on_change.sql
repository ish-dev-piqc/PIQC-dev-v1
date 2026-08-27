-- =============================================================================
-- Risk-summary protocol links: demote on link/unlink (latch-integrity
-- follow-up to 20260826000000).
--
-- audit_mode_link_protocol_risk_to_summary / _unlink_ (20260430160000) mutate
-- the vendor_risk_summary_protocol_risks junction without touching the summary
-- row: an APPROVED summary stayed APPROVED with approved_at/approved_by
-- attesting to a risk set the approver never saw, the PRE_AUDIT_DRAFTING gate
-- stayed green, and — because updated_at never bumped — the approve CAS
-- (20260730000000) couldn't see mid-review link changes either.
--
-- Workflow decision (2026-08-26, see plans/sixonelabs-piqc/audit-approval-
-- latch-followups.md): the approval attests to the linked risk set. The
-- approver sees the linked-risk list in the panel, and the approve dialog
-- promises "Edits after approval revert it to Draft" — so link/unlink on an
-- APPROVED summary demotes it to DRAFT and clears approved_at/approved_by,
-- matching the demote-on-edit behavior of the summary's own content fields.
--
-- Every successful link/unlink now UPDATEs the summary row (a no-op SET when
-- already DRAFT), so the touch trigger bumps updated_at and the approve CAS
-- sees link changes made while a reviewer reads. No-op calls (already linked /
-- nothing to unlink) still return false without touching the summary.
--
-- The summary row is read FOR UPDATE before the junction write so a concurrent
-- approve serializes against the link change instead of racing it.
--
-- Same signatures as 20260430160000 → plain CREATE OR REPLACE (no PostgREST
-- overload risk, existing grants preserved). These RPCs have no UI call sites
-- today (riskSummaryApi.ts wraps them; nothing renders link controls) but are
-- granted to authenticated and reachable via PostgREST.
--
-- No type impact: no schema/column change.
-- =============================================================================


CREATE OR REPLACE FUNCTION audit_mode_link_protocol_risk_to_summary(
  p_summary_id      uuid,
  p_protocol_risk_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user   uuid := auth.uid();
  v_before vendor_risk_summary_objects;
  v_after  vendor_risk_summary_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects
   WHERE id = p_summary_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk summary % not found', p_summary_id USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO vendor_risk_summary_protocol_risks (risk_summary_id, protocol_risk_id)
  VALUES (p_summary_id, p_protocol_risk_id)
  ON CONFLICT DO NOTHING;

  IF NOT FOUND THEN
    RETURN FALSE; -- already linked
  END IF;

  UPDATE vendor_risk_summary_objects SET
    approval_status = CASE WHEN approval_status = 'APPROVED' THEN 'DRAFT'::risk_summary_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN approval_status = 'APPROVED' THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN approval_status = 'APPROVED' THEN NULL ELSE approved_by END
  WHERE id = p_summary_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    p_summary_id,
    jsonb_build_object(
      'linked_protocol_risk',
      jsonb_build_object('from', NULL, 'to', p_protocol_risk_id)
    )
    || CASE WHEN v_before.approval_status = 'APPROVED' THEN
         jsonb_build_object(
           'approval_status', jsonb_build_object('from', v_before.approval_status, 'to', v_after.approval_status),
           'approved_at',     jsonb_build_object('from', v_before.approved_at,     'to', v_after.approved_at)
         )
       ELSE '{}'::jsonb END,
    v_user,
    COALESCE(p_reason, CASE WHEN v_before.approval_status = 'APPROVED'
                            THEN 'Protocol risk linked (summary auto-demoted to DRAFT)'
                            ELSE 'Protocol risk linked' END)
  );

  RETURN TRUE;
END;
$$;


CREATE OR REPLACE FUNCTION audit_mode_unlink_protocol_risk_from_summary(
  p_summary_id      uuid,
  p_protocol_risk_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user    uuid := auth.uid();
  v_deleted integer;
  v_before  vendor_risk_summary_objects;
  v_after   vendor_risk_summary_objects;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM vendor_risk_summary_objects
   WHERE id = p_summary_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Risk summary % not found', p_summary_id USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM vendor_risk_summary_protocol_risks
   WHERE risk_summary_id = p_summary_id
     AND protocol_risk_id = p_protocol_risk_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  IF v_deleted = 0 THEN
    RETURN FALSE;
  END IF;

  UPDATE vendor_risk_summary_objects SET
    approval_status = CASE WHEN approval_status = 'APPROVED' THEN 'DRAFT'::risk_summary_approval_status ELSE approval_status END,
    approved_at     = CASE WHEN approval_status = 'APPROVED' THEN NULL ELSE approved_at END,
    approved_by     = CASE WHEN approval_status = 'APPROVED' THEN NULL ELSE approved_by END
  WHERE id = p_summary_id
  RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'VENDOR_RISK_SUMMARY_OBJECT'::tracked_object_type,
    p_summary_id,
    jsonb_build_object(
      'unlinked_protocol_risk',
      jsonb_build_object('from', p_protocol_risk_id, 'to', NULL)
    )
    || CASE WHEN v_before.approval_status = 'APPROVED' THEN
         jsonb_build_object(
           'approval_status', jsonb_build_object('from', v_before.approval_status, 'to', v_after.approval_status),
           'approved_at',     jsonb_build_object('from', v_before.approved_at,     'to', v_after.approved_at)
         )
       ELSE '{}'::jsonb END,
    v_user,
    COALESCE(p_reason, CASE WHEN v_before.approval_status = 'APPROVED'
                            THEN 'Protocol risk unlinked (summary auto-demoted to DRAFT)'
                            ELSE 'Protocol risk unlinked' END)
  );

  RETURN TRUE;
END;
$$;
