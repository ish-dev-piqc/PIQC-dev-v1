-- =============================================================================
-- list_my_sponsor_portfolio — read-only roll-up for Sponsor Mode.
--
-- Returns one row per protocol that the caller's org sponsors (via
-- sponsor_relationships) with aggregate stats: site-org name, participant
-- count, last visit date.
--
-- SECURITY DEFINER because sponsor_relationships has no RLS read policy
-- (the stub migration locked it down). Access is gated by the WHERE clause
-- joining org_members on auth.uid() — a caller only sees protocols their
-- sponsor-org actually has a relationship with.
--
-- Empty result is the "no sponsor access yet" signal — the UI shows the
-- existing coming-soon page in that case.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_my_sponsor_portfolio()
RETURNS TABLE (
  protocol_id       UUID,
  protocol_code     TEXT,
  protocol_title    TEXT,
  site_org_id       UUID,
  site_org_name     TEXT,
  participant_count INTEGER,
  last_visit_at     DATE
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    p.id            AS protocol_id,
    p.study_number  AS protocol_code,
    p.title         AS protocol_title,
    so.id           AS site_org_id,
    so.name         AS site_org_name,
    COUNT(DISTINCT sp.id)::INTEGER AS participant_count,
    MAX(sv.date)    AS last_visit_at
  FROM public.sponsor_relationships sr
  JOIN public.org_members om
    ON om.org_id = sr.sponsor_org_id
    AND om.user_id = auth.uid()
  JOIN public.protocols p
    ON p.owner_org_id = sr.site_org_id
  JOIN public.orgs so
    ON so.id = sr.site_org_id
  LEFT JOIN public.site_participants sp
    ON sp.protocol_id = p.id
  LEFT JOIN public.site_visits sv
    ON sv.protocol_id = p.id
  GROUP BY p.id, p.study_number, p.title, so.id, so.name
  ORDER BY MAX(sv.date) DESC NULLS LAST, p.title ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_my_sponsor_portfolio() TO authenticated;
