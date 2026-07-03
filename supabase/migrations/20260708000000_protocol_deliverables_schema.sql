-- =============================================================================
-- Protocol Deliverable Engine — data spine (migration 1 of 2).
--
-- Turns already-extracted protocol facts (SOTR's protocol_extracted_items +
-- protocol_source_evidence) into structured, evidence-linked, reviewable DRAFT
-- artifacts. "Parse once, generate many": the engine SELECTS from existing
-- extraction rows; it never re-parses. Three new tables:
--
--   protocol_deliverables        — one artifact per (protocol, artifact_type);
--                                  regenerate updates in place, never forks.
--   protocol_deliverable_blocks  — the artifact's content units, each stamped
--                                  with a 3-way content_origin so protocol
--                                  facts, PIQC framing, and human editorial
--                                  text are never blurred.
--   deliverable_block_edits      — append-only audit trail of every human
--                                  action on a block (mirrors
--                                  visit_requirement_human_edits).
--
-- Why these tables can't be a view over SOTR:
--   1. The 3-way content taxonomy (protocol_fact / derived_operational_framing
--      / human_editorial) is not expressible in SOTR's 2-way model
--      (extracted_value frozen vs current_text overlay). Facts carry evidence
--      + confidence; framing deliberately carries neither (no false
--      provenance); human text is never overwritten by regeneration.
--   2. SOTR RLS is owner-only (documents.user_id = auth.uid()) — a sponsor
--      can never pass it. These tables gate through
--      user_can_access_protocol(auth.uid(), protocol_id) instead, so sponsors
--      light up automatically once sponsor_relationships rows land. Evidence
--      fields (source_quote / page / section) are denormalized onto blocks at
--      generate time by a SECURITY DEFINER RPC so INVOKER read paths never
--      need to join the owner-gated SOTR tables.
--
-- Draft-only vocabulary: deliverable_review_state has no "approved" value —
-- PIQC is not a system of record; every export is DRAFT + requires review.
--
-- TS mirror: src/types/deliverables/index.ts.
-- Design + decisions: plans/fable/monitoring-prep-checklist.md.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- One value in Phase 1; future artifact kinds (siv_package, risk_overview, …)
-- extend this enum — never fork the tables.
CREATE TYPE deliverable_artifact_type AS ENUM (
  'monitoring_prep_checklist'
);

-- The 3-way content taxonomy. Never blurred:
--   protocol_fact                — selected verbatim/near-verbatim from an
--                                  extracted item; MUST carry evidence linkage
--                                  + confidence.
--   derived_operational_framing  — deterministic template prose organizing
--                                  facts (section intros, coverage-gap
--                                  notices, site questions); carries NO
--                                  confidence and no false provenance.
--   human_editorial              — user-authored; never overwritten by
--                                  regeneration.
CREATE TYPE deliverable_content_origin AS ENUM (
  'protocol_fact',
  'derived_operational_framing',
  'human_editorial'
);

-- Draft-only review vocabulary — "reviewed" is human sign-off that the draft
-- item is ready, NOT approval. "rejected" blocks are excluded from render and
-- export but preserved in the DB so regeneration does not resurrect them
-- (parser-origin blocks are rejected, not deleted; hard delete is reserved
-- for human_added blocks).
CREATE TYPE deliverable_review_state AS ENUM (
  'draft',
  'needs_review',
  'reviewed',
  'edited',
  'rejected',
  'human_added'
);

-- NOTE: blocks reuse the EXISTING confidence_state enum
-- (20260508000000_sotr_schema.sql: high / medium / low / needs_review) —
-- no duplicate enum is created here.


-- ---------------------------------------------------------------------------
-- protocol_deliverables
--
-- One artifact of each kind per protocol: UNIQUE (protocol_id, artifact_type).
-- Regeneration updates the same row (stamping regenerated_at) rather than
-- inserting a sibling — there is exactly one live draft per artifact kind.
-- protocol_version is stamped at generate time (nullable — the parser may not
-- have extracted one).
-- ---------------------------------------------------------------------------

CREATE TABLE public.protocol_deliverables (
  id               UUID                      PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id      UUID                      NOT NULL REFERENCES public.protocols(id) ON DELETE CASCADE,
  artifact_type    deliverable_artifact_type NOT NULL,
  title            TEXT                      NOT NULL,
  protocol_version TEXT,
  generated_by     UUID                      REFERENCES auth.users(id),
  generated_at     TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  regenerated_at   TIMESTAMPTZ,
  created_at       TIMESTAMPTZ               NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ               NOT NULL DEFAULT NOW(),

  -- One artifact of each kind per protocol; regenerate updates in place.
  -- The unique index this creates also serves the (protocol_id, artifact_type)
  -- lookup path — no separate index needed.
  UNIQUE (protocol_id, artifact_type)
);

