-- =============================================================================
-- Owner-scoped RLS v2 — uses orgs / org_members instead of free-text matching.
--
-- Old (B1, 20260519000200):
--   protocols_owner_select USING (
--     owner_id = auth.uid()
--     OR owner_org = (SELECT organization FROM user_profiles WHERE id = auth.uid())
--   )
--
-- New:
--   protocols_owner_select USING (
--     owner_id = auth.uid()
--     OR owner_org_id IN (SELECT org_id FROM org_members WHERE user_id = auth.uid())
--   )
--
-- Plus the site_* inheritance subqueries get the same upgrade. Behaviour is
-- identical for users whose `user_profiles.organization` matched cleanly;
-- safer (typo-proof) for everyone else.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Drop the v1 policies. Idempotent.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "protocols_owner_select"          ON public.protocols;
DROP POLICY IF EXISTS "protocols_owner_modify"          ON public.protocols;
DROP POLICY IF EXISTS "site_participants_via_protocol"  ON public.site_participants;
DROP POLICY IF EXISTS "site_visits_via_protocol"        ON public.site_visits;
DROP POLICY IF EXISTS "site_team_members_via_protocol"  ON public.site_team_members;


-- ---------------------------------------------------------------------------
-- protocols
-- ---------------------------------------------------------------------------
CREATE POLICY "protocols_owner_select" ON public.protocols
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

-- Modify (INSERT/UPDATE/DELETE) — only the owner OR an admin of the org
-- that owns it can write. Org members without admin role can read but not
-- modify protocol metadata.
CREATE POLICY "protocols_owner_modify" ON public.protocols
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR owner_org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR owner_org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );


-- ---------------------------------------------------------------------------
-- site_* tables — inherit visibility via protocols join.
-- Any org member (admin or not) can read AND write participants / visits /
-- team rows for protocols owned by their org. Day-to-day coordinator work
-- happens here; gating writes on admin-only would block routine flows.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_participants_via_protocol" ON public.site_participants
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_participants.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_participants.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  );

CREATE POLICY "site_visits_via_protocol" ON public.site_visits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_visits.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_visits.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  );

CREATE POLICY "site_team_members_via_protocol" ON public.site_team_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_team_members.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_team_members.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
        )
    )
  );
