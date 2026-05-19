-- =============================================================================
-- Owner-scoped RLS for protocols and site_* tables.
--
-- Previous state (20260427120100 + 20260502000000):
--   protocols          SELECT TO authenticated USING (TRUE)   — global read
--   site_participants  ALL    TO authenticated USING (TRUE)   — fully open
--   site_visits        ALL    TO authenticated USING (TRUE)   — fully open
--   site_team_members  ALL    TO authenticated USING (TRUE)   — fully open
--
-- New state:
--   protocols          SELECT  → owner OR same-org user
--                      MODIFY  → owner only (org-mates can read, only owner writes)
--   site_*             ALL     → user can see the protocol (owner OR org-mate)
--                                — org-mates can read AND write participant /
--                                visit / team data, modelling shared coordinator
--                                workflows at a single site.
--
-- Implementation note: each site_* policy uses an inline EXISTS subquery
-- against `protocols` rather than a SECURITY DEFINER helper. Postgres can
-- plan the EXISTS as a hash-join scan, which is faster than a per-row
-- function call. The subquery is identical across the three tables.
--
-- The free-text org match uses `=` (single-org per user) rather than `IN`
-- because user_profiles.organization is scalar.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Drop the permissive policies. Idempotent — IF EXISTS no-ops if already gone.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "protocols_select_authenticated"      ON public.protocols;
DROP POLICY IF EXISTS "site_participants_authenticated"     ON public.site_participants;
DROP POLICY IF EXISTS "site_visits_authenticated"           ON public.site_visits;
DROP POLICY IF EXISTS "site_team_members_authenticated"     ON public.site_team_members;


-- ---------------------------------------------------------------------------
-- protocols: owner+org-mate read, owner-only write.
-- ---------------------------------------------------------------------------
CREATE POLICY "protocols_owner_select"
  ON public.protocols
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
  );

CREATE POLICY "protocols_owner_modify"
  ON public.protocols
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());


-- ---------------------------------------------------------------------------
-- site_participants: inherit scope via protocols.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_participants_via_protocol"
  ON public.site_participants
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_participants.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_participants.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  );


-- ---------------------------------------------------------------------------
-- site_visits: inherit scope via protocols.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_visits_via_protocol"
  ON public.site_visits
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_visits.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_visits.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  );


-- ---------------------------------------------------------------------------
-- site_team_members: inherit scope via protocols.
-- ---------------------------------------------------------------------------
CREATE POLICY "site_team_members_via_protocol"
  ON public.site_team_members
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_team_members.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = site_team_members.protocol_id
        AND (
          p.owner_id = auth.uid()
          OR p.owner_org = (SELECT organization FROM public.user_profiles WHERE id = auth.uid())
        )
    )
  );
