-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-5: draft review schema.
--
-- Adds lightweight review actions for users preparing draft worksheets.
-- This is a draft-preparation aid — NOT a final approval system, NOT an
-- electronic signature, NOT a Part 11 / GxP audit trail. Naming throughout
-- uses "draft" / "review" language for that reason.
--
-- New types:
--   draft_review_action — accept_for_draft, edit_draft_item, reject_from_draft,
--                         flag_item, flag_source
--   draft_review_status — draft, accepted_for_draft, edited,
--                         rejected_from_draft, flagged
--
-- Schema additions on protocol_extracted_items:
--   version       INTEGER, starts at 1, incremented on edit_draft_item only
--   review_status draft_review_status, defaults 'draft'
--   current_text  TEXT NULL — when set, takes precedence over extracted_value
--                 for display. Lets us preserve the raw parser output as
--                 ground truth and layer edits on top.
--
-- New table:
--   worksheet_review_events — append-only event log. One row per user
--   action; captures item version, protocol context, and a snapshot of
--   the source evidence the user was looking at when they clicked.
--
-- RLS: events are visible to the document owner (matches the PR-1 pattern
-- on protocol_extracted_items / protocol_source_evidence).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE draft_review_action AS ENUM (
  'accept_for_draft',
  'edit_draft_item',
  'reject_from_draft',
  'flag_item',
  'flag_source'
);

CREATE TYPE draft_review_status AS ENUM (
  'draft',
  'accepted_for_draft',
  'edited',
  'rejected_from_draft',
  'flagged'
);


-- ---------------------------------------------------------------------------
-- protocol_extracted_items — version, review_status, current_text
-- ---------------------------------------------------------------------------

ALTER TABLE protocol_extracted_items
  ADD COLUMN version       INTEGER             NOT NULL DEFAULT 1,
  ADD COLUMN review_status draft_review_status NOT NULL DEFAULT 'draft',
  ADD COLUMN current_text  TEXT;

COMMENT ON COLUMN protocol_extracted_items.version IS
  'Incremented only on edit_draft_item. Captured into worksheet_review_events '
  'at the time of every review action.';

COMMENT ON COLUMN protocol_extracted_items.review_status IS
  'Draft-preparation review state. Not a regulated approval state.';

COMMENT ON COLUMN protocol_extracted_items.current_text IS
  'Edited text when the user has run edit_draft_item. NULL means show the '
  'parser output (extracted_value).';


-- Index for filtering items by review state on a study
CREATE INDEX sotr_extracted_items_review_status_idx
  ON protocol_extracted_items(document_id, review_status);


-- ---------------------------------------------------------------------------
-- worksheet_review_events
--
-- Append-only event log of draft review actions. Snapshots are stored as
-- JSONB so they survive later edits to the underlying source evidence rows.
-- ---------------------------------------------------------------------------

CREATE TABLE worksheet_review_events (
  id                       UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_item_id        UUID                NOT NULL REFERENCES protocol_extracted_items(id) ON DELETE CASCADE,
  reviewer_id              UUID                NOT NULL REFERENCES auth.users(id),
  action                   draft_review_action NOT NULL,

  -- Edit-specific fields. NULL for non-edit actions.
  previous_item_text       TEXT,
  new_item_text            TEXT,

  -- Optional, sensitive — never logged.
  reviewer_note            TEXT,

  -- Captured at moment of action.
  worksheet_item_version   INTEGER             NOT NULL,
  protocol_document_id     UUID                NOT NULL,
  protocol_version         TEXT,

  -- Frozen snapshot of source_evidence rows the user was reviewing.
  -- [{id, document_id, protocol_version, page_number, section_number,
  --   section_title, support_type, quoted_text, confidence_score}]
  source_evidence_snapshot JSONB               NOT NULL DEFAULT '[]'::jsonb,

  created_at               TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX worksheet_review_events_item_idx
  ON worksheet_review_events(worksheet_item_id, created_at DESC);

CREATE INDEX worksheet_review_events_reviewer_idx
  ON worksheet_review_events(reviewer_id, created_at DESC);

CREATE INDEX worksheet_review_events_action_idx
  ON worksheet_review_events(worksheet_item_id, action);


ALTER TABLE worksheet_review_events ENABLE ROW LEVEL SECURITY;

-- Events are visible to whoever owns the worksheet item's document.
-- Matches the PR-1 ownership pattern on protocol_extracted_items.
CREATE POLICY "worksheet_review_events_owner"
  ON worksheet_review_events FOR ALL TO authenticated
  USING (
    worksheet_item_id IN (
      SELECT ei.id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
       WHERE d.user_id = auth.uid()
    )
  );
