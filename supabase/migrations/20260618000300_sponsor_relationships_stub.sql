-- =============================================================================
-- sponsor_relationships — empty placeholder for future Sponsor Mode.
--
-- Sponsor Mode (deferred) gives sponsor orgs read-only oversight across
-- protocols owned by site-orgs they sponsor. Example: a pharma sponsor
-- needs to see protocol progress across 12 different CRO sites running
-- their trial — without each site having to grant cross-org access per
-- protocol.
--
-- v1 ships the table empty and an RLS-locked-down state. The companion
-- user_can_access_protocol function (next migration) references this table
-- as clause (c) of its access check, so flipping on sponsor mode in a future
-- PR is just: populate sponsor_relationships (via an enterprise admin UI),
-- and the access check fires immediately. Zero RLS changes needed at that
-- point.
--
-- Until then: nothing inserts here, nothing reads here. Empty table.
-- Including it now keeps the access function's signature stable.
-- =============================================================================


CREATE TABLE IF NOT EXISTS public.sponsor_relationships (
  sponsor_org_id UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  site_org_id    UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  granted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  granted_by     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (sponsor_org_id, site_org_id),
  CHECK (sponsor_org_id != site_org_id)
);

CREATE INDEX IF NOT EXISTS sponsor_relationships_sponsor_idx
  ON public.sponsor_relationships(sponsor_org_id);
CREATE INDEX IF NOT EXISTS sponsor_relationships_site_idx
  ON public.sponsor_relationships(site_org_id);

ALTER TABLE public.sponsor_relationships ENABLE ROW LEVEL SECURITY;

-- No policies. Table is invisible to all authenticated users in v1.
-- The user_can_access_protocol function (SECURITY DEFINER) reads it
-- regardless. Sponsor Mode UI will add explicit policies when it ships.
