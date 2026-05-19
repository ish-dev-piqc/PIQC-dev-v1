-- =============================================================================
-- orgs + org_members schema, backfilled from user_profiles.organization.
--
-- Replaces B1's free-text `owner_org` matching with a proper FK to a real
-- orgs table. v1 simplification carried forward:
--   - Org name uniqueness is case-insensitive on the canonicalised slug
--   - First user (by created_at) of each org becomes 'admin'; others 'member'
--   - Free-text `user_profiles.organization` is kept as the display string;
--     the BEFORE-INSERT/UPDATE trigger resolves it to `org_id` automatically
--
-- C1-UI (next PR) will add invite flow, admin role management, switch-org
-- picker. Until then, the trigger handles all org resolution invisibly to
-- app code — ProfileCompletion keeps writing `organization` as before.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Slugify helper — canonicalises a free-text name into a URL/index-safe slug.
-- Lowercase, alphanumeric + hyphens, no leading/trailing hyphens.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.slugify(input TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT regexp_replace(
    regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'),
    '^-+|-+$', '', 'g'
  )
$$;


-- ---------------------------------------------------------------------------
-- orgs — one row per organization. created_by names the creating user
-- but is informational only (admin role lives in org_members).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orgs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT         NOT NULL,
  slug        TEXT         NOT NULL UNIQUE,
  created_by  UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS orgs_slug_idx ON public.orgs(slug);

ALTER TABLE public.orgs ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- org_members — N:M between users and orgs with a role per membership.
-- v1 roles: 'admin' (can manage members + protocols), 'member' (read-only
-- on org settings; full access to protocols owned by the org).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_members (
  org_id     UUID         NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id    UUID         NOT NULL REFERENCES auth.users(id)   ON DELETE CASCADE,
  role       TEXT         NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (org_id, user_id)
);

CREATE INDEX IF NOT EXISTS org_members_user_id_idx ON public.org_members(user_id);
CREATE INDEX IF NOT EXISTS org_members_org_id_idx  ON public.org_members(org_id);

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- RLS — orgs + org_members
-- ---------------------------------------------------------------------------

-- orgs: members can SELECT their own org; admins of that org can UPDATE.
-- INSERT happens via the user_profile_resolve_org trigger (SECURITY DEFINER)
-- so we don't need a permissive client-side INSERT policy.
CREATE POLICY "orgs_member_select" ON public.orgs
  FOR SELECT TO authenticated
  USING (
    id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "orgs_admin_update" ON public.orgs
  FOR UPDATE TO authenticated
  USING (
    id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND role = 'admin')
  );

-- org_members: any member can SELECT the roster of their org; admins can
-- INSERT/UPDATE/DELETE. (Self-leave handled at the UI layer — out of scope.)
CREATE POLICY "org_members_member_select" ON public.org_members
  FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.org_members WHERE user_id = auth.uid())
  );

CREATE POLICY "org_members_admin_modify" ON public.org_members
  FOR ALL TO authenticated
  USING (
    org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = auth.uid() AND om.role = 'admin')
  )
  WITH CHECK (
    org_id IN (SELECT om.org_id FROM public.org_members om WHERE om.user_id = auth.uid() AND om.role = 'admin')
  );


-- ---------------------------------------------------------------------------
-- Backfill: one org per distinct user_profiles.organization value.
-- GROUP BY canonical slug to collapse case/space variants. Drop empty strings.
-- ---------------------------------------------------------------------------
INSERT INTO public.orgs (name, slug)
SELECT
  -- Pick the most-common spelling as the canonical display name. We GROUP BY
  -- slug; multiple `name` values may share one slug ("PIQ Clinical" vs
  -- "PIQ-Clinical"). MAX picks one deterministically.
  MAX(trim(organization)) AS name,
  public.slugify(trim(organization)) AS slug
FROM public.user_profiles
WHERE organization IS NOT NULL
  AND trim(organization) != ''
GROUP BY public.slugify(trim(organization))
ON CONFLICT (slug) DO NOTHING;


-- ---------------------------------------------------------------------------
-- user_profiles.org_id — link each user to their resolved org. Nullable
-- because some legacy users may have a NULL/empty organization.
-- ---------------------------------------------------------------------------
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES public.orgs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS user_profiles_org_id_idx ON public.user_profiles(org_id);

-- Backfill: match each user to the org whose slug matches their organization.
UPDATE public.user_profiles up
SET org_id = o.id
FROM public.orgs o
WHERE o.slug = public.slugify(trim(up.organization))
  AND up.organization IS NOT NULL
  AND trim(up.organization) != ''
  AND up.org_id IS NULL;


-- ---------------------------------------------------------------------------
-- Backfill org_members: every user with a resolved org_id becomes a member.
-- Oldest user (by created_at) per org becomes admin; everyone else is member.
-- ---------------------------------------------------------------------------
INSERT INTO public.org_members (org_id, user_id, role)
SELECT
  up.org_id,
  up.id,
  CASE
    WHEN up.created_at = (
      SELECT MIN(up2.created_at)
      FROM public.user_profiles up2
      WHERE up2.org_id = up.org_id
    ) THEN 'admin'
    ELSE 'member'
  END
FROM public.user_profiles up
WHERE up.org_id IS NOT NULL
ON CONFLICT (org_id, user_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Resolver trigger: when a user_profile is inserted/updated with a non-empty
-- `organization`, find or create the matching org and set `org_id`. Add the
-- user to org_members if not already a member. SECURITY DEFINER so the
-- trigger can write to orgs / org_members regardless of caller RLS.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_profile_resolve_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_name TEXT;
  v_slug       TEXT;
  v_org_id     UUID;
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

    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, NEW.id, 'admin')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  ELSE
    INSERT INTO public.org_members (org_id, user_id, role)
    VALUES (v_org_id, NEW.id, 'member')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  END IF;

  NEW.org_id := v_org_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profile_resolve_org_trg ON public.user_profiles;
CREATE TRIGGER user_profile_resolve_org_trg
  BEFORE INSERT OR UPDATE OF organization ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.user_profile_resolve_org();
