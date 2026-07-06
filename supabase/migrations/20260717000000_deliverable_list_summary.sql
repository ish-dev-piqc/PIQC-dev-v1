-- =============================================================================
-- Deliverables Overview — deliverable_list_summary read RPC.
--
-- Protocol-level status board: one row per EXISTING deliverable for a protocol,
-- with the review counts a sponsor/monitor needs to see at a glance before
-- drilling into one panel. Read-only; no new table, no enum, no write.
--
-- SECURITY INVOKER + STABLE: RLS on protocol_deliverables / protocol_deliverable_blocks
-- (both gated by user_can_access_protocol) is the access boundary. A protocol
-- the caller cannot see contributes no rows, so the result is an empty array,
-- never an error and never an existence leak — the deliverable_get_change_summary
-- precedent.
--
-- Counts EXCLUDE rejected blocks and mirror the export PDF's title-block stats:
--   total_blocks        = non-rejected blocks
--   reviewed_blocks     = review_state 'reviewed'
--   needs_review_blocks = OPEN work = 'draft' + 'needs_review'
-- (a fresh never-reviewed draft must read as open, not "0 needs review").
--
-- TS mirror: DeliverableSummary in src/types/deliverables/index.ts.
-- Design + decisions: plans/fable/deliverables-overview.md.
-- =============================================================================

CREATE OR REPLACE FUNCTION deliverable_list_summary(
  p_protocol_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
             jsonb_build_object(
               'deliverable_id',      d.id,
               'artifact_type',       d.artifact_type,
               'title',               d.title,
               'protocol_version',    d.protocol_version,
               'generated_at',        d.generated_at,
               'regenerated_at',      d.regenerated_at,
               'generation_seq',      d.generation_seq,
               'total_blocks',        c.total_blocks,
               'reviewed_blocks',     c.reviewed_blocks,
               'needs_review_blocks', c.needs_review_blocks
             )
             ORDER BY d.artifact_type
           )
      FROM protocol_deliverables d
      CROSS JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE b.review_state <> 'rejected')                AS total_blocks,
          COUNT(*) FILTER (WHERE b.review_state = 'reviewed')                 AS reviewed_blocks,
          COUNT(*) FILTER (WHERE b.review_state IN ('draft', 'needs_review')) AS needs_review_blocks
        FROM protocol_deliverable_blocks b
        WHERE b.deliverable_id = d.id
      ) c
     WHERE d.protocol_id = p_protocol_id
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION deliverable_list_summary IS
  'Protocol deliverable status board: a JSON array, one object per existing '
  'deliverable (artifact_type, title, generated/regenerated timestamps, '
  'generation_seq, and block counts — total / reviewed / needs_review, all '
  'excluding rejected). SECURITY INVOKER: RLS is the gate; an inaccessible '
  'protocol yields ''[]'' with no existence leak. Read-only. TS mirror: '
  'DeliverableSummary in src/types/deliverables/index.ts.';

GRANT EXECUTE ON FUNCTION deliverable_list_summary(UUID) TO authenticated;
