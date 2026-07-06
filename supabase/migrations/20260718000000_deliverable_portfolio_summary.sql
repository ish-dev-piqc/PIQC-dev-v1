-- =============================================================================
-- Portfolio digest — deliverable_portfolio_summary read RPC.
--
-- Cross-protocol status board: one row per protocol that has at least one
-- deliverable, aggregating its deliverable coverage + review backlog. Powers
-- the Sponsor Protocol Intelligence tab's portfolio grid (the sponsor zooms out
-- from one protocol to the whole portfolio). Read-only; no arg, no table/enum.
--
-- SECURITY INVOKER + STABLE: RLS on protocol_deliverables / protocol_deliverable_blocks
-- (both gated by user_can_access_protocol) is the boundary — a protocol the
-- caller cannot see contributes no rows, so the result reflects only their
-- portfolio, never an existence leak. Protocols with zero deliverables simply
-- do not appear (the client already holds the full protocol list from
-- ProtocolContext and overlays these stats).
--
-- Counts mirror deliverable_list_summary / the export PDF stats: exclude
-- rejected; needs_review = open work (draft + needs_review). deliverable_count
-- = number of artifact types generated for the protocol (one deliverable row
-- per protocol+type).
--
-- TS mirror: DeliverablePortfolioEntry in src/types/deliverables/index.ts.
-- Design + decisions: plans/fable/deliverable-portfolio.md.
-- =============================================================================

CREATE OR REPLACE FUNCTION deliverable_portfolio_summary()
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
               'protocol_id',         p.protocol_id,
               'deliverable_count',   p.deliverable_count,
               'total_blocks',        p.total_blocks,
               'reviewed_blocks',     p.reviewed_blocks,
               'needs_review_blocks', p.needs_review_blocks,
               'last_generated_at',   p.last_generated_at
             )
             ORDER BY p.protocol_id
           )
      FROM (
        SELECT
          d.protocol_id,
          COUNT(DISTINCT d.id)                          AS deliverable_count,
          COALESCE(SUM(c.total_blocks), 0)              AS total_blocks,
          COALESCE(SUM(c.reviewed_blocks), 0)           AS reviewed_blocks,
          COALESCE(SUM(c.needs_review_blocks), 0)       AS needs_review_blocks,
          MAX(GREATEST(d.generated_at, COALESCE(d.regenerated_at, d.generated_at)))
                                                        AS last_generated_at
        FROM protocol_deliverables d
        CROSS JOIN LATERAL (
          SELECT
            COUNT(*) FILTER (WHERE b.review_state <> 'rejected')                AS total_blocks,
            COUNT(*) FILTER (WHERE b.review_state = 'reviewed')                 AS reviewed_blocks,
            COUNT(*) FILTER (WHERE b.review_state IN ('draft', 'needs_review')) AS needs_review_blocks
          FROM protocol_deliverable_blocks b
          WHERE b.deliverable_id = d.id
        ) c
        GROUP BY d.protocol_id
      ) p
  ), '[]'::jsonb);
END;
$$;

COMMENT ON FUNCTION deliverable_portfolio_summary IS
  'Portfolio-level deliverable digest: a JSON array, one object per protocol '
  'with at least one deliverable (deliverable_count, block counts total / '
  'reviewed / needs_review excluding rejected, last_generated_at). SECURITY '
  'INVOKER: RLS is the gate; only the caller''s accessible protocols appear, '
  'no existence leak. Read-only. TS mirror: DeliverablePortfolioEntry in '
  'src/types/deliverables/index.ts.';

GRANT EXECUTE ON FUNCTION deliverable_portfolio_summary() TO authenticated;
