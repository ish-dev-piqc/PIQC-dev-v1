-- =============================================================================
-- Audit Mode — Stage 7 LLM-authored executive summary (foundation)
--
-- Adds provenance tracking for the executive_summary text on report_draft_objects:
-- did this draft come from the templated prefill (PR #62), an LLM refinement
-- (this PR), or has the auditor edited it manually? The text itself is still
-- a free-form string the auditor reviews and approves; the source column makes
-- the trail GxP-explainable ("this report's exec summary started from an LLM
-- draft, was edited by the auditor on 2026-05-16, and approved on 2026-05-18").
--
-- The LLM call itself runs in supabase/functions/audit-summary/ (new edge
-- function added in this PR). The edge function fetches Stage 4 + Stage 6
-- context server-side, calls OpenAI gpt-4o-mini, and returns the narrative
-- to the client. The client then calls audit_mode_upsert_report_draft with
-- the new text + executive_summary_source='llm'. No autonomous database
-- writes from the edge function — auditor still owns the apply step.
--
-- Data-handling stance (consistent with existing OpenAI plumbing in
-- supabase/functions/chat/ and supabase/functions/dashboard-chat/):
--   - workspace observation_text IS sent to OpenAI
--   - source_extracted_item_id IS sent (as a hint, not for in-prose citation)
--   - sponsor names are NOT sent (existing project rule; sponsor-name-free)
--   - the edge function logs counts only, not bodies (matches chat/ pattern)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Schema — provenance column
--
-- DEFAULT 'templated' so all existing rows (including those created by PR
-- #62's prefill) backfill correctly. The prefill RPC doesn't need updating —
-- inserting without specifying executive_summary_source picks up the default.
-- -----------------------------------------------------------------------------
ALTER TABLE report_draft_objects
  ADD COLUMN executive_summary_source TEXT NOT NULL DEFAULT 'templated'
    CHECK (executive_summary_source IN ('templated', 'llm', 'auditor_edited'));


-- -----------------------------------------------------------------------------
-- Replace audit_mode_upsert_report_draft to accept the new optional param.
--
-- DROP first because adding a parameter (even with DEFAULT) creates a new
-- function signature; without the drop, the old signature would linger and
-- silently shadow the new one for clients calling positionally.
--
-- The new p_executive_summary_source param is OPTIONAL — when NULL, the
-- current source is preserved (so a save that only changes conclusions
-- doesn't reset the exec-summary provenance). Transitions are client-driven;
-- the server only enforces the CHECK constraint values.
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS audit_mode_upsert_report_draft(uuid, text, text, text);

CREATE OR REPLACE FUNCTION audit_mode_upsert_report_draft(
  p_audit_id                  uuid,
  p_executive_summary         text,
  p_conclusions               text,
  p_reason                    text DEFAULT NULL,
  p_executive_summary_source  text DEFAULT NULL
)
RETURNS report_draft_objects
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user            uuid := auth.uid();
  v_before          report_draft_objects;
  v_after           report_draft_objects;
  v_diff            jsonb;
  v_text_changed    boolean := FALSE;
  v_new_source      text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Validate the source value if the caller sent one. CHECK constraint will
  -- also catch this, but raising early gives a cleaner error message.
  IF p_executive_summary_source IS NOT NULL
     AND p_executive_summary_source NOT IN ('templated', 'llm', 'auditor_edited') THEN
    RAISE EXCEPTION 'Invalid executive_summary_source: %', p_executive_summary_source
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_before FROM report_draft_objects WHERE audit_id = p_audit_id;

  IF NOT FOUND THEN
    -- Fresh insert. Default the source to 'auditor_edited' if the caller is
    -- driving a manual create (no prefill ran first), or honour whatever
    -- the client explicitly sent.
    v_new_source := COALESCE(p_executive_summary_source, 'auditor_edited');

    INSERT INTO report_draft_objects (
      audit_id, executive_summary, conclusions, approval_status,
      executive_summary_source
    )
    VALUES (p_audit_id, p_executive_summary, p_conclusions, 'DRAFT', v_new_source)
    RETURNING * INTO v_after;

    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      jsonb_build_object(
        'executive_summary',        jsonb_build_object('from', NULL, 'to', v_after.executive_summary),
        'conclusions',              jsonb_build_object('from', NULL, 'to', v_after.conclusions),
        'approval_status',          jsonb_build_object('from', NULL, 'to', v_after.approval_status),
        'executive_summary_source', jsonb_build_object('from', NULL, 'to', v_after.executive_summary_source)
      ),
      v_user,
      COALESCE(p_reason, 'Report draft created')
    );
    RETURN v_after;
  END IF;

  v_text_changed := (v_before.executive_summary IS DISTINCT FROM p_executive_summary)
                 OR (v_before.conclusions IS DISTINCT FROM p_conclusions);

  -- Source resolution:
  --   - explicit value from caller → use it (auditor clicked LLM refine, or
  --     auditor saved a manual edit and the client tagged it 'auditor_edited')
  --   - omitted (NULL) → preserve the existing source (save that only changed
  --     conclusions shouldn't flip exec-summary provenance)
  v_new_source := COALESCE(p_executive_summary_source, v_before.executive_summary_source);

  UPDATE report_draft_objects SET
    executive_summary        = p_executive_summary,
    conclusions              = p_conclusions,
    executive_summary_source = v_new_source,
    approval_status          = CASE WHEN v_text_changed THEN 'DRAFT'::deliverable_approval_status
                                    ELSE approval_status END,
    approved_at              = CASE WHEN v_text_changed THEN NULL ELSE approved_at END,
    approved_by              = CASE WHEN v_text_changed THEN NULL ELSE approved_by END
  WHERE id = v_before.id
  RETURNING * INTO v_after;

  v_diff := audit_mode_diff_jsonb(
    jsonb_build_object(
      'executive_summary',        v_before.executive_summary,
      'conclusions',              v_before.conclusions,
      'approval_status',          v_before.approval_status,
      'executive_summary_source', v_before.executive_summary_source
    ),
    jsonb_build_object(
      'executive_summary',        v_after.executive_summary,
      'conclusions',              v_after.conclusions,
      'approval_status',          v_after.approval_status,
      'executive_summary_source', v_after.executive_summary_source
    )
  );

  IF v_diff <> '{}'::jsonb THEN
    PERFORM audit_mode_write_delta(
      'REPORT_DRAFT_OBJECT'::tracked_object_type,
      v_after.id,
      v_diff,
      v_user,
      p_reason
    );
  END IF;

  RETURN v_after;
END;
$$;


-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION audit_mode_upsert_report_draft(uuid, text, text, text, text)
  TO authenticated;
