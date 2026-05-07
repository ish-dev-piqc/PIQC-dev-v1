-- =============================================================================
-- documents.protocol_id — links uploaded documents to a protocol.
--
-- Powers Site Mode's Protocol tab (documents section) and Ask tab (RAG
-- scoping via selectedDocIds). FK is nullable so documents not tied to any
-- protocol still work in the global knowledge base.
--
-- Auto-tag trigger: when extracted_fields.protocol_number is present (Reducto
-- ingest path) and protocol_id is not already set, look up a matching
-- protocol via the normalized study_number index. Works for any future
-- ingest path — manual SQL, admin UI, batch import — without code changes
-- in the edge function.
-- =============================================================================

ALTER TABLE documents
  ADD COLUMN protocol_id UUID REFERENCES protocols(id) ON DELETE SET NULL;

CREATE INDEX documents_protocol_id_idx ON documents(protocol_id);

CREATE OR REPLACE FUNCTION documents_autotag_protocol()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  candidate text;
BEGIN
  IF NEW.protocol_id IS NULL
     AND NEW.extracted_fields IS NOT NULL
     AND NEW.extracted_fields ? 'protocol_number' THEN
    candidate := normalize_protocol_number(NEW.extracted_fields->>'protocol_number');
    IF candidate IS NOT NULL AND candidate <> '' THEN
      SELECT id INTO NEW.protocol_id
      FROM protocols
      WHERE study_number_normalized = candidate
      LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER documents_autotag_protocol_trg
  BEFORE INSERT OR UPDATE OF extracted_fields, protocol_id ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_autotag_protocol();

-- Backfill: tag any existing documents whose extracted_fields already carry
-- a protocol_number. The trigger fires on UPDATE OF extracted_fields, so a
-- no-op self-update is enough.
UPDATE documents
SET extracted_fields = extracted_fields
WHERE extracted_fields IS NOT NULL
  AND extracted_fields ? 'protocol_number'
  AND protocol_id IS NULL;
