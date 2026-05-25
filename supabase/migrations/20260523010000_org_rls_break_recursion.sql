-- Break infinite recursion in RLS policies on org_members and
-- protocol_org_access. Previous policies queried the same table they were
-- protecting (e.g. org_members.policy did SELECT FROM org_members), which
-- PostgreSQL detects as infinite recursion and rejects with 42P17. Symptom:
-- any SELECT on protocols (which transitively goes through these tables)
-- returns 500 once the table actually has a row in scope.
--
-- Fix pattern: route the recursive lookup through SECURITY DEFINER helpers
-- that bypass RLS on the underlying table. The helper runs as the function
-- owner (postgres), which is exempt from RLS, so the subquery completes
-- without re-triggering the policy on org_members.

CREATE OR REPLACE FUNCTION public.current_user_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.current_user_org_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_admin_org_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT org_id FROM org_members WHERE user_id = auth.uid() AND role = 'admin';
$$;

GRANT EXECUTE ON FUNCTION public.current_user_admin_org_ids() TO authenticated;

CREATE OR REPLACE FUNCTION public.current_user_owner_admin_protocol_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT poa.protocol_id
  FROM protocol_org_access poa
  JOIN org_members om ON om.org_id = poa.org_id
  WHERE poa.role = 'owner'
    AND om.user_id = auth.uid()
    AND om.role = 'admin';
$$;

GRANT EXECUTE ON FUNCTION public.current_user_owner_admin_protocol_ids() TO authenticated;

DROP POLICY IF EXISTS org_members_member_select ON org_members;
CREATE POLICY org_members_member_select ON org_members
  FOR SELECT
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS org_members_admin_modify ON org_members;
CREATE POLICY org_members_admin_modify ON org_members
  FOR ALL
  USING (org_id IN (SELECT public.current_user_admin_org_ids()))
  WITH CHECK (org_id IN (SELECT public.current_user_admin_org_ids()));

DROP POLICY IF EXISTS protocol_org_access_member_select ON protocol_org_access;
CREATE POLICY protocol_org_access_member_select ON protocol_org_access
  FOR SELECT
  USING (org_id IN (SELECT public.current_user_org_ids()));

DROP POLICY IF EXISTS protocol_org_access_owner_admin_modify ON protocol_org_access;
CREATE POLICY protocol_org_access_owner_admin_modify ON protocol_org_access
  FOR ALL
  USING (protocol_id IN (SELECT public.current_user_owner_admin_protocol_ids()))
  WITH CHECK (protocol_id IN (SELECT public.current_user_owner_admin_protocol_ids()));
