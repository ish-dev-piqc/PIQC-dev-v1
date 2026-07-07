-- =============================================================================
-- user_profile_resolve_org — stop auto-joining EXISTING orgs by free-text
-- name match (SEC-ebc361e RLS-1)
--
-- HIGH finding (fable-audit security pass, SEC-ebc361e-enterprise-access,
-- 2026-07-07): this BEFORE INSERT/UPDATE trigger on user_profiles.organization
-- slugified the free-text value and, if an org with that slug already
-- existed, silently inserted an org_members row with role='member' — no
-- invite token, no admin approval, no email-domain check. Any signed-up
-- user could type an existing org's display name on the mandatory
-- ProfileCompletion screen and become a bona fide member: full protocol
-- roster visibility via protocols_visible_select, ability to file
-- protocol_access_requests, org_messages read access, and — if they're the
-- first person to ever type that exact name — 'admin' with full protocol
-- data access via user_can_access_protocol clause (d). This defeated the
-- org_invites-gated onboarding model entirely, since the trigger fires
-- unconditionally and is purely additive/parallel to it.
--
-- Fix (the report's "at minimum" option): only auto-grant membership when
-- the org is being created fresh by this same profile write (brand-new
-- org → creator becomes admin, unchanged). When the typed name resolves to
-- an EXISTING org, no org_members row is written — NEW.org_id is still set
-- (harmless: it's a read-only "legacy single-org path" display link per
-- src/lib/orgs/orgsApi.ts, and current_user_org_ids() / all RLS reads from
-- org_members only, never from user_profiles.org_id, so this can't be used
-- to forge access). Getting real membership in an existing org now requires
-- create_org_invite / accept_org_invite (admin-gated, and — as of
-- 20260720000000 — bound to the invited email) or an approved
-- protocol_access_request from someone who already has legitimate access.
--
-- Known product-behavior change: a new employee at a company that already
-- has a PIQC org can no longer self-serve into membership by typing the
-- company name on signup. They need an admin-sent invite. This is
-- intentional — that self-serve path was the vulnerability.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.user_profile_resolve_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name   TEXT;
  v_slug         TEXT;
  v_org_id       UUID;
  v_org_is_new   BOOLEAN := false;
BEGIN
  v_clean_name := trim(coalesce(NEW.organization, ''));

  IF v_clean_name = '' THEN
    NEW.org_id := NULL;
    RETURN NEW;
  END IF;

  v_slug := public.slugify(v_clean_name);

  SELECT id INTO v_org_id FROM public.orgs WHERE slug = v_slug;

  IF v_org_id IS NULL THEN
    INSERT INTO public.orgs (name, slug, created_by)
    VALUES (v_clean_name, v_slug, NEW.id)
    RETURNING id INTO v_org_id;

    v_org_is_new := true;
  END IF;

  -- Only auto-grant org_members when this write is what just created the
  -- org. Typing an EXISTING org's name is informational only from here on —
  -- it links the profile for display, but grants no membership/RLS access.
  -- Real membership in an existing org goes through the admin-gated invite
  -- RPCs (create_org_invite / accept_org_invite) or an approved
  -- protocol_access_request.
  IF v_org_is_new THEN
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, NEW.id, 'admin')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  NEW.org_id := v_org_id;
  RETURN NEW;
END;
$$;
