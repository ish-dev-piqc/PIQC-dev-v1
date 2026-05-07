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
    schedule_of_events: {
      type: "array",
      description:
        "Schedule of events / visit schedule. Each entry is one planned visit with its study-day offset and procedures. Day numbers are integers relative to a Day 0 reference (typically first dose). Pre-baseline / screening visits have negative or zero study days.",
      items: {
        type: "object",
        properties: {
          visit_name: {
            type: "string",
            description: "Visit name as labelled in the protocol (e.g. 'Screening', 'Day 14', 'Week 6 follow-up')",
          },
          study_day: {
            type: "integer",
            description: "Study day relative to Day 0. Negative for pre-baseline; 0 = first dose / activation; positive after.",
          },
          window_minus_days: {
            type: "integer",
            description: "Permissible visit window — days before the scheduled date that are still in window (0 if not specified).",
          },
          window_plus_days: {
            type: "integer",
            description: "Permissible visit window — days after the scheduled date that are still in window (0 if not specified).",
          },
          procedures: {
            type: "array",
            items: { type: "string" },
            description: "List of procedures, assessments, or activities performed at this visit",
          },
        },
        required: ["visit_name", "study_day"],
      },
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

  // Resolve user_id from the caller's JWT so documents are scoped to their owner.
  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let userId: string | null = null;
  if (userToken) {
    const { data: { user } } = await createClient(supabaseUrl, serviceRoleKey).auth.getUser(userToken);
    userId = user?.id ?? null;
  }
  if (!userId) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

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
      .insert({ title: title ?? "", source: source ?? "", user_id: userId })
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

    // ---------------------------------------------------------------------
    // Phase E: schedule-of-events → protocol_visit_templates upsert.
    //
    // The documents.protocol_id auto-tag trigger has already run on the
    // UPDATE above, so we re-read the row to get the resolved protocol_id.
    // If extraction returned no schedule, we log telemetry and move on.
    // ---------------------------------------------------------------------
    let templatesInserted = 0;
    let templateMaterialized = false;
    try {
      const { data: docRow } = await supabase
        .from("documents")
        .select("protocol_id")
        .eq("id", docId)
        .maybeSingle();

      const resolvedProtocolId = docRow?.protocol_id ?? null;
      const schedule = Array.isArray(extractedFields?.schedule_of_events)
        ? extractedFields!.schedule_of_events
        : [];

      console.log("[ingest] schedule_extracted", {
        document_id: docId,
        protocol_id: resolvedProtocolId,
        entry_count: schedule.length,
      });

      if (resolvedProtocolId && schedule.length > 0) {
        const rows = schedule
          .filter((s: any) => s && typeof s.visit_name === "string" && typeof s.study_day === "number")
          .map((s: any) => ({
            protocol_id: resolvedProtocolId,
            visit_name: String(s.visit_name).trim(),
            study_day: Math.trunc(s.study_day),
            window_minus_days: typeof s.window_minus_days === "number" ? Math.max(0, Math.trunc(s.window_minus_days)) : 0,
            window_plus_days: typeof s.window_plus_days === "number" ? Math.max(0, Math.trunc(s.window_plus_days)) : 0,
            procedures: Array.isArray(s.procedures)
              ? s.procedures.filter((p: unknown) => typeof p === "string")
              : [],
            source_document_id: docId,
          }));

        if (rows.length > 0) {
          const { error: tplError } = await supabase
            .from("protocol_visit_templates")
            .upsert(rows, { onConflict: "protocol_id,visit_name,study_day" });
          if (tplError) {
            console.error("[ingest] template_upsert_failed", { error: tplError.message });
          } else {
            templatesInserted = rows.length;

            // If the protocol already has an anchor date, materialize visits
            // immediately so the user sees them on the calendar without
            // needing a second click.
            const { data: protoRow } = await supabase
              .from("protocols")
              .select("demo_anchor_date")
              .eq("id", resolvedProtocolId)
              .maybeSingle();
            if (protoRow?.demo_anchor_date) {
              const { error: matError } = await supabase.rpc("materialize_protocol_visits", {
                p_protocol_id: resolvedProtocolId,
              });
              if (matError) {
                console.error("[ingest] materialize_failed", { error: matError.message });
              } else {
                templateMaterialized = true;
              }
            }
          }
        }
      }
    } catch (e) {
      // Schedule processing is best-effort — don't fail the whole ingest
      // if it goes sideways.
      console.error("[ingest] schedule_processing_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: docId,
        chunks_created: inserted,
        extracted_fields: extractedFields,
        templates_inserted: templatesInserted,
        templates_materialized: templateMaterialized,
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
