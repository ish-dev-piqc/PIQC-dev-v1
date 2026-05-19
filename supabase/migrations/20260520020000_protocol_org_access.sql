-- =============================================================================
-- protocol_org_access — M:N between protocols and orgs.
--
-- Every protocol has exactly one row with role='owner' (mirroring
-- protocols.owner_org_id), plus zero or more 'collaborator' rows for orgs
-- granted shared access (sponsor + CRO + site multi-party workflows).
--
-- RLS on protocols + site_* is rewritten to consult this table — any user
-- whose org has access (either role) can read; only owning-org admins can
-- modify protocol metadata.
--
-- Backward compatible: a protocol with no collaborator rows behaves exactly
-- like C1 did. New capability layers on top, doesn't remove anything.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protocol_org_access (
  protocol_id  UUID         NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  org_id       UUID         NOT NULL REFERENCES public.orgs(id)      ON DELETE CASCADE,
  role         TEXT         NOT NULL DEFAULT 'collaborator'
                                CHECK (role IN ('owner', 'collaborator')),
  granted_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by   UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (protocol_id, org_id)
);

CREATE INDEX IF NOT EXISTS protocol_org_access_org_id_idx ON public.protocol_org_access(org_id);

-- Owner-uniqueness: each protocol may have only one owner row.
CREATE UNIQUE INDEX IF NOT EXISTS protocol_org_access_one_owner_per_protocol
  ON public.protocol_org_access(protocol_id) WHERE role = 'owner';

ALTER TABLE public.protocol_org_access ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- RLS — read for any member of an org with access; write for owning-org admins
-- ---------------------------------------------------------------------------
CREATE POLICY "protocol_org_access_member_select" ON public.protocol_org_access
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "protocol_org_access_owner_admin_modify" ON public.protocol_org_access
  FOR ALL TO authenticated
  USING (
    protocol_id IN (
      SELECT poa.protocol_id FROM public.protocol_org_access poa
      JOIN public.org_members om ON om.org_id = poa.org_id
      WHERE poa.role = 'owner'
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  )
  WITH CHECK (
    protocol_id IN (
      SELECT poa.protocol_id FROM public.protocol_org_access poa
      JOIN public.org_members om ON om.org_id = poa.org_id
      WHERE poa.role = 'owner'
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );


-- ---------------------------------------------------------------------------
-- Backfill: every existing protocol gets its owner row.
-- ---------------------------------------------------------------------------
INSERT INTO public.protocol_org_access (protocol_id, org_id, role)
SELECT p.id, p.owner_org_id, 'owner'
FROM public.protocols p
WHERE p.owner_org_id IS NOT NULL
ON CONFLICT (protocol_id, org_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- AFTER-INSERT trigger on protocols: auto-create the owner row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protocols_create_owner_access()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_org_id IS NOT NULL THEN
    INSERT INTO public.protocol_org_access (protocol_id, org_id, role, granted_by)
    VALUES (NEW.id, NEW.owner_org_id, 'owner', NEW.owner_id)
    ON CONFLICT (protocol_id, org_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protocols_create_owner_access_trg ON public.protocols;
CREATE TRIGGER protocols_create_owner_access_trg
  AFTER INSERT ON public.protocols
  FOR EACH ROW
  EXECUTE FUNCTION public.protocols_create_owner_access();


-- ---------------------------------------------------------------------------
-- Rewrite protocols + site_* RLS to consult protocol_org_access instead of
-- owner_org_id directly. New check: "is the user a member of any org that
-- has access to this protocol?"
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "protocols_owner_select"        ON public.protocols;
DROP POLICY IF EXISTS "protocols_owner_modify"        ON public.protocols;
DROP POLICY IF EXISTS "site_participants_via_protocol" ON public.site_participants;
DROP POLICY IF EXISTS "site_visits_via_protocol"       ON public.site_visits;
DROP POLICY IF EXISTS "site_team_members_via_protocol" ON public.site_team_members;


-- protocols: any access row's org is a member → can read.
-- Only owning-org admins can modify protocol metadata.
CREATE POLICY "protocols_org_access_select" ON public.protocols
  FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT poa.protocol_id FROM public.protocol_org_access poa
      WHERE poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "protocols_owning_org_admin_modify" ON public.protocols
  FOR ALL TO authenticated
  USING (
    owner_id = auth.uid()
    OR id IN (
      SELECT poa.protocol_id FROM public.protocol_org_access poa
      JOIN public.org_members om ON om.org_id = poa.org_id
      WHERE poa.role = 'owner'
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR id IN (
      SELECT poa.protocol_id FROM public.protocol_org_access poa
      JOIN public.org_members om ON om.org_id = poa.org_id
      WHERE poa.role = 'owner'
        AND om.user_id = auth.uid()
        AND om.role = 'admin'
    )
  );


-- site_* — any user with access (any role) to the protocol can read+write
-- routine data (participants / visits / team). Matches the C1 "org members
-- can do day-to-day coordinator work" semantics, broadened to include
-- collaborator orgs.
CREATE POLICY "site_participants_via_protocol_access" ON public.site_participants
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_participants.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_participants.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "site_visits_via_protocol_access" ON public.site_visits
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_visits.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_visits.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );

CREATE POLICY "site_team_members_via_protocol_access" ON public.site_team_members
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_team_members.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.protocol_org_access poa
      WHERE poa.protocol_id = site_team_members.protocol_id
        AND poa.org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
    )
  );
