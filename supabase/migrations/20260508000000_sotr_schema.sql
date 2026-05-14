-- =============================================================================
-- Source of Truth Reviewer (SOTR) — PR-1: backend data foundation.
--
-- Adds the tables that give every Reducto-extracted protocol item a traceable
-- link back to its source text in the uploaded PDF. The three new tables are:
--
--   protocol_source_evidence      — one row per Reducto citation (page,
--                                   section, quoted text, bounding box,
--                                   confidence). Treated as sensitive.
--   protocol_extracted_items      — one normalized row per named field
--                                   extracted from the protocol (endpoint,
--                                   criterion, visit entry, etc.). These are
--                                   the "worksheet items" users review against
--                                   the source document.
--   protocol_item_evidence_links  — many-to-many join: items ↔ evidence,
--                                   with relevance score + primary-source flag.
--
-- Also adds extracted_item_id (nullable FK) to protocol_visit_templates so
-- materialized visit rows can point back to the extracted item that generated
-- them — making source verification reachable from the calendar.
--
-- RLS: all three tables scope access through documents.user_id = auth.uid(),
-- matching the pattern established for chunks.
-- =============================================================================


-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE evidence_support_type AS ENUM (
  'primary',
  'secondary',
  'context',
  'conflict'
);

CREATE TYPE confidence_state AS ENUM (
  'high',
  'medium',
  'low',
  'needs_review'
);

-- Reasons stored on protocol_extracted_items when source evidence is absent
-- or incomplete. Drives UI copy and review queue prioritization.
CREATE TYPE missing_source_reason AS ENUM (
  'parser_output_missing_citation',
  'source_text_not_found',
  'protocol_version_mismatch',
  'coordinates_unavailable',
  'evidence_conflict',
  'unknown'
);


-- ---------------------------------------------------------------------------
-- protocol_source_evidence
--
-- One row per Reducto citation returned by the Extract call. All location
-- fields are nullable — the adapter stores whatever Reducto provides and
-- marks the linked worksheet item needs_review when critical fields are
-- absent. quoted_text is sensitive: never log, never expose raw.
-- ---------------------------------------------------------------------------

CREATE TABLE protocol_source_evidence (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  protocol_version  TEXT,
  page_number       INTEGER,
  section_number    TEXT,
  section_title     TEXT,
  quoted_text       TEXT,  -- sensitive — never log
  text_start_offset INTEGER,
  text_end_offset   INTEGER,
  bounding_boxes    JSONB,       -- [{page,x1,y1,x2,y2}] from Reducto, if available
  confidence_score  NUMERIC(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  support_type      evidence_support_type NOT NULL DEFAULT 'primary',
  extraction_run_id TEXT,        -- Reducto job_id — links evidence to its parse run
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE protocol_source_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sotr_source_evidence_owner"
  ON protocol_source_evidence FOR ALL TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );


-- ---------------------------------------------------------------------------
-- protocol_extracted_items
--
-- One normalized row per named field extracted from a protocol document.
-- field_path uses dot-bracket notation matching the CLINICAL_EXTRACT_SCHEMA
-- keys, e.g. "primary_endpoints[0]", "schedule_of_events[2].visit_name".
-- These are the worksheet items users verify against the source.
-- ---------------------------------------------------------------------------

CREATE TABLE protocol_extracted_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           UUID        NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  field_path            TEXT        NOT NULL,
  field_type            TEXT        NOT NULL,   -- endpoint / criterion / visit / dosing / metadata
  extracted_value       JSONB       NOT NULL,
  confidence_state      confidence_state     NOT NULL DEFAULT 'needs_review',
  confidence_score      NUMERIC(4,3) CHECK (confidence_score BETWEEN 0 AND 1),
  confidence_reason     TEXT,
  ambiguity_reason      TEXT,
  missing_source_reason missing_source_reason,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (document_id, field_path)
);

CREATE TRIGGER touch_protocol_extracted_items_updated_at
  BEFORE UPDATE ON protocol_extracted_items
  FOR EACH ROW EXECUTE FUNCTION audit_mode_touch_updated_at();

ALTER TABLE protocol_extracted_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sotr_extracted_items_owner"
  ON protocol_extracted_items FOR ALL TO authenticated
  USING (
    document_id IN (SELECT id FROM documents WHERE user_id = auth.uid())
  );


-- ---------------------------------------------------------------------------
-- protocol_item_evidence_links
--
-- Many-to-many join between protocol_extracted_items and
-- protocol_source_evidence. Supports multiple evidence records per item
-- (e.g., a primary citation plus corroborating context paragraphs).
-- ---------------------------------------------------------------------------

CREATE TABLE protocol_item_evidence_links (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  extracted_item_id  UUID        NOT NULL REFERENCES protocol_extracted_items(id) ON DELETE CASCADE,
  source_evidence_id UUID        NOT NULL REFERENCES protocol_source_evidence(id) ON DELETE CASCADE,
  is_primary_source  BOOLEAN     NOT NULL DEFAULT FALSE,
  relevance_score    NUMERIC(4,3) CHECK (relevance_score BETWEEN 0 AND 1),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (extracted_item_id, source_evidence_id)
);

ALTER TABLE protocol_item_evidence_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sotr_item_evidence_links_owner"
  ON protocol_item_evidence_links FOR ALL TO authenticated
  USING (
    extracted_item_id IN (
      SELECT ei.id
        FROM protocol_extracted_items ei
        JOIN documents d ON d.id = ei.document_id
       WHERE d.user_id = auth.uid()
    )
  );


-- ---------------------------------------------------------------------------
-- protocol_visit_templates — link to originating extracted item (nullable).
--
-- Allows a materialized visit row to point at the extracted item that
-- generated it, making source review reachable from the calendar view.
-- Existing rows are unaffected (column defaults to NULL).
-- ---------------------------------------------------------------------------

ALTER TABLE protocol_visit_templates
  ADD COLUMN extracted_item_id UUID REFERENCES protocol_extracted_items(id) ON DELETE SET NULL;


-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- Primary join path: all evidence for a given worksheet item
CREATE INDEX sotr_item_evidence_links_item_idx
  ON protocol_item_evidence_links(extracted_item_id);

-- All worksheet items for a document (study lookup)
CREATE INDEX sotr_extracted_items_document_idx
  ON protocol_extracted_items(document_id);

-- Filter worksheet items by type within a document
CREATE INDEX sotr_extracted_items_type_idx
  ON protocol_extracted_items(document_id, field_type);

-- All evidence records for a protocol document
CREATE INDEX sotr_source_evidence_document_idx
  ON protocol_source_evidence(document_id);

-- All evidence produced by a specific parser/generation run
CREATE INDEX sotr_source_evidence_run_idx
  ON protocol_source_evidence(extraction_run_id)
  WHERE extraction_run_id IS NOT NULL;

-- Visit templates linked to an extracted item (sparse — most rows are NULL)
CREATE INDEX sotr_visit_templates_extracted_item_idx
  ON protocol_visit_templates(extracted_item_id)
  WHERE extracted_item_id IS NOT NULL;