CREATE TRIGGER touch_protocol_deliverables_updated_at
  BEFORE UPDATE ON public.protocol_deliverables
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- ---------------------------------------------------------------------------
-- protocol_deliverable_blocks
--
-- Content units of an artifact. derived_text is frozen at generate time;
-- current_text is the human edit overlay (display = COALESCE(current_text,
-- derived_text)). Evidence linkage (extracted_item_id / source_evidence_id)
-- plus denormalized source_quote / page / section apply to protocol_fact
-- blocks only; confidence_state is NULL for framing and human blocks —
-- framing never claims confidence. source_quote is sensitive: never log.
-- ---------------------------------------------------------------------------

CREATE TABLE public.protocol_deliverable_blocks (
  id                 UUID                       PRIMARY KEY DEFAULT gen_random_uuid(),
  deliverable_id     UUID                       NOT NULL REFERENCES public.protocol_deliverables(id) ON DELETE CASCADE,
  section_key        TEXT                       NOT NULL,
  block_type         TEXT                       NOT NULL CHECK (block_type IN ('checklist_item', 'section_intro', 'site_question')),
  content_origin     deliverable_content_origin NOT NULL,

  -- Parser/framing text, frozen at generate time. NULL for human_added blocks.
  derived_text       TEXT,
  -- Human edit overlay. Display text = COALESCE(current_text, derived_text).
  current_text       TEXT,

  -- Evidence linkage — protocol_fact blocks only. SET NULL on delete: the
  -- denormalized quote below keeps the block self-contained.
  extracted_item_id  UUID                       REFERENCES public.protocol_extracted_items(id) ON DELETE SET NULL,
  source_evidence_id UUID                       REFERENCES public.protocol_source_evidence(id) ON DELETE SET NULL,

  -- Denormalized at generate time (SECURITY DEFINER) so INVOKER read RPCs
  -- never need to join owner-gated SOTR tables. Sensitive — never log.
  source_quote       TEXT,
  source_page_number INTEGER,
  source_section     TEXT,

  -- Reuses the existing SOTR confidence_state enum. NULL for framing / human
  -- blocks — framing never claims confidence.
  confidence_state   confidence_state,

  review_state       deliverable_review_state   NOT NULL DEFAULT 'draft',
  review_note        TEXT,
  protocol_version   TEXT,
  sort_order         INTEGER                    NOT NULL DEFAULT 0,
  -- Starts at 1; bumped by edit_text.
  version            INTEGER                    NOT NULL DEFAULT 1,
  created_at         TIMESTAMPTZ                NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ                NOT NULL DEFAULT NOW()
);

CREATE TRIGGER touch_protocol_deliverable_blocks_updated_at
  BEFORE UPDATE ON public.protocol_deliverable_blocks
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();


-- ---------------------------------------------------------------------------
-- deliverable_block_edits
--
-- Append-only audit log of every human action on a deliverable block
-- (mirrors visit_requirement_human_edits). The base table holds the latest
-- state for fast reads; this table holds the full history. block_version and
-- protocol_version are snapshotted at the moment of action so the history is
-- self-contained across regenerations. reviewer_note is sensitive: never log.
-- Append-only is enforced by RLS (SELECT + INSERT policies only — no UPDATE
-- or DELETE policy exists).
-- ---------------------------------------------------------------------------

