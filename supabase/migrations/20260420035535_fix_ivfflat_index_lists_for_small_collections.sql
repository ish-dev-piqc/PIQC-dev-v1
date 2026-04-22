/*
  # Fix Vector Search Index for Small Collections

  ## Problem
  The IVFFlat index on `chunks.embedding` was created with `lists = 100`.
  pgvector requires approximately `rows / 1000` lists, with a minimum of 1.
  For the current collection (~134 chunks), `lists = 100` makes the index
  unusable — the vector similarity leg of `hybrid_search` returns zero rows,
  so the chatbot cannot find any document content.

  ## Fix
  1. Drop the broken IVFFlat index.
  2. Switch to an HNSW index instead — HNSW has no "lists" parameter,
     works correctly at any collection size, and generally outperforms IVFFlat
     for recall. It uses more memory at build time but is well within limits
     for this collection size.
  3. Replace `hybrid_search` with a version that also includes a pure-vector
     fallback when full-text search returns no matches.

  ## Notes
  - HNSW index parameters: m=16, ef_construction=64 (balanced defaults).
  - No table schema changes — index and function only.
*/

-- Drop the oversized IVFFlat index
DROP INDEX IF EXISTS chunks_embedding_idx;

-- Recreate as HNSW — works at any collection size, no lists tuning required
CREATE INDEX chunks_embedding_idx
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Replace hybrid_search with a robust version that falls back to pure vector
-- search when full-text search produces no matches
CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding float8[],
  query_text text,
  match_count integer DEFAULT 20,
  filter_document_ids uuid[] DEFAULT NULL::uuid[]
)
RETURNS TABLE(
  id uuid,
  document_id uuid,
  content text,
  chunk_index integer,
  similarity double precision,
  rank_score double precision
)
LANGUAGE sql
AS $$
WITH vector_ranked AS (
  SELECT
    c.id,
    c.document_id,
    c.content,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding::vector) AS similarity,
    ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding::vector) AS vector_rank
  FROM chunks c
  WHERE
    c.embedding IS NOT NULL
    AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  ORDER BY c.embedding <=> query_embedding::vector
  LIMIT match_count * 2
),
fts_ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) DESC) AS fts_rank
  FROM chunks c
  WHERE
    c.fts @@ plainto_tsquery('english', query_text)
    AND (filter_document_ids IS NULL OR c.document_id = ANY(filter_document_ids))
  LIMIT match_count * 2
),
rrf AS (
  SELECT
    vr.id,
    vr.document_id,
    vr.content,
    vr.chunk_index,
    vr.similarity,
    COALESCE(1.0 / (60 + vr.vector_rank), 0) + COALESCE(1.0 / (60 + fr.fts_rank), 0) AS rank_score
  FROM vector_ranked vr
  LEFT JOIN fts_ranked fr ON fr.id = vr.id
)
SELECT
  id,
  document_id,
  content,
  chunk_index,
  similarity,
  rank_score
FROM rrf
ORDER BY rank_score DESC
LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.hybrid_search(float8[], text, integer, uuid[]) TO anon, authenticated, service_role;
