-- =============================================================================
-- Audit Mode — lock audits.current_stage behind the gated RPC (post-#449 audit
-- report, vulnerability V1).
--
-- The stage gate lives only inside audit_mode_advance_audit_stage
-- (20260430200000, hardened fail-closed in 20260719000000). But the RPC is
-- SECURITY INVOKER and RLS policy audits_update_lead_auditor (20260427120100)
-- grants the lead auditor UPDATE on ALL columns of their own audit — so a
-- client could `PATCH /rest/v1/audits {"current_stage": ...}` and skip every
-- gate (vendor and ISA alike). Not cross-tenant, but the audit owner could
-- bypass their own GxP integrity gate, and the transition would leave no
-- state_history_deltas row.
--
-- Mechanism: column-level privileges + SECURITY DEFINER RPC (chosen over a
-- BEFORE UPDATE trigger). The RPC becomes the only possible writer of
-- current_stage, so the gate logic stays byte-identical in one place, every
-- stage change necessarily writes its delta, and service_role/postgres (seeds,
-- ops) are untouched because the REVOKE targets authenticated/anon only.
-- Verified: no seed, script, or other function UPDATEs current_stage — the
-- advance RPC holds the only `UPDATE audits` statements in the repo.
--
-- The RPC body below is byte-identical to 20260719000000 except:
--   1. SECURITY INVOKER → SECURITY DEFINER (required: the invoker no longer
--      holds UPDATE privilege on the column).
--   2. An explicit lead-auditor ownership check after the row lookup. Under
--      INVOKER, RLS hid other users' audits and the RPC raised
--      `P0002 Audit not found`; DEFINER bypasses RLS, so the same behavior is
--      reproduced explicitly — same ERRCODE, same message, no existence leak.
-- All gate hints (GATE_QUESTIONNAIRE_NOT_APPROVED, GATE_RISK_SUMMARY_NOT_APPROVED,
-- GATE_DELIVERABLES_NOT_APPROVED, STAGE_NOT_IN_ADVANCEMENT_MAP) and ERRCODEs are
-- unchanged, so the advanceStageError UI shipped in #458 needs no changes.
--
-- No TS type impact: no table/column/enum change; RPC name, arguments, and
-- return type unchanged.
--
-- Deliberately deferred (B6): audit_mode_get_stage_readout still reports
-- stage_position NULL / total 8 for ISA audits. It has zero frontend callers
-- and is fail-safe (can_advance FALSE); fixing it belongs to the future ISA
-- workspace feature that defines ISA gate semantics.
--
-- Owner: @rv61.
-- =============================================================================

-- 1. Column lockdown. RLS policy audits_update_lead_auditor keeps row-scoping
--    the columns re-granted here.
REVOKE UPDATE ON audits FROM authenticated, anon;
GRANT UPDATE (audit_name, status, scheduled_date) ON audits TO authenticated;

