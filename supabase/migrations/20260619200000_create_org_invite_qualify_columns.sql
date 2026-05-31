-- =============================================================================
-- create_org_invite — qualify column references to fix
-- "column reference \"id\" is ambiguous" (PG error 42702).
--
-- Same shape of bug as 20260619000000 (list_org_invites). The function's
-- RETURNS TABLE clause declares OUT parameters (id, token, expires_at) that
-- PL/pgSQL exposes as variables in the body. The inner protocol check uses
-- `WHERE id = v_protocol_id`, which is ambiguous between the OUT variable
-- and `protocols.id`. PL/pgSQL only catches this at first execution, so
-- 20260618000900 applied cleanly and the bug lurked until someone clicked
-- "Create invite + copy link" with a protocol assignment.
--
-- Fix: qualify every column reference inside the function body. Also
-- qualifies the org_members admin check for safety (it wasn't ambiguous
-- but the discipline is now in place — match the rest of the file).
--
-- No schema change. Pure function-body replacement; return shape unchanged.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_org_id               UUID,
  p_email                TEXT,
  p_role                 TEXT DEFAULT 'member',
  p_protocol_assignments JSONB DEFAULT '[]'::jsonb
)
RETURNS TABLE (id UUID, token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_admin    BOOLEAN;
  v_new_id      UUID;
  v_token       TEXT;
  v_expires     TIMESTAMPTZ;
  v_assignment  JSONB;
  v_protocol_id UUID;
  v_role        TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Invalid org role: %', p_role;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_members.org_id = p_org_id
      AND org_members.user_id = auth.uid()
      AND org_members.role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only site administrators can create invites.';
  END IF;

  FOR v_assignment IN SELECT * FROM jsonb_array_elements(p_protocol_assignments) LOOP
    v_protocol_id := (v_assignment->>'protocol_id')::UUID;
    v_role        := v_assignment->>'role';

    IF v_role NOT IN ('coordinator', 'member', 'viewer') THEN
      RAISE EXCEPTION 'Invalid protocol role in assignment: %', v_role;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.protocols
      WHERE protocols.id = v_protocol_id
        AND protocols.owner_org_id = p_org_id
    ) THEN
      RAISE EXCEPTION 'Protocol % is not owned by org %', v_protocol_id, p_org_id;
    END IF;
  END LOOP;

  INSERT INTO public.org_invites (org_id, email, role, invited_by, protocol_assignments)
  VALUES (p_org_id, lower(trim(p_email)), p_role, auth.uid(), p_protocol_assignments)
  RETURNING org_invites.id, org_invites.token, org_invites.expires_at
  INTO v_new_id, v_token, v_expires;

  RETURN QUERY SELECT v_new_id, v_token, v_expires;
END;
$$;
