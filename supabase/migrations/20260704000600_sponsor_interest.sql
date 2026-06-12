-- =============================================================================
-- sponsor_interest — lead-capture table for the Sponsor Mode coming-soon
-- page. Any authenticated user can INSERT their own interest row; PIQC
-- team reads the list via service-role (no client SELECT policy).
--
-- The `user_id` column is populated server-side via a BEFORE INSERT trigger
-- so the client can't forge identity. `email` is free-form so users can
-- enter a team inbox rather than their auth email.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.sponsor_interest (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  email       TEXT         NOT NULL CHECK (length(email) BETWEEN 3 AND 320),
  message     TEXT         CHECK (message IS NULL OR length(message) <= 2000),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sponsor_interest_created_at_idx
  ON public.sponsor_interest (created_at DESC);

ALTER TABLE public.sponsor_interest ENABLE ROW LEVEL SECURITY;

-- Force user_id to auth.uid() on every INSERT so the client can't claim
-- to be someone else. Anonymous (no auth) inserts are blocked by the
-- INSERT policy below; auth.uid() returns NULL in that case.
CREATE OR REPLACE FUNCTION public.sponsor_interest_force_user_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.user_id = auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sponsor_interest_force_user_id ON public.sponsor_interest;
CREATE TRIGGER sponsor_interest_force_user_id
  BEFORE INSERT ON public.sponsor_interest
  FOR EACH ROW EXECUTE FUNCTION public.sponsor_interest_force_user_id();

DROP POLICY IF EXISTS sponsor_interest_auth_insert ON public.sponsor_interest;
CREATE POLICY sponsor_interest_auth_insert
  ON public.sponsor_interest
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- No SELECT / UPDATE / DELETE policies — PIQC team reads via service-role
-- through the Supabase Dashboard. Adding a client SELECT later is a small
-- follow-up if we want admins to view their own list in-app.
