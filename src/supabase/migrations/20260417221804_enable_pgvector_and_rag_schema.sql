/*
  # RAG Knowledge Base Schema

  ## Summary
  Sets up the full retrieval-augmented generation (RAG) infrastructure:

  ## New Extensions
  - `vector` (pgvector) - enables storing and querying high-dimensional embeddings

  ## New Tables

  ### `documents`
  Stores top-level documents uploaded to the knowledge base.
  - `id` (uuid, PK)
  - `title` (text) - human-readable document title
  - `source` (text) - origin label (e.g. "product spec", "FAQ")
  - `created_at` (timestamptz)

  ### `chunks`
  Stores individual text chunks with their embeddings for vector search.
  - `id` (uuid, PK)
  - `document_id` (uuid, FK → documents) - parent document
  - `content` (text) - chunk text
  - `chunk_index` (int) - ordering within the document
  - `embedding` (vector(1536)) - OpenAI text-embedding-3-small vector
  - `fts` (tsvector) - full-text search index, auto-updated via trigger
  - `created_at` (timestamptz)

  ## Indexes
  - IVFFlat index on `chunks.embedding` for fast approximate nearest-neighbor search
  - GIN index on `chunks.fts` for fast full-text search

  ## Functions
  - `hybrid_search(query_embedding, query_text, match_count)` - blends vector similarity
    and full-text search using Reciprocal Rank Fusion (RRF), returns top N chunks

  ## Security
  - RLS enabled on both tables
  - Service role has full access (for Edge Functions)
  - Authenticated users can SELECT documents and chunks (read-only for chat)
*/

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read documents"
  ON documents FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can manage documents"
  ON documents FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update documents"
  ON documents FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete documents"
  ON documents FOR DELETE
  TO service_role
  USING (true);

-- Chunks table
CREATE TABLE IF NOT EXISTS chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid REFERENCES documents(id) ON DELETE CASCADE NOT NULL,
  content text NOT NULL DEFAULT '',
  chunk_index int NOT NULL DEFAULT 0,
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read chunks"
  ON chunks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert chunks"
  ON chunks FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can update chunks"
  ON chunks FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can delete chunks"
  ON chunks FOR DELETE
  TO service_role
  USING (true);

-- IVFFlat index for vector similarity search
CREATE INDEX IF NOT EXISTS chunks_embedding_idx
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- GIN index for full-text search
CREATE INDEX IF NOT EXISTS chunks_fts_idx
  ON chunks USING gin(fts);

-- Hybrid search function using Reciprocal Rank Fusion
CREATE OR REPLACE FUNCTION hybrid_search(
  query_embedding vector(1536),
  query_text text,
  match_count int DEFAULT 20
)
RETURNS TABLE (
  id uuid,
  document_id uuid,
  content text,
  chunk_index int,
  similarity float,
  rank_score float
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
    WHERE c.embedding IS NOT NULL
    ORDER BY c.embedding <=> query_embedding
    LIMIT match_count * 2
  ),
  fts_ranked AS (
    SELECT
      c.id,
      ROW_NUMBER() OVER (ORDER BY ts_rank_cd(c.fts, plainto_tsquery('english', query_text)) DESC) AS fts_rank
    FROM chunks c
    WHERE c.fts @@ plainto_tsquery('english', query_text)
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
