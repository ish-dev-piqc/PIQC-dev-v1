-- =============================================================================
-- Protocol number normalization — solid forever strategy.
--
-- Reducto-extracted protocol_number can drift across runs ("BRIGHTEN-2",
-- "brighten 2", "Brighten_2") and human-entered study_number can have its
-- own quirks. This migration normalizes both sides so document↔protocol
-- auto-tagging is robust against case, whitespace, and separator drift.
-- =============================================================================

-- Strip everything that isn't an alphanumeric, lowercase the rest.
-- IMMUTABLE so it can be used in generated columns and indexes.
CREATE OR REPLACE FUNCTION normalize_protocol_number(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(regexp_replace(coalesce(t, ''), '[^a-z0-9]', '', 'gi'))
$$;

-- Add a generated column on protocols that stores the normalized form.
-- O(log n) indexable lookups for auto-tag trigger and any future caller.
ALTER TABLE protocols
  ADD COLUMN study_number_normalized text
  GENERATED ALWAYS AS (normalize_protocol_number(study_number)) STORED;

-- Unique index — guards against two protocols collapsing to the same key.
-- Partial: only enforce when study_number is set (existing rows with NULL
-- study_number get NULL here and are not considered duplicates).
CREATE UNIQUE INDEX protocols_study_number_normalized_idx
  ON protocols(study_number_normalized)
  WHERE study_number_normalized IS NOT NULL AND study_number_normalized <> '';
