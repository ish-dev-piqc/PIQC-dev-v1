-- =============================================================================
-- Visit Prep — protocol-level completeness coverage (#4).
--
-- Dedup (#2) and aggregate-expansion (#3b) fix the *extracted* visit set; this
-- records whether that set looks *complete* against the protocol's own schedule.
-- Findings are protocol-level (a "Visit 5 is missing" gap has no visit_template
-- to hang a per-visit signal on), so they live here. One row per
-- (protocol, source_document); the ingest pipeline upserts it after persisting
-- templates (deterministic sequence reconciliation + unexpandable aggregates +
-- an adversarial LLM pass). Review-only — nothing here creates visits.
-- =============================================================================

CREATE TABLE protocol_visit_coverage (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id         UUID        NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  source_document_id  UUID        REFERENCES documents(id) ON DELETE SET NULL,
  expected_count      INTEGER     NOT NULL DEFAULT 0,
  found_count         INTEGER     NOT NULL DEFAULT 0,
  -- [{ label, reason, source: 'sequence' | 'aggregate' | 'llm' }]
  missing             JSONB       NOT NULL DEFAULT '[]'::jsonb,
  detected_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolution          TEXT        NOT NULL DEFAULT 'pending',
  UNIQUE (protocol_id, source_document_id)
);

CREATE INDEX protocol_visit_coverage_protocol_idx
  ON protocol_visit_coverage(protocol_id);

ALTER TABLE protocol_visit_coverage ENABLE ROW LEVEL SECURITY;

-- Owner / org / member access via the RLS-v3 helper (mirrors the other visit tables).
CREATE POLICY "protocol_visit_coverage_access"
  ON protocol_visit_coverage FOR ALL TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));


-- ---------------------------------------------------------------------------
-- Read RPC — returns the most recent coverage row for a protocol (or NULL).
-- SECURITY DEFINER + an access gate, matching visit_execution_get_workspace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION visit_execution_get_coverage(p_protocol_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_row  protocol_visit_coverage%ROWTYPE;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_can_access_protocol(v_user, p_protocol_id) THEN
    RETURN NULL;  -- empty rather than leak existence
  END IF;

  SELECT * INTO v_row
    FROM protocol_visit_coverage
   WHERE protocol_id = p_protocol_id
   ORDER BY detected_at DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN json_build_object(
    'expected_count', v_row.expected_count,
    'found_count',    v_row.found_count,
    'missing',        v_row.missing,
    'detected_at',    v_row.detected_at,
    'resolution',     v_row.resolution
  );
END;
$$;

GRANT EXECUTE ON FUNCTION visit_execution_get_coverage(UUID) TO authenticated;

COMMENT ON FUNCTION visit_execution_get_coverage IS
  'Read RPC (#4 completeness). Returns the latest protocol_visit_coverage row '
  'for a protocol as JSON (expected/found counts + missing[]), or NULL. Drives '
  'the Visit-Prep coverage banner.';
