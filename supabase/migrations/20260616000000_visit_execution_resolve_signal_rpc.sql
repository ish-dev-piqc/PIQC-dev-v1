-- =============================================================================
-- Visit Execution Workspace — Sprint 4c:
-- visit_execution_resolve_completeness_signal RPC.
--
-- Lets a site coordinator act on a pending row in visit_completeness_signals.
-- Two valid resolutions:
--
--   'added_as_requirement' — promote the gap into a new visit_requirements
--                            row. Origin = 'human_added'. Phase defaults to
--                            'assessment'; classification defaults to
--                            'required'. derived_text = signal.gap_text
--                            (preserves the LLM's verbatim wording for the
--                            audit trail even if the coordinator overrides);
--                            current_text = p_new_text when provided
--                            (non-empty trimmed string), else NULL. Ordinal
--                            is max(ordinal)+1 for the parent visit so the
--                            new row appears at the end of the assessment
--                            phase bucket.
--
--   'dismissed_not_real'   — just mark the signal resolved. No requirement
--                            row created.
--
-- Either branch sets resolution, acknowledged_by, acknowledged_at on the
-- signal row in the same transaction.
--
-- RLS — relies on the same protocol-owner gate as visit_completeness_signals
-- and visit_requirements policies. The SELECT…FOR UPDATE join through
-- protocol_visit_templates → protocols filters by auth.uid()'s reachable
-- protocols; if the caller can't see the signal, NOT FOUND fires and the
-- RPC raises a generic access-denied error.
-- =============================================================================

CREATE OR REPLACE FUNCTION visit_execution_resolve_completeness_signal(
  p_signal_id    UUID,
  p_resolution   visit_signal_resolution,
  p_new_text     TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user             UUID := auth.uid();
  v_signal           visit_completeness_signals;
  v_protocol_id      UUID;
  v_max_ordinal      INTEGER;
  v_new_req_id       UUID := NULL;
  v_override_text    TEXT;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Guard: this RPC handles human resolutions only. 'pending' here would be
  -- a no-op and likely a caller bug; reject it loudly rather than silently
  -- accepting and writing a confusing audit row.
  IF p_resolution NOT IN ('added_as_requirement'::visit_signal_resolution,
                          'dismissed_not_real'::visit_signal_resolution) THEN
    RAISE EXCEPTION 'Invalid resolution: must be added_as_requirement or dismissed_not_real'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the signal row + verify ownership in one shot. The join through
  -- protocols enforces the RLS predicate explicitly (cheaper than letting
  -- RLS run on the table — keeps the error message stable regardless of
  -- whether the signal exists or the caller can't see it).
  SELECT s.*
    INTO v_signal
    FROM visit_completeness_signals s
    JOIN protocol_visit_templates t ON t.id = s.visit_template_id
    JOIN protocols p ON p.id = t.protocol_id
   WHERE s.id = p_signal_id
     AND (
       p.owner_id = v_user
       OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = v_user)
     )
   FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signal not found or access denied'
      USING ERRCODE = '42501';
  END IF;

  -- Idempotency guard. Re-resolving an already-resolved signal is a UI race
  -- (double-click on the affordance, two browser tabs) — return the
  -- pre-existing state without writing anything.
  IF v_signal.resolution <> 'pending'::visit_signal_resolution THEN
    RETURN json_build_object(
      'signal_id',       v_signal.id,
      'resolution',      v_signal.resolution,
      'requirement_id',  NULL,
      'already_resolved', TRUE
    );
  END IF;

  -- Captured before any UPDATE — protocol_id is needed for the audit-context
  -- snapshot if we end up creating a requirement.
  SELECT t.protocol_id INTO v_protocol_id
    FROM protocol_visit_templates t
   WHERE t.id = v_signal.visit_template_id;

  -- ---------------------------------------------------------------------
  -- 'added_as_requirement' branch: insert visit_requirements row.
  -- ---------------------------------------------------------------------
  IF p_resolution = 'added_as_requirement'::visit_signal_resolution THEN
    -- Trim + null-out blank overrides. The DB constraint on derived_text
    -- (NOT NULL) is satisfied by gap_text; current_text is allowed to be
    -- NULL (UI then shows gap_text as the label).
    v_override_text := NULLIF(btrim(COALESCE(p_new_text, '')), '');

    SELECT COALESCE(MAX(ordinal), 0)
      INTO v_max_ordinal
      FROM visit_requirements
     WHERE visit_template_id = v_signal.visit_template_id;

    INSERT INTO visit_requirements (
      visit_template_id,
      ordinal,
      phase,
      classification,
      origin,
      derived_text,
      current_text,
      review_status
    )
    VALUES (
      v_signal.visit_template_id,
      v_max_ordinal + 1,
      'assessment'::execution_phase,
      'required'::item_classification,
      'human_added'::requirement_origin,
      v_signal.gap_text,
      v_override_text,
      -- Brand-new human-added row defaults to 'not_reviewed' so it shows
      -- in the coordinator's review queue. They can flip it to 'reviewed'
      -- via the existing menu actions once they've validated it.
      'not_reviewed'::execution_review_status
    )
    RETURNING id INTO v_new_req_id;
  END IF;

  -- Mark the signal resolved. Common to both branches.
  UPDATE visit_completeness_signals
     SET resolution      = p_resolution,
         acknowledged_by = v_user,
         acknowledged_at = NOW()
   WHERE id = v_signal.id;

  RETURN json_build_object(
    'signal_id',        v_signal.id,
    'resolution',       p_resolution,
    'requirement_id',   v_new_req_id,
    'already_resolved', FALSE
  );
END;
$$;


COMMENT ON FUNCTION visit_execution_resolve_completeness_signal IS
  'Sprint 4c. Resolves a pending row in visit_completeness_signals. For '
  'added_as_requirement also inserts a new visit_requirements row (origin = '
  'human_added) keyed to the same visit_template. Idempotent on re-resolve '
  'of an already-resolved signal.';
