-- =============================================================================
-- Visit Execution Workspace — Sprint 2.5 (1 of 7): enums.
--
-- Source of truth for these names: src/types/visit-execution/index.ts. The
-- TypeScript enums and these Postgres enums must stay in sync; if you change
-- one, change the other in the same PR.
--
-- Naming convention: lowercase enum type names with _underscored_words, values
-- in lowercase_underscores. Matches the existing draft_review_action /
-- draft_review_status / evidence_support_type pattern in SOTR migrations.
-- =============================================================================


-- The phase a visit-execution item belongs to. Mirrors ExecutionPhase in TS.
-- pre_dose maps to "Pre-Procedure Requirements" for non-dosing visits via the
-- PHASE_LABELS_NON_DOSING constant in src/types/visit-execution/index.ts.
CREATE TYPE execution_phase AS ENUM (
  'pre_visit',
  'check_in',
  'assessment',
  'dosing',
  'post_dose',
  'safety_ae_conmed',
  'close_out'
);


-- Classification badge state for one execution item. Drives the per-item
-- ExecutionItemClassificationBadge in the workspace and the navigator-level
-- endpoint-critical / conditional-count indicators.
CREATE TYPE item_classification AS ENUM (
  'required',
  'conditional',
  'if_applicable',
  'primary_endpoint',
  'secondary_endpoint',
  'safety_critical'
);


-- Review state for one execution item. Semantically DISTINCT from SOTR's
-- draft_review_status — that tracks "is the parser output accurate?". This
-- tracks "has the site coordinator reviewed this visit requirement for
-- execution readiness?". Don't reuse the SOTR enum even though some values
-- look similar.
CREATE TYPE execution_review_status AS ENUM (
  'not_reviewed',
  'needs_review',
  'reviewed',
  'edited',
  'site_note_added'
);


-- Where a visit_requirement was derived from. Set at ingest time by the
-- parser; downstream UIs and re-ingest semantics gate on this.
-- 'human_added' is for items the site coordinator added that the protocol
-- doesn't mention — those are NOT subject to derived_text re-ingest overwrite.
CREATE TYPE requirement_origin AS ENUM (
  'soa_cell',
  'protocol_body',
  'footnote',
  'amendment',
  'human_added'
);