-- 2. Advance RPC, now the sole writer of current_stage.
CREATE OR REPLACE FUNCTION audit_mode_advance_audit_stage(
  p_audit_id uuid,
  p_to_stage audit_stage,
  p_reason   text DEFAULT NULL
)
RETURNS audits
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user                       uuid := auth.uid();
  v_before                     audits;
  v_after                      audits;
  v_from_idx                   integer;
  v_to_idx                     integer;
  v_questionnaire_approved_at  timestamptz;
  v_risk_summary_status        risk_summary_approval_status;
  v_letter_status              deliverable_approval_status;
  v_agenda_status              deliverable_approval_status;
  v_checklist_status           deliverable_approval_status;
  v_blocked                    text[] := ARRAY[]::text[];
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypasses RLS; reproduce the INVOKER-era visibility rule
  -- explicitly. Same error as the not-found branch — no existence leak.
  IF v_before.lead_auditor_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  IF v_before.current_stage = p_to_stage THEN
    RAISE EXCEPTION 'Audit is already at stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  v_from_idx := audit_mode_stage_index(v_before.current_stage);
  v_to_idx   := audit_mode_stage_index(p_to_stage);

  -- Fail closed: an unmapped stage (any ISA_* value — audit_mode_stage_index
  -- does not map these) must never bypass the ordering/gate checks by making the
  -- forward comparison NULL. Reject rather than fall through to the UPDATE.
  IF v_from_idx IS NULL OR v_to_idx IS NULL THEN
    RAISE EXCEPTION 'Stage transition not permitted: % → % is not in the advancement map',
      v_before.current_stage, p_to_stage
      USING ERRCODE = '22023', HINT = 'STAGE_NOT_IN_ADVANCEMENT_MAP';
  END IF;

  -- Forward: must move exactly +1 and gate must pass.
  IF v_to_idx > v_from_idx THEN
    IF v_to_idx - v_from_idx <> 1 THEN
      RAISE EXCEPTION 'Forward transitions must move exactly one stage (% → %)',
        v_before.current_stage, p_to_stage USING ERRCODE = '22023';
    END IF;

    -- Gate: PRE_AUDIT_DRAFTING needs questionnaire + risk summary approved.
    IF p_to_stage = 'PRE_AUDIT_DRAFTING' THEN
      SELECT qi.approved_at  INTO v_questionnaire_approved_at FROM questionnaire_instances qi WHERE qi.audit_id = p_audit_id;
      SELECT rs.approval_status INTO v_risk_summary_status     FROM vendor_risk_summary_objects rs WHERE rs.audit_id = p_audit_id;
      IF v_questionnaire_approved_at IS NULL THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: questionnaire is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_QUESTIONNAIRE_NOT_APPROVED';
      END IF;
      IF v_risk_summary_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Cannot enter PRE_AUDIT_DRAFTING: vendor risk summary is not approved'
          USING ERRCODE = '42501', HINT = 'GATE_RISK_SUMMARY_NOT_APPROVED';
      END IF;
    END IF;

    -- Gate: AUDIT_CONDUCT needs all three deliverables approved.
    IF p_to_stage = 'AUDIT_CONDUCT' THEN
      SELECT cl.approval_status INTO v_letter_status    FROM confirmation_letter_objects cl WHERE cl.audit_id = p_audit_id;
      SELECT ag.approval_status INTO v_agenda_status    FROM agenda_objects ag             WHERE ag.audit_id = p_audit_id;
      SELECT ch.approval_status INTO v_checklist_status FROM checklist_objects ch          WHERE ch.audit_id = p_audit_id;

      IF v_letter_status    IS NULL OR v_letter_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'confirmation_letter'); END IF;
      IF v_agenda_status    IS NULL OR v_agenda_status    <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'agenda');              END IF;
      IF v_checklist_status IS NULL OR v_checklist_status <> 'APPROVED' THEN v_blocked := array_append(v_blocked, 'checklist');           END IF;
      IF array_length(v_blocked, 1) > 0 THEN
        RAISE EXCEPTION 'Cannot enter AUDIT_CONDUCT: deliverables not approved (%)', array_to_string(v_blocked, ', ')
          USING ERRCODE = '42501', HINT = 'GATE_DELIVERABLES_NOT_APPROVED';
      END IF;
    END IF;
  END IF;
  -- Backward (v_to_idx < v_from_idx): allowed, no gate.

  UPDATE audits SET current_stage = p_to_stage WHERE id = p_audit_id RETURNING * INTO v_after;

  PERFORM audit_mode_write_delta(
    'AUDIT'::tracked_object_type,
    v_after.id,
    jsonb_build_object(
      'current_stage', jsonb_build_object('from', v_before.current_stage, 'to', v_after.current_stage)
    ),
    v_user,
    p_reason
  );

  RETURN v_after;
END;
$$;

GRANT EXECUTE ON FUNCTION audit_mode_advance_audit_stage(uuid, audit_stage, text) TO authenticated;
