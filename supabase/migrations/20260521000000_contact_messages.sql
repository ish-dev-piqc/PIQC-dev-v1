-- =============================================================================
-- contact_messages — inbound submissions from the landing-page Contact form.
--
-- The Contact form on the public landing page (src/components/Contact.tsx)
-- POSTs to the supabase/functions/contact/ edge function, which uses the
-- service-role key to insert a row here and then forwards the message as an
-- email via Resend.
--
-- The table exists for two reasons:
--   1. Durable audit log of every lead — even if the Resend send fails or
--      the team misses the email, the row is still here.
--   2. Future CRM / pipeline hook — a Supabase database webhook can fan out
--      to Slack, HubSpot, etc. without changing the form or the function.
--
-- Access model:
--   - No anon or authenticated access. RLS is enabled with zero policies, so
--     PostgREST returns empty results for both roles.
--   - The edge function uses the service-role key, which bypasses RLS.
--   - To read the table day-to-day, use the Supabase dashboard (it runs as
--     service role) or build an admin UI behind an entitlement check.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  name        TEXT         NOT NULL CHECK (char_length(name)    BETWEEN 1 AND 200),
  email       TEXT         NOT NULL CHECK (char_length(email)   BETWEEN 3 AND 320),
  company     TEXT                  CHECK (company IS NULL OR char_length(company) <= 200),
  message     TEXT         NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  ip          TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS contact_messages_created_at_idx ON public.contact_messages(created_at DESC);
CREATE INDEX IF NOT EXISTS contact_messages_email_idx      ON public.contact_messages(lower(email));

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- No policies on purpose. Service role bypasses RLS; everyone else gets nothing.
