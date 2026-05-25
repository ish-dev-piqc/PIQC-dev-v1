-- Add a timezone column to protocols so visit dates + times have a
-- well-defined wall-clock interpretation. Before this, `site_visits.date`
-- (DATE) + `site_visits.time_of_day` (TEXT, e.g. "10:00 AM") had no
-- associated TZ — a coordinator in PST and one in EST would both see the
-- same string. Server-side `window_closes` is TIMESTAMPTZ so it's already
-- TZ-safe; the gap is purely on the UI input/display side.
--
-- The column is nullable + has no default so existing rows keep working;
-- the UI will fall back to the browser's TZ when null. New protocols
-- created via Site Mode populate it from the user's selection in
-- AnchorDateModal.

ALTER TABLE protocols
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN protocols.timezone IS
  'IANA timezone name (e.g. America/Los_Angeles). Defines the wall-clock interpretation for site_visits.date + time_of_day. NULL = use browser TZ as fallback.';