CREATE TABLE public.deliverable_block_edits (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id         UUID        NOT NULL REFERENCES public.protocol_deliverable_blocks(id) ON DELETE CASCADE,
  reviewer_id      UUID        NOT NULL REFERENCES auth.users(id),
  action           TEXT        NOT NULL CHECK (action IN (
                     'mark_reviewed',
                     'unmark_reviewed',
                     'edit_text',
                     'add_note',
                     'flag',
                     'reject_block',
                     'add_block',
                     'delete_block'
                   )),

  -- For edit_text only. NULL for non-edit actions.
  previous_text    TEXT,
  new_text         TEXT,

  -- Sensitive. Never log.
  reviewer_note    TEXT,

  -- Snapshotted at moment of action.
  block_version    INTEGER     NOT NULL,
  protocol_version TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary read path: all blocks of an artifact in render order.
CREATE INDEX protocol_deliverable_blocks_deliverable_idx
  ON public.protocol_deliverable_blocks(deliverable_id, sort_order);

-- (protocol_deliverables(protocol_id, artifact_type) is served by the UNIQUE
-- constraint's index — see table definition.)

-- All edits for a block, newest first (edit-log drawer timeline).
CREATE INDEX deliverable_block_edits_block_idx
  ON public.deliverable_block_edits(block_id, created_at DESC);

-- Blocks generated from a given extracted item (sparse — framing/human rows
-- are NULL). Used by regeneration to match existing fact blocks.
CREATE INDEX protocol_deliverable_blocks_extracted_item_idx
  ON public.protocol_deliverable_blocks(extracted_item_id)
  WHERE extracted_item_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- RLS
--
-- All three tables gate through user_can_access_protocol(auth.uid(),
-- protocol_id) — the single authorisation primitive (member / guest /
-- sponsor clauses). Blocks and edits join up through protocol_deliverables
-- to reach protocol_id. deliverable_block_edits gets SELECT + INSERT only:
-- append-only audit, no UPDATE/DELETE policies.
-- ---------------------------------------------------------------------------

ALTER TABLE public.protocol_deliverables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.protocol_deliverable_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliverable_block_edits ENABLE ROW LEVEL SECURITY;

-- protocol_deliverables ------------------------------------------------------

CREATE POLICY "protocol_deliverables_select"
  ON public.protocol_deliverables FOR SELECT TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_deliverables_insert"
  ON public.protocol_deliverables FOR INSERT TO authenticated
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_deliverables_update"
  ON public.protocol_deliverables FOR UPDATE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id))
  WITH CHECK (public.user_can_access_protocol(auth.uid(), protocol_id));

CREATE POLICY "protocol_deliverables_delete"
  ON public.protocol_deliverables FOR DELETE TO authenticated
  USING (public.user_can_access_protocol(auth.uid(), protocol_id));

-- protocol_deliverable_blocks ------------------------------------------------

CREATE POLICY "protocol_deliverable_blocks_select"
  ON public.protocol_deliverable_blocks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );

CREATE POLICY "protocol_deliverable_blocks_insert"
  ON public.protocol_deliverable_blocks FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );

CREATE POLICY "protocol_deliverable_blocks_update"
  ON public.protocol_deliverable_blocks FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );

CREATE POLICY "protocol_deliverable_blocks_delete"
  ON public.protocol_deliverable_blocks FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverables d
       WHERE d.id = protocol_deliverable_blocks.deliverable_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );

-- deliverable_block_edits (append-only: SELECT + INSERT, nothing else) -------

CREATE POLICY "deliverable_block_edits_select"
  ON public.deliverable_block_edits FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverable_blocks b
        JOIN public.protocol_deliverables d ON d.id = b.deliverable_id
       WHERE b.id = deliverable_block_edits.block_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );

CREATE POLICY "deliverable_block_edits_insert"
  ON public.deliverable_block_edits FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.protocol_deliverable_blocks b
        JOIN public.protocol_deliverables d ON d.id = b.deliverable_id
       WHERE b.id = deliverable_block_edits.block_id
         AND public.user_can_access_protocol(auth.uid(), d.protocol_id)
    )
  );


-- ---------------------------------------------------------------------------
-- Table comments
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.protocol_deliverables IS
  'Protocol Deliverable Engine artifacts — one row per (protocol, '
  'artifact_type). Draft-only: regeneration updates in place (regenerated_at) '
  'and never forks. Access gated by user_can_access_protocol so sponsors '
  'light up when sponsor_relationships rows land (unlike SOTR''s owner-only '
  'gate). TS mirror: src/types/deliverables/index.ts (DeliverableRecord).';

COMMENT ON TABLE public.protocol_deliverable_blocks IS
  'Content units of a deliverable, each stamped with a 3-way content_origin '
  '(protocol_fact / derived_operational_framing / human_editorial — never '
  'blurred). derived_text frozen at generate time; current_text is the human '
  'overlay. Evidence + confidence on protocol_fact blocks only; source_quote '
  'is denormalized so read paths never join owner-gated SOTR tables. '
  'source_quote is sensitive — never log.';

COMMENT ON TABLE public.deliverable_block_edits IS
  'Append-only audit log of human actions on deliverable blocks (mirrors '
  'visit_requirement_human_edits). Append-only is enforced by RLS: SELECT + '
  'INSERT policies only — no UPDATE/DELETE. reviewer_note is sensitive — '
  'never log.';
