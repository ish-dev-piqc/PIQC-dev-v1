-- =============================================================================
-- Site Mode — schema for visits, participants, and team members.
--
-- Three tables, all protocol-scoped:
--   site_participants  — participant roster per protocol
--   site_visits        — calendar visits per participant (references participant)
--   site_team_members  — site staff + delegation log per protocol
--
-- RLS: permissive for authenticated users (MVP — no multi-site tenancy yet).
-- Multi-tenancy via a sites/site_users junction is deferred until site
-- onboarding is designed.
-- =============================================================================


-- =============================================================================
-- Enums
-- =============================================================================

CREATE TYPE participant_status AS ENUM (
  'SCREENING', 'SCREEN_FAILURE', 'ACTIVE', 'COMPLETED', 'WITHDRAWN'
);

CREATE TYPE site_visit_status AS ENUM (
  'scheduled',    -- future or today, not yet done
  'completed',    -- past, done cleanly
  'missed',       -- past, window closed without visit
  'deviation',    -- past, done but with protocol deviation logged
  'overdue',      -- past scheduled date, window still open
  'closing_soon'  -- window closing within 24 h
);

CREATE TYPE team_role AS ENUM (
  'PI', 'SUB_I', 'COORDINATOR', 'NURSE', 'PHARMACIST', 'MONITOR'
);

CREATE TYPE team_member_status AS ENUM ('ACTIVE', 'INACTIVE');


-- =============================================================================
-- site_participants
--
-- One row per participant per protocol. participant_code is the display ID
-- ("P-0023"); UUID is the internal PK used for FK references.
-- =============================================================================

CREATE TABLE site_participants (
  id                   UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_code     TEXT            NOT NULL,                    -- "P-0023"
  protocol_id          UUID            NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  status               participant_status NOT NULL DEFAULT 'SCREENING',
  enrolled_at          DATE,
  current_study_day    INTEGER,
  next_visit_date      DATE,
  next_visit_name      TEXT,
  assigned_coordinator TEXT,                                        -- display name; user FK deferred
  open_deviations      INTEGER         NOT NULL DEFAULT 0,
  notes                TEXT,
  created_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
  UNIQUE (participant_code, protocol_id)
);

CREATE INDEX site_participants_protocol_idx ON site_participants(protocol_id);

CREATE TRIGGER touch_site_participants_updated_at
  BEFORE UPDATE ON site_participants
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- site_visits
--
-- One row per scheduled/concluded visit. protocol_id is denormalised from
-- site_participants for efficient calendar queries (filter by protocol + date).
-- =============================================================================

CREATE TABLE site_visits (
  id               UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id   UUID              NOT NULL REFERENCES site_participants(id) ON DELETE CASCADE,
  protocol_id      UUID              NOT NULL REFERENCES protocols(id),
  date             DATE              NOT NULL,
  time_of_day      TEXT,                                -- "9:00 AM"; null = day-event
  study_day        INTEGER           NOT NULL,
  visit_name       TEXT              NOT NULL,
  window_closes    TIMESTAMPTZ,
  status           site_visit_status NOT NULL DEFAULT 'scheduled',
  procedures       TEXT[]            NOT NULL DEFAULT '{}',
  prior_note       TEXT,
  deviation_reason TEXT,
  created_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ       NOT NULL DEFAULT NOW()
);

CREATE INDEX site_visits_protocol_date_idx ON site_visits(protocol_id, date);
CREATE INDEX site_visits_participant_idx   ON site_visits(participant_id);

CREATE TRIGGER touch_site_visits_updated_at
  BEFORE UPDATE ON site_visits
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- site_team_members
--
-- One row per staff member per protocol. Delegation log lives in
-- delegated_tasks[]. GCP cert expiry surfaced via certified_through.
-- =============================================================================

CREATE TABLE site_team_members (
  id                UUID               PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id       UUID               NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  name              TEXT               NOT NULL,
  role              team_role          NOT NULL,
  email             TEXT,
  delegated_tasks   TEXT[]             NOT NULL DEFAULT '{}',
  certified_through DATE,
  added_at          DATE               NOT NULL DEFAULT CURRENT_DATE,
  status            team_member_status NOT NULL DEFAULT 'ACTIVE',
  notes             TEXT,
  created_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ        NOT NULL DEFAULT NOW()
);

CREATE INDEX site_team_members_protocol_idx ON site_team_members(protocol_id);

CREATE TRIGGER touch_site_team_members_updated_at
  BEFORE UPDATE ON site_team_members
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- =============================================================================
-- RLS
--
-- All three tables: authenticated users can read and write.
-- No per-row isolation until site onboarding / multi-tenancy is designed.
-- =============================================================================

ALTER TABLE site_participants  ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_visits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_team_members  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_participants_authenticated"
  ON site_participants FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "site_visits_authenticated"
  ON site_visits FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

CREATE POLICY "site_team_members_authenticated"
  ON site_team_members FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
