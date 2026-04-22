/*
  # Add optional document filter to hybrid_search

  ## Changes
  - Replaces the existing `hybrid_search` function with a new overload that accepts an optional
    `filter_document_ids` parameter (uuid[]).
  - When `filter_document_ids` is provided and non-empty, both the vector search and full-text
    search legs are restricted to chunks belonging to those documents only.
  - When `filter_document_ids` is NULL or empty, behaviour is identical to the original function.

  ## Notes
  - No table schema changes — only the stored function is updated.
  - Fully backwards-compatible: existing callers that omit the new parameter continue to work.
*/

CREATE OR REPLACE FUNCTION public.hybrid_search(
  query_embedding vector,
  query_text text,
  match_count integer DEFAULT 20,
  filter_document_ids uuid[] DEFAULT NULL
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
    1 - (c.embedding <=> query_embedding) AS similarity,
    ROW_NUMBER() OVER (ORDER BY c.embedding <=> query_embedding) AS vector_rank
  FROM chunks c
  WHERE
    c.embedding IS NOT NULL
    AND (filter_document_ids IS NULL OR array_length(filter_document_ids, 1) = 0 OR c.document_id = ANY(filter_document_ids))
  ORDER BY c.embedding <=> query_embedding
  LIMIT match_count * 2
),
fts_ranked AS (
  SELECT
    c.id,
    ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) DESC) AS fts_rank
  FROM chunks c
  WHERE
    c.fts @@ plainto_tsquery('english', query_text)
    AND (filter_document_ids IS NULL OR array_length(filter_document_ids, 1) = 0 OR c.document_id = ANY(filter_document_ids))
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
