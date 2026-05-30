-- =============================================================================
-- list_org_invites — qualify column references to fix
-- "column reference \"role\" is ambiguous" (PG error 42702).
--
-- The function declares OUT parameters via RETURNS TABLE (..., role TEXT, ...).
-- PL/pgSQL exposes those OUT names as variables in the function body. Inside
-- the admin-check IF EXISTS, the bare `role` reference is ambiguous between
-- the output variable and `org_members.role`. PL/pgSQL only catches this at
-- execution time, which is why the function compiled fine on insert but errors
-- when called (PGRST surfaces it as a 400 to the client).
--
-- Fix: qualify the column references with the table name in the admin check.
-- The SELECT body was already qualified (`oi.role`); only the IF EXISTS
-- predicate needed fixing.
--
-- No schema change. Pure function-body replacement.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.list_org_invites(p_org_id UUID)
RETURNS TABLE (
  id          UUID,
  email       TEXT,
  role        TEXT,
  token       TEXT,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.org_id = p_org_id
      AND org_members.user_id = auth.uid()
      AND org_members.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only org admins can list invites.';
  END IF;

  RETURN QUERY
  SELECT
    oi.id, oi.email, oi.role, oi.token, oi.expires_at, oi.created_at
  FROM public.org_invites oi
  WHERE oi.org_id = p_org_id
    AND oi.used_at IS NULL
    AND oi.expires_at > NOW()
  ORDER BY oi.created_at DESC;
END;
$$;
