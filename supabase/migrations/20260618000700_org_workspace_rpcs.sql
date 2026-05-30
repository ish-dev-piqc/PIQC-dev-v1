-- =============================================================================
-- RPCs for the org-workspaces feature.
--
-- Two flows that can't be expressed as a single client-side mutation under
-- RLS — they need server-side atomicity or privilege elevation:
--
--   approve_protocol_access_request(request_id)
--     Coordinator approves a pending access request. Must atomically:
--       (1) flip the request row to status='approved' + resolved_at/by
--       (2) insert protocol_members row for the requester with role='member'
--     A two-call client implementation could leave half-state on failure;
--     this RPC wraps both in one transaction.
--
--   accept_protocol_guest_invite(token)
--     A guest opens their magic-link URL. They're authenticated as themselves
--     but have no protocol_members row, so the protocol_guests UPDATE policy
--     blocks them. SECURITY DEFINER bypasses RLS to set user_id + accepted_at
--     on the matching token row, after validating that the token is valid
--     and not expired.
--
-- Both RPCs return JSON payloads instead of raising on auth errors, so the
-- client can render targeted error messages instead of generic 500s.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- approve_protocol_access_request
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_protocol_access_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request RECORD;
  v_caller  UUID := auth.uid();
BEGIN
  -- Load + lock the request row.
  SELECT * INTO v_request
  FROM public.protocol_access_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_not_found');
  END IF;

  IF v_request.status != 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'request_already_resolved');
  END IF;

  -- Authz: caller must be a coordinator of the target protocol.
  IF NOT EXISTS (
    SELECT 1 FROM public.protocol_members
    WHERE protocol_id = v_request.protocol_id
      AND user_id = v_caller
      AND role = 'coordinator'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_coordinator');
  END IF;

  -- Insert membership (default role 'member'; coordinator can promote later).
  INSERT INTO public.protocol_members (protocol_id, user_id, role, added_by)
  VALUES (v_request.protocol_id, v_request.user_id, 'member', v_caller)
  ON CONFLICT (protocol_id, user_id) DO NOTHING;

  -- Resolve the request.
  UPDATE public.protocol_access_requests
  SET status      = 'approved',
      resolved_at = NOW(),
      resolved_by = v_caller
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', p_request_id,
    'protocol_id', v_request.protocol_id,
    'user_id', v_request.user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_protocol_access_request(UUID) TO authenticated;


-- ---------------------------------------------------------------------------
-- accept_protocol_guest_invite
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_protocol_guest_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest  RECORD;
  v_caller UUID := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
  END IF;

  SELECT * INTO v_guest
  FROM public.protocol_guests
  WHERE invite_token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF v_guest.expires_at IS NOT NULL AND v_guest.expires_at < NOW() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_expired');
  END IF;

  -- If already accepted by someone else (defensive — invite_token is unique
  -- and shouldn't be reused, but check anyway).
  IF v_guest.accepted_at IS NOT NULL AND v_guest.user_id IS NOT NULL
     AND v_guest.user_id != v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'token_already_used');
  END IF;

  -- Accept.
  UPDATE public.protocol_guests
  SET user_id     = v_caller,
      accepted_at = COALESCE(v_guest.accepted_at, NOW())
  WHERE id = v_guest.id;

  RETURN jsonb_build_object(
    'ok', true,
    'guest_id', v_guest.id,
    'protocol_id', v_guest.protocol_id,
    'accepted_at', COALESCE(v_guest.accepted_at, NOW())
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.accept_protocol_guest_invite(TEXT) TO authenticated;
