-- =============================================================================
-- accept_org_invite — add `#variable_conflict use_column` directive.
--
-- Fourth in the family of PL/pgSQL ambiguity bugs in the org RPCs:
--   - 20260619000000 — list_org_invites (WHERE … role = 'admin' ambiguity)
--   - 20260619100000 — accept_org_invite drop+recreate for return-shape change
--   - 20260619200000 — create_org_invite (WHERE id = … ambiguity)
--   - this migration  — accept_org_invite INSERT/ON CONFLICT ambiguity
--
-- The function declares `RETURNS TABLE (org_id UUID, org_name TEXT, role TEXT,
-- protocol_count INTEGER)`. PL/pgSQL exposes those OUT names as variables in
-- the function body. The body then does:
--
--   INSERT INTO public.org_members (org_id, user_id, role)
--   VALUES (v_invite.org_id, v_user_id, v_invite.role)
--   ON CONFLICT (org_id, user_id)
--   DO UPDATE SET role = EXCLUDED.role WHERE org_members.role <> 'admin';
--
-- `org_id` and `role` in the INSERT column list, ON CONFLICT target, and SET
-- clause are ambiguous between the OUT variables and the target table's
-- columns. Postgres errors with `42702 column reference "org_id" is ambiguous`
-- at first execution.
--
-- Unlike the previous fixes (list_org_invites, create_org_invite), explicit
-- qualification doesn't apply here — `INSERT INTO foo (foo.bar, …)` isn't
-- valid SQL, and `ON CONFLICT (foo.bar, …)` rejects the qualified form too.
-- The clean fix is the PL/pgSQL directive `#variable_conflict use_column`,
-- which tells the parser to resolve any ambiguous reference in favor of the
-- column. Behavior-equivalent for this function: the OUT params are only
-- consumed by the final `RETURN QUERY SELECT v_org.id, v_org.name,
-- v_invite.role, v_count` (explicit local-variable values, not OUT names).
--
-- Return shape unchanged from 20260619100000 — pure function-body update,
-- safe to `CREATE OR REPLACE`.
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
