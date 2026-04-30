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
const REDUCTO_MAX_RETRIES = 3;

// JSON Schema for structured clinical protocol extraction via Reducto Extract.
// Extract runs after Parse via jobid:// so it sees the same enhanced parse output
// the chunks were derived from (single parse cost, consistent ground truth).
const CLINICAL_EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    protocol_title: {
      type: "string",
      description: "Full title of the clinical study protocol, typically found on the cover page",
    },
    protocol_number: {
      type: "string",
      description: "Protocol identifier or reference number (e.g. ABC-123), found on cover page or running header",
    },
    protocol_version: {
      type: "string",
      description: "Version number of this protocol document",
    },
    sponsor_name: {
      type: "string",
      description: "Name of the study sponsor or sponsoring organization",
    },
    compound_name: {
      type: "string",
      description: "Name of the investigational compound, drug, or device",
    },
    therapeutic_area: {
      type: "string",
      description: "Therapeutic area or disease indication being studied",
    },
    study_phase: {
      type: "string",
      enum: ["Phase I", "Phase II", "Phase III", "Phase IV", "Not applicable", "Unknown"],
      description: "Clinical development phase of the study",
    },
    study_design: {
      type: "string",
      description: "Study design description (e.g. randomized, double-blind, placebo-controlled, parallel-group)",
    },
    primary_endpoints: {
      type: "array",
      items: { type: "string" },
      description: "List of primary efficacy or safety endpoints as stated in the protocol",
    },
    secondary_endpoints: {
      type: "array",
      items: { type: "string" },
      description: "List of secondary endpoints",
    },
    key_inclusion_criteria: {
      type: "array",
      items: { type: "string" },
      description: "Key patient inclusion criteria",
    },
    key_exclusion_criteria: {
      type: "array",
      items: { type: "string" },
      description: "Key patient exclusion criteria",
    },
    dosing_regimen: {
      type: "string",
      description: "Dosing regimen including dose levels, route of administration, frequency, and duration",
    },
    is_amendment: {
      type: "boolean",
      description: "Whether this document is a protocol amendment rather than the original protocol",
    },
    amendment_summary: {
      type: ["string", "null"],
      description: "Brief summary of changes made in this amendment. Null if not an amendment.",
    },
  },
  required: ["protocol_title"],
};

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

// Signals that an error should not be retried (e.g. 4xx auth/client errors).
class NonRetryableError extends Error {}

async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = REDUCTO_MAX_RETRIES,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(1_000 * Math.pow(2, attempt - 1)); // 1s, 2s
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`${label} failed after ${maxRetries} retries`);
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

interface ParseResult {
  jobId: string | null;
  chunks: ChunkData[];
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
  return withRetry(async () => {
    const formData = new FormData();
    const blob = new Blob([pdfBytes], { type: "application/pdf" });
    formData.append("file", blob, "document.pdf");

    const res = await fetch(`${REDUCTO_BASE_URL}/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${reductoKey}` },
      body: formData,
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto upload error: ${err}`);
      throw new Error(`Reducto upload error: ${err}`);
    }

    const data = await res.json();
    return data.file_id as string;
  }, "uploadToReducto");
}

async function parsePdfWithReducto(fileId: string, reductoKey: string): Promise<ParseResult> {
  return withRetry(async () => {
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
          // Reducto filters page decoration at source — replaces our manual filtering
          filter_blocks: ["Header", "Footer", "Page Number"],
        },
        settings: {
          ocr_system: "standard",
          extraction_mode: "hybrid",
        },
        formatting: {
          table_output_format: "dynamic", // md for simple tables, html for complex (Reducto chooses per-table)
          add_page_markers: true,         // inline page markers improve citation precision
          merge_tables: true,             // joins multi-page tables (Schedule of Assessments, AE listings)
          include: ["change_tracking"],   // amendments: inline <change><s>old</s><u>new</u></change> markup
        },
        enhance: {
          agentic: [
            { scope: "table" },           // VLM pass for merged cells, faint borders, rotated text
            { scope: "figure" },          // enhanced figure classification + summarization
          ],
          intelligent_ordering: true,     // VLM-based reading order for multi-column layouts
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto parse error: ${err}`);
      throw new Error(`Reducto parse error: ${err}`);
    }

    const data = await res.json();

    let rawChunks: ReductoChunk[] = [];
    let resultJobId: string | null = (data.job_id as string | undefined) ?? null;

    if (data.result && Array.isArray(data.result.chunks)) {
      rawChunks = data.result.chunks;
    } else if (data.url) {
      try {
        const urlRes = await fetch(data.url);
        if (!urlRes.ok) throw new Error(`Reducto result fetch error: ${urlRes.status}`);
        const urlData = await urlRes.json();
        if (urlData.result && Array.isArray(urlData.result.chunks)) {
          rawChunks = urlData.result.chunks;
        }
        if (!resultJobId && typeof urlData.job_id === "string") {
          resultJobId = urlData.job_id;
        }
      } catch (urlErr) {
        throw new Error(
          `Failed to fetch Reducto async result: ${urlErr instanceof Error ? urlErr.message : String(urlErr)}`,
        );
      }
    }

    const SECTION_BLOCK_TYPES = new Set(["Section Header", "Title"]);
    let currentSection: string | null = null;

    const chunks = rawChunks
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

    return { jobId: resultJobId, chunks };
  }, "parsePdfWithReducto");
}

async function extractClinicalFields(
  jobId: string,
  reductoKey: string,
): Promise<Record<string, unknown> | null> {
  return withRetry(async () => {
    const res = await fetch(`${REDUCTO_BASE_URL}/extract`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reductoKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Reuse the parse result instead of re-parsing — half the Reducto cost,
        // and Extract sees the same enhanced output the chunks came from.
        input: `jobid://${jobId}`,
        instructions: {
          schema: CLINICAL_EXTRACT_SCHEMA,
          system_prompt:
            "You are extracting structured data from a clinical trial protocol document. " +
            "Extract only information explicitly stated in the document. " +
            "Use null for any field not found. Do not infer, calculate, or assume values.",
        },
        settings: {
          citations: {
            enabled: true,
            numerical_confidence: false, // categorical high/low is enough; saves response size
          },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto extract error: ${err}`);
      throw new Error(`Reducto extract error: ${err}`);
    }

    const data = await res.json();
    return (data.result ?? data) as Record<string, unknown>;
  }, "extractClinicalFields");
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
    let extractedFields: Record<string, unknown> | null = null;

    if (pdf_base64) {
      const reductoKey = Deno.env.get("REDUCTO_API_KEY");
      if (!reductoKey) throw new Error("REDUCTO_API_KEY not configured");

      const binaryStr = atob(pdf_base64);
      const pdfBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        pdfBytes[i] = binaryStr.charCodeAt(i);
      }

      const fileId = await uploadToReducto(pdfBytes, reductoKey);
      const parseResult = await parsePdfWithReducto(fileId, reductoKey);
      chunks = parseResult.chunks;

      if (chunks.length === 0) {
        throw new Error("Reducto returned no text chunks from the PDF");
      }

      if (parseResult.jobId) {
        extractedFields = await extractClinicalFields(parseResult.jobId, reductoKey).catch(
          () => null,
        );
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

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        ...(extractedFields ? { extracted_fields: extractedFields } : {}),
      })
      .eq("id", docId);
    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        success: true,
        document_id: docId,
        chunks_created: inserted,
        extracted_fields: extractedFields,
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
