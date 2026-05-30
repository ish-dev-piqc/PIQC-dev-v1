-- =============================================================================
-- protocol_members — explicit per-user-per-protocol membership.
--
-- Replaces the v2 "any org member can read/write site_* for any protocol owned
-- by their org" behaviour from 20260520000200_owner_scoped_rls_v2. With this
-- table in place (and RLS v3 in a later migration), protocol access is *only*
-- granted by an explicit row here, not by org membership alone.
--
-- Roles:
--   coordinator — can manage the protocol's membership + invite guests
--   member      — full read/write on protocol data, no membership controls
--   viewer      — read-only on protocol data (entitlement-gated as a cheaper seat)
--
-- Backfill: every existing protocol gets one row for its owner_id as
-- 'coordinator' so the moment RLS v3 lands, current users don't lose access
-- to protocols they created.
--
-- Recursion safety: any policy that reads protocol_members from another
-- table's RLS would hit Postgres's 42P17 infinite-recursion check. We expose
-- two SECURITY DEFINER helpers (current_user_protocol_ids /
-- current_user_protocol_coordinator_ids) for downstream policies to use,
-- matching the pattern established in 20260523010000_org_rls_break_recursion.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.protocol_members (
  protocol_id UUID         NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  user_id     UUID         NOT NULL REFERENCES auth.users(id)       ON DELETE CASCADE,
  role        TEXT         NOT NULL CHECK (role IN ('coordinator', 'member', 'viewer')),
  added_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  added_by    UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  PRIMARY KEY (protocol_id, user_id)
);

CREATE INDEX IF NOT EXISTS protocol_members_user_id_idx     ON public.protocol_members(user_id);
CREATE INDEX IF NOT EXISTS protocol_members_protocol_id_idx ON public.protocol_members(protocol_id);
CREATE INDEX IF NOT EXISTS protocol_members_role_idx        ON public.protocol_members(role);

ALTER TABLE public.protocol_members ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- Backfill: every existing protocol's owner_id becomes coordinator.
-- Idempotent via ON CONFLICT. Runs before any RLS policy is created so we
-- don't need to bypass policies.
-- ---------------------------------------------------------------------------
INSERT INTO public.protocol_members (protocol_id, user_id, role, added_by)
SELECT p.id, p.owner_id, 'coordinator', p.owner_id
FROM public.protocols p
WHERE p.owner_id IS NOT NULL
ON CONFLICT (protocol_id, user_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- SECURITY DEFINER helpers (recursion-safe lookups for downstream RLS)
-- ---------------------------------------------------------------------------

-- Protocols the calling user belongs to (any role).
CREATE OR REPLACE FUNCTION public.current_user_protocol_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT protocol_id FROM protocol_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_protocol_ids() TO authenticated;

-- Protocols where the calling user is a coordinator (membership-management writes).
CREATE OR REPLACE FUNCTION public.current_user_protocol_coordinator_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT protocol_id FROM protocol_members
  WHERE user_id = auth.uid() AND role = 'coordinator';
$$;

GRANT EXECUTE ON FUNCTION public.current_user_protocol_coordinator_ids() TO authenticated;


-- ---------------------------------------------------------------------------
-- RLS — protocol_members
--
-- SELECT: any member of a protocol can read that protocol's full roster.
-- INSERT/UPDATE/DELETE: only coordinators of that protocol can modify membership.
--   Org admins of the owning org can also modify, as a safety net so a
--   coordinator-less protocol isn't permanently locked. (e.g., the sole
--   coordinator leaves the org; org admin re-coordinates someone else.)
-- ---------------------------------------------------------------------------

CREATE POLICY "protocol_members_member_select" ON public.protocol_members
  FOR SELECT TO authenticated
  USING (protocol_id IN (SELECT public.current_user_protocol_ids()));

CREATE POLICY "protocol_members_coordinator_modify" ON public.protocol_members
  FOR ALL TO authenticated
  USING (
    protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_members.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
  )
  WITH CHECK (
    protocol_id IN (SELECT public.current_user_protocol_coordinator_ids())
    OR EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_members.protocol_id
        AND p.owner_org_id IN (SELECT public.current_user_admin_org_ids())
    )
  );
