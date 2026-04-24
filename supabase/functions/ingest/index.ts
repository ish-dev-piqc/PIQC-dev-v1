import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;
const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const REDUCTO_BASE_URL = "https://platform.reducto.ai";
const MAX_BODY_BYTES = 50 * 1024 * 1024; // 50 MB (PDF payloads can be large)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5; // ingest is expensive — strict limit
const EMBED_MAX_RETRIES = 3;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (rateLimitBuckets.size > 5_000) {
    for (const [key, val] of rateLimitBuckets) {
      if (val.resetAt < now) rateLimitBuckets.delete(key);
    }
  }
  const bucket = rateLimitBuckets.get(ip);
  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX) return false;
  bucket.count++;
  return true;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ReductoBlock {
  type: string;
  bbox?: { page?: number };
  content?: string;
}

interface ReductoChunk {
  content?: string;
  embed?: string;
  blocks?: ReductoBlock[];
}

interface ChunkData {
  content: string;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  block_types: string[] | null;
}

function splitIntoChunks(text: string): ChunkData[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: ChunkData[] = [];

  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim()) {
      chunks.push({
        content: chunk.trim(),
        page_start: null,
        page_end: null,
        section_heading: null,
        block_types: null,
      });
    }
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1_000 * Math.pow(2, attempt - 1)); // 1s, 2s
    try {
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ input: text, model: OPENAI_EMBEDDING_MODEL }),
      });
      if (!res.ok) {
        const err = await res.text();
        // Don't retry 400-level errors (auth/quota issues won't improve with retry)
        if (res.status < 500) throw new Error(`OpenAI embedding error ${res.status}: ${err}`);
        lastErr = new Error(`OpenAI embedding error ${res.status}: ${err}`);
        continue;
      }
      const data = await res.json();
      return data.data[0].embedding as number[];
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("OpenAI embedding error")) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("Embedding failed after retries");
}

async function uploadToReducto(pdfBytes: Uint8Array, reductoKey: string): Promise<string> {
  const formData = new FormData();
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  formData.append("file", blob, "document.pdf");

  const res = await fetch(`${REDUCTO_BASE_URL}/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${reductoKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reducto upload error: ${err}`);
  }

  const data = await res.json();
  return data.file_id as string;
}

async function parsePdfWithReducto(fileId: string, reductoKey: string): Promise<ChunkData[]> {
  const res = await fetch(`${REDUCTO_BASE_URL}/parse`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${reductoKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: fileId,
      retrieval: {
        chunking: {
          chunk_mode: "variable",
          chunk_overlap: 50,
        },
        embedding_optimized: true,
      },
      settings: {
        ocr_system: "standard",
        extraction_mode: "hybrid",
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Reducto parse error: ${err}`);
  }

  const data = await res.json();

  let rawChunks: ReductoChunk[] = [];

  if (data.result && Array.isArray(data.result.chunks)) {
    rawChunks = data.result.chunks;
  } else if (data.url) {
    const urlRes = await fetch(data.url);
    const urlData = await urlRes.json();
    if (urlData.result && Array.isArray(urlData.result.chunks)) {
      rawChunks = urlData.result.chunks;
    }
  }

  const SECTION_BLOCK_TYPES = new Set(["Section Header", "Title"]);
  let currentSection: string | null = null;

  return rawChunks
    .map((c: ReductoChunk): ChunkData | null => {
      const content = (c.embed || c.content || "").trim();
      if (!content) return null;

      const blocks: ReductoBlock[] = Array.isArray(c.blocks) ? c.blocks : [];

      // Update section heading when a section-marker block appears in this chunk
      for (const b of blocks) {
        if (SECTION_BLOCK_TYPES.has(b.type) && b.content?.trim()) {
          currentSection = b.content.trim();
        }
      }

      const pages = blocks
        .map((b) => b.bbox?.page)
        .filter((p): p is number => typeof p === "number");

      const blockTypeSet = [...new Set(blocks.map((b) => b.type))].sort();

      return {
        content,
        page_start: pages.length > 0 ? Math.min(...pages) : null,
        page_end: pages.length > 0 ? Math.max(...pages) : null,
        section_heading: currentSection,
        block_types: blockTypeSet.length > 0 ? blockTypeSet : null,
      };
    })
    .filter((c): c is ChunkData => c !== null);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "Too many requests — please wait before ingesting again" }),
      { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: "Request body too large (max 50 MB)" }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let docId: string | null = null;

  try {
    const body = await req.json();
    const { title, source, content, pdf_base64 } = body;

    let chunks: ChunkData[] = [];

    if (pdf_base64) {
      const reductoKey = Deno.env.get("REDUCTO_API_KEY");
      if (!reductoKey) throw new Error("REDUCTO_API_KEY not configured");

      const binaryStr = atob(pdf_base64);
      const pdfBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        pdfBytes[i] = binaryStr.charCodeAt(i);
      }

      const fileId = await uploadToReducto(pdfBytes, reductoKey);
      chunks = await parsePdfWithReducto(fileId, reductoKey);

      if (chunks.length === 0) {
        throw new Error("Reducto returned no text chunks from the PDF");
      }
    } else if (content && typeof content === "string") {
      chunks = splitIntoChunks(content);
    } else {
      return new Response(
        JSON.stringify({ error: "Either content (text) or pdf_base64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert document — status defaults to 'pending' via column default
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ title: title ?? "", source: source ?? "" })
      .select("id")
      .single();

    if (docError) throw docError;
    docId = doc.id;

    const batchSize = 20;
    let inserted = 0;

    for (let b = 0; b < chunks.length; b += batchSize) {
      const batch = chunks.slice(b, b + batchSize);

      const embeddings = await Promise.all(
        batch.map((chunk) => embedText(chunk.content, openaiKey))
      );

      const rows = batch.map((chunk, i) => ({
        document_id: docId,
        content: chunk.content,
        chunk_index: b + i,
        embedding: JSON.stringify(embeddings[i]),
        page_start: chunk.page_start,
        page_end: chunk.page_end,
        section_heading: chunk.section_heading,
        block_types: chunk.block_types ? JSON.stringify(chunk.block_types) : null,
      }));

      const { error: insertError } = await supabase.from("chunks").insert(rows);
      if (insertError) throw insertError;

      inserted += batch.length;
    }

    // Mark document ready
    await supabase
      .from("documents")
      .update({ status: "ready" })
      .eq("id", docId);

    return new Response(
      JSON.stringify({
        success: true,
        document_id: docId,
        chunks_created: inserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    // Mark document failed if it was created
    if (docId) {
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: message })
        .eq("id", docId);
    }

    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
