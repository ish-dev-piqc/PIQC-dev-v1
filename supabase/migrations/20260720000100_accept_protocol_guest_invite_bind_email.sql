-- =============================================================================
-- accept_protocol_guest_invite — bind redemption to invited_email
-- (SEC-ebc361e ORG-2)
--
-- CRITICAL finding (fable-audit security pass, run SEC-ebc361e-enterprise-
-- access, 2026-07-07): the function checked token validity/expiry/prior-use
-- but never compared the caller's authenticated email against
-- protocol_guests.invited_email. Any authenticated user who obtained a
-- still-valid guest-invite token could redeem it under their own account and
-- be granted protocol_guest access — more sensitive than ORG-1 because this
-- grants cross-org access to potentially PHI-adjacent protocol data to an
-- external party by design.
--
-- Fix: resolve the caller's email via auth.users (SECURITY DEFINER already
-- bypasses RLS) and return a structured `email_mismatch` error instead of
-- granting access, before user_id/accepted_at are ever written. Matches the
-- existing "return JSON, don't raise" convention for this RPC. No caller in
-- the frontend consumes this RPC yet (acceptGuestInvite in orgsApi.ts has no
-- UI wiring), so this is a pure server-side hardening change with no client
-- follow-up required.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.accept_protocol_guest_invite(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guest        RECORD;
  v_caller       UUID := auth.uid();
  v_caller_email TEXT;
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

  SELECT lower(trim(email)) INTO v_caller_email FROM auth.users WHERE id = v_caller;

  IF v_caller_email IS NULL OR v_caller_email <> lower(trim(v_guest.invited_email)) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'email_mismatch',
      'invited_email', v_guest.invited_email
    );
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
