-- =============================================================================
-- org_invites — pending invitations to join an org.
--
-- An admin generates an invite for an email + role. The invite row holds a
-- random token that gates redemption. Invitee uses the token (typically via
-- a shared URL) to join. Token expiry defaults to 14 days.
--
-- v1 model: no email delivery here; the admin gets the shareable URL back
-- and sends it out-of-band. Future PR can wire Resend / Supabase Auth invite.
--
-- Three RPCs:
--   create_org_invite(p_org_id, p_email, p_role)
--     Admin-only. Returns the invite token. RLS checks admin role.
--   accept_org_invite(p_token)
--     Any signed-in user. Looks up the invite by token, validates not
--     expired/used, inserts org_members row, marks the invite used.
--   list_org_invites(p_org_id)
--     Admin-only. Returns pending (non-redeemed, non-expired) invites for
--     the org.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_invites (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  email       TEXT         NOT NULL,
  role        TEXT         NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  token       TEXT         NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  invited_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '14 days',
  used_at     TIMESTAMPTZ,
  used_by     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS org_invites_org_id_idx  ON public.org_invites(org_id);
CREATE INDEX IF NOT EXISTS org_invites_token_idx   ON public.org_invites(token);
CREATE INDEX IF NOT EXISTS org_invites_email_idx   ON public.org_invites(lower(email));

ALTER TABLE public.org_invites ENABLE ROW LEVEL SECURITY;

-- Admins of the org can read/write invites for that org. Non-admins see nothing.
CREATE POLICY "org_invites_admin_all" ON public.org_invites
  FOR ALL TO authenticated
  USING (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.org_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );


-- ---------------------------------------------------------------------------
-- create_org_invite — admin generates an invite. Returns the token row.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_org_invite(
  p_org_id UUID,
  p_email  TEXT,
  p_role   TEXT DEFAULT 'member'
)
RETURNS TABLE (id UUID, token TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_new_id   UUID;
  v_token    TEXT;
  v_expires  TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Only org admins can create invites.';
  END IF;

  INSERT INTO public.org_invites (org_id, email, role, invited_by)
  VALUES (p_org_id, lower(trim(p_email)), p_role, auth.uid())
  RETURNING org_invites.id, org_invites.token, org_invites.expires_at
  INTO v_new_id, v_token, v_expires;

  RETURN QUERY SELECT v_new_id, v_token, v_expires;
END;
$$;


-- ---------------------------------------------------------------------------
-- accept_org_invite — invitee redeems the token, becomes a member.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_org_invite(p_token TEXT)
RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
  v_invite  public.org_invites%ROWTYPE;
  v_org     public.orgs%ROWTYPE;
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

  -- Insert or upgrade the membership. If the user is already in the org as
  -- 'member' and the invite is for 'admin', upgrade them.
  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (v_invite.org_id, v_user_id, v_invite.role)
  ON CONFLICT (org_id, user_id)
  DO UPDATE SET role = EXCLUDED.role WHERE org_members.role <> 'admin';

  -- Mark the invite used.
  UPDATE public.org_invites
  SET used_at = NOW(), used_by = v_user_id
  WHERE id = v_invite.id;

  SELECT * INTO v_org FROM public.orgs WHERE id = v_invite.org_id;

  RETURN QUERY SELECT v_org.id, v_org.name, v_invite.role;
END;
$$;


-- ---------------------------------------------------------------------------
-- list_org_invites — admin sees pending invites for their org.
-- ---------------------------------------------------------------------------
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
    WHERE org_id = p_org_id AND user_id = auth.uid() AND role = 'admin'
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
