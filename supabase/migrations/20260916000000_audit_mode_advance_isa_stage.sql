-- =============================================================================
-- Audit Mode — ISA stage advancement (isa-stage-advance)
--
-- An investigator site audit cannot leave ISA_SITE_INTAKE today:
-- audit_mode_stage_index (20260430200000) maps only the eight vendor stages
-- and audit_mode_advance_audit_stage fails closed on any ISA_* value
-- (20260719000000, HINT STAGE_NOT_IN_ADVANCEMENT_MAP). That migration also
-- explains why the ISA stages must NOT be slotted into the vendor index: a
-- shared 0..N ordering would make a vendor stage a +1 neighbour of an ISA
-- stage and open a cross-workflow transition.
--
-- So the ISA pipeline gets its own index and its own advance RPC. New
-- function names only: the deployed vendor RPC (20260730000000 body) and
-- audit_mode_stage_index are untouched — no drift window for vendor audits,
-- no PostgREST overload.
--
-- audit_mode_advance_isa_stage mirrors the vendor RPC's rules:
--   - SECURITY DEFINER. Required, not a choice: 20260721000100 revoked UPDATE
--     on audits.current_stage from authenticated, so only a DEFINER function
--     can write it. The lead-auditor check is therefore explicit (same
--     `P0002 Audit not found` on both branches — no existence leak).
--   - Rejects a non-ISA audit outright (22023 / WORKFLOW_NOT_ISA). The vendor
--     RPC rejects the mirror case through its own map, so the two pipelines
--     can never cross in either direction.
--   - Exactly one step forward; backward ungated; same delta write
--     (state_history_deltas, object AUDIT), so every ISA stage change is
--     reconstructible from history exactly like a vendor one.
--   - NO content gates yet. The ISA gate semantics (what must be approved
--     before ISA_PREP / ISA_CONDUCT / ISA_EXPORT) are not designed; the
--     forward branch marks the slots and plans/sixonelabs-piqc/isa-stage-advance.md
--     ledgers them. Adding a gate later is a CREATE OR REPLACE of this body
--     with the frontend contract unchanged.
--
-- Error codes and hints are the vendor RPC's, so the existing
-- advanceStageError surface (message + hint) needs no change.
--
-- Deliberately deferred (B6, as in 20260721000100): audit_mode_get_stage_readout
-- still reports position NULL / total 8 for ISA audits. No frontend caller;
-- the ISA transition card is not readout-driven.
--
-- No TS type impact: no table/column/enum change; functions only.
--
-- Owner: @rv61.
-- =============================================================================

-- 1. ISA stage index — the ISA pipeline's own 0..6 ordering. Mirrors the
--    shape of audit_mode_stage_index; kept as a separate function on purpose
--    (see header). No ELSE: an unmapped stage yields NULL and the RPC below
--    fails closed on it.
CREATE OR REPLACE FUNCTION public.audit_mode_isa_stage_index(p_stage audit_stage)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_stage
    WHEN 'ISA_SITE_INTAKE'     THEN 0
    WHEN 'ISA_RISK_ASSESSMENT' THEN 1
    WHEN 'ISA_SCOPE_BUILDER'   THEN 2
    WHEN 'ISA_PREP'            THEN 3
    WHEN 'ISA_CONDUCT'         THEN 4
    WHEN 'ISA_REPORT'          THEN 5
    WHEN 'ISA_EXPORT'          THEN 6
  END;
$$;

-- 2. ISA advance RPC — the only writer of current_stage for ISA audits.
CREATE OR REPLACE FUNCTION public.audit_mode_advance_isa_stage(
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
  v_user     uuid := auth.uid();
  v_before   audits;
  v_after    audits;
  v_from_idx integer;
  v_to_idx   integer;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_before FROM audits WHERE id = p_audit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  -- SECURITY DEFINER bypasses RLS; reproduce the lead-auditor visibility rule
  -- explicitly. Same error as the not-found branch — no existence leak.
  IF v_before.lead_auditor_id IS DISTINCT FROM v_user THEN
    RAISE EXCEPTION 'Audit % not found', p_audit_id USING ERRCODE = 'P0002';
  END IF;

  -- Pipeline check: this RPC moves investigator site audits only. A vendor
  -- audit never enters the ISA ordering, whatever stage is requested.
  IF v_before.workflow_type <> 'INVESTIGATOR_SITE_AUDIT' THEN
    RAISE EXCEPTION 'Audit % is not an investigator site audit', p_audit_id
      USING ERRCODE = '22023', HINT = 'WORKFLOW_NOT_ISA';
  END IF;

  IF v_before.current_stage = p_to_stage THEN
    RAISE EXCEPTION 'Audit is already at stage %', p_to_stage USING ERRCODE = '22023';
  END IF;

  v_from_idx := audit_mode_isa_stage_index(v_before.current_stage);
  v_to_idx   := audit_mode_isa_stage_index(p_to_stage);

  -- Fail closed: a stage outside the ISA map (any vendor value, or a future
  -- enum value not yet ordered here) must never make the forward comparison
  -- NULL and fall through to the UPDATE.
  IF v_from_idx IS NULL OR v_to_idx IS NULL THEN
    RAISE EXCEPTION 'Stage transition not permitted: % → % is not in the ISA advancement map',
      v_before.current_stage, p_to_stage
      USING ERRCODE = '22023', HINT = 'STAGE_NOT_IN_ADVANCEMENT_MAP';
  END IF;

  -- Forward: must move exactly +1. No content gates yet (see header).
  IF v_to_idx > v_from_idx THEN
    IF v_to_idx - v_from_idx <> 1 THEN
      RAISE EXCEPTION 'Forward transitions must move exactly one stage (% → %)',
        v_before.current_stage, p_to_stage USING ERRCODE = '22023';
    END IF;
    -- Gate slots (ledgered in plans/sixonelabs-piqc/isa-stage-advance.md):
    --   p_to_stage = 'ISA_PREP'    — site scope approved (Scope builder output)
    --   p_to_stage = 'ISA_CONDUCT' — prep deliverables approved
    --   p_to_stage = 'ISA_EXPORT'  — report marked ready
  END IF;
  -- Backward (v_to_idx < v_from_idx): allowed, no gate — as the vendor RPC.

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

-- 3. Grants (20260911000000 pattern): drop the default PUBLIC/anon EXECUTE,
--    grant the roles that call through PostgREST or the service key.
--    Signatures pinned so a future overload never inherits these by name.
REVOKE EXECUTE ON FUNCTION public.audit_mode_isa_stage_index(audit_stage)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_isa_stage_index(audit_stage)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.audit_mode_advance_isa_stage(uuid, audit_stage, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_mode_advance_isa_stage(uuid, audit_stage, text)
  TO authenticated, service_role;
