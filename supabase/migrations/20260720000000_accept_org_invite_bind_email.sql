-- =============================================================================
-- accept_org_invite — bind redemption to the invited email (SEC-ebc361e ORG-1)
--
-- CRITICAL finding (fable-audit security pass, run SEC-ebc361e-enterprise-
-- access, 2026-07-07): the function validated token/used_at/expires_at but
-- never compared the authenticated caller's email against the invite's
-- stored `email` column. Any authenticated user who obtained a still-valid
-- token — forwarded email, shared inbox, screenshot, referrer/log leak —
-- could redeem someone else's invite under their own account and be granted
-- org membership plus every protocol_members row in protocol_assignments
-- (which can include 'coordinator').
--
-- Fix: look up the caller's email via auth.users (SECURITY DEFINER already
-- bypasses RLS, so this is safe) and RAISE EXCEPTION on mismatch, before any
-- membership rows are written. The legitimate path (correct email) is
-- behavior-unchanged. Pure function-body update, safe to CREATE OR REPLACE.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_org_invite(p_token TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT, protocol_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_user_id     UUID;
  v_user_email  TEXT;
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

  SELECT lower(trim(email)) INTO v_user_email FROM auth.users WHERE id = v_user_id;

  IF v_user_email IS NULL OR v_user_email <> lower(trim(v_invite.email)) THEN
    RAISE EXCEPTION 'This invite was sent to a different email address. Sign in as % to accept it.', v_invite.email;
  END IF;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_invite.org_id, v_user_id, v_invite.role)
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET role = EXCLUDED.role WHERE org_members.role <> 'admin';

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
