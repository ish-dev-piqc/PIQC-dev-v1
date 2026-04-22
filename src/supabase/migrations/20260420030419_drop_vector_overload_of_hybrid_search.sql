/*
  # Drop duplicate vector overload of hybrid_search

  ## Problem
  Two overloads of hybrid_search exist:
    1. hybrid_search(query_embedding float8[], ...) — the correct one PostgREST can call
    2. hybrid_search(query_embedding vector, ...)  — the original, which PostgREST cannot call
       with a plain JSON number array

  When PostgREST receives an RPC call with a JSON number array it sees both overloads as
  candidates and throws an ambiguity error. The edge function catches this silently, so no
  context reaches the LLM and the chatbot falls back to a generic refusal.

  ## Fix
  Drop the old vector-typed overload. The float8[] overload casts to vector internally,
  so functionality is identical — PostgREST ambiguity is eliminated.
*/

DROP FUNCTION IF EXISTS public.hybrid_search(vector, text, integer, uuid[]);
