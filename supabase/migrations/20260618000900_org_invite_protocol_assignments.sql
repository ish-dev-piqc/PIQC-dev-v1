-- =============================================================================
-- org_invites + protocol_assignments — invite a new user with one or more
-- protocol memberships in a single flow.
--
-- Product framing: the organization provides protocols to its users. A site
-- administrator inviting a new team member should pick which protocols that
-- user is joining (and what role on each) at invite time. Without this,
-- new invitees land in an "I'm in the org but can't see any protocol data"
-- state, which doesn't match the intended UX.
--
-- Backward compatibility: the new column defaults to an empty array, so
-- existing callers of create_org_invite that don't supply assignments
-- keep working (the user just won't be added to any protocols on accept —
-- matches current behaviour).
--
-- JSONB shape:
--   [{"protocol_id": "<uuid>", "role": "coordinator|member|viewer"}, ...]
-- =============================================================================


-- ---------------------------------------------------------------------------
-- 1. Add the column.
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_invites
  ADD COLUMN IF NOT EXISTS protocol_assignments JSONB NOT NULL DEFAULT '[]'::jsonb;


-- ---------------------------------------------------------------------------
-- 2. REPLACE create_org_invite to accept assignments.
--
-- Validates each assignment:
--   - protocol_id exists and is owned by the inviting org
--   - role is in the allowed set
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
  v_is_admin   BOOLEAN;
  v_new_id     UUID;
  v_token      TEXT;
  v_expires    TIMESTAMPTZ;
  v_assignment JSONB;
  v_protocol_id UUID;
  v_role       TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Invalid org role: %', p_role;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only site administrators can create invites.';
  END IF;

  -- Validate every protocol assignment up-front so an invalid one fails the
  -- whole insert rather than leaving a partially-formed invite.
  FOR v_assignment IN SELECT * FROM jsonb_array_elements(p_protocol_assignments) LOOP
    v_protocol_id := (v_assignment->>'protocol_id')::UUID;
    v_role        := v_assignment->>'role';

    IF v_role NOT IN ('coordinator', 'member', 'viewer') THEN
      RAISE EXCEPTION 'Invalid protocol role in assignment: %', v_role;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.protocols
      WHERE id = v_protocol_id AND owner_org_id = p_org_id
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


-- ---------------------------------------------------------------------------
-- 3. REPLACE accept_org_invite to insert protocol_members for every stored
-- assignment, atomically with the org_members insert.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_org_invite(p_token TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT, protocol_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     UUID;
  v_invite      public.org_invites%ROWTYPE;
  v_org         public.orgs%ROWTYPE;
  v_assignment  JSONB;
  v_protocol_id UUID;
  v_role        TEXT;
  v_count       INTEGER := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT * INTO v_invite FROM public.org_invites WHERE token = p_token LIMIT 1;

  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite token.';
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite has already been used.';
  END IF;

  IF v_invite.expires_at < NOW() THEN
    RAISE EXCEPTION 'Invite has expired.';
  END IF;

  -- Insert or upgrade the org membership.
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_invite.org_id, v_user_id, v_invite.role)
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET role = EXCLUDED.role WHERE org_members.role <> 'admin';

  -- Insert protocol_members rows for each stored assignment. Skip silently
  -- on conflict in case the invitee was already a member of a listed protocol
  -- (defensive — shouldn't normally happen).
  FOR v_assignment IN SELECT * FROM jsonb_array_elements(v_invite.protocol_assignments) LOOP
    v_protocol_id := (v_assignment->>'protocol_id')::UUID;
    v_role        := v_assignment->>'role';

    -- Safety check: the protocol must still be owned by the inviting org.
    -- (If it moved orgs or was deleted between invite creation and accept,
    -- skip the assignment rather than fail the accept.)
    IF EXISTS (
      SELECT 1 FROM public.protocols
      WHERE id = v_protocol_id AND owner_org_id = v_invite.org_id
    ) THEN
      INSERT INTO public.protocol_members (protocol_id, user_id, role, added_by)
      VALUES (v_protocol_id, v_user_id, v_role, v_invite.invited_by)
      ON CONFLICT (protocol_id, user_id) DO NOTHING;
      v_count := v_count + 1;
    END IF;
  END LOOP;

  -- Mark the invite used.
  UPDATE public.org_invites
  SET used_at = NOW(), used_by = v_user_id
  WHERE id = v_invite.id;

  SELECT * INTO v_org FROM public.orgs WHERE id = v_invite.org_id;

  RETURN QUERY SELECT v_org.id, v_org.name, v_invite.role, v_count;
END;
$$;
