-- =============================================================================
-- accept_org_invite — drop + recreate to handle upgrade paths.
--
-- 20260618000900_org_invite_protocol_assignments.sql used
-- `CREATE OR REPLACE FUNCTION accept_org_invite(...) RETURNS TABLE (..., protocol_count INTEGER)`.
-- That works on a fresh DB but fails on upgrade paths where the function
-- already exists (from 20260520010000) with the older 3-column return shape:
--
--   ERROR 42P13: cannot change return type of existing function
--   DETAIL:  Row type defined by OUT parameters is different.
--
-- Postgres rejects CREATE OR REPLACE when the OUT-parameter set differs.
-- This migration drops the function first, then recreates with the new
-- 4-column shape. Function body is identical to what 20260618000900 wanted
-- to install. Safe to run on any DB state:
--   - Fresh DB: DROP IF EXISTS is a no-op, then create succeeds.
--   - DB with old (3-col) function: DROP removes it, then create succeeds.
--   - DB where 20260618000900 already applied successfully somehow: DROP
--     removes the new function, then create re-installs identical body.
-- =============================================================================

DROP FUNCTION IF EXISTS public.accept_org_invite(TEXT);

CREATE FUNCTION public.accept_org_invite(p_token TEXT)
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

  -- Insert protocol_members rows for each stored assignment.
  FOR v_assignment IN SELECT * FROM jsonb_array_elements(v_invite.protocol_assignments) LOOP
    v_protocol_id := (v_assignment->>'protocol_id')::UUID;
    v_role        := v_assignment->>'role';

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

  UPDATE public.org_invites
  SET used_at = NOW(), used_by = v_user_id
  WHERE id = v_invite.id;

  SELECT * INTO v_org FROM public.orgs WHERE id = v_invite.org_id;

  RETURN QUERY SELECT v_org.id, v_org.name, v_invite.role, v_count;
END;
$$;
