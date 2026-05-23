import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { mapReductoExtractToSotr } from "../_shared/sourceEvidenceAdapter.ts";
import type { ReductoExtractResponse } from "../_shared/sotrTypes.ts";

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
            description:
              "Permissible visit window — days BEFORE the scheduled date that are still in window. " +
              "Before returning 0, actively search the protocol for ± notation tied to this visit: " +
              "look in inline visit-description sections (e.g. '6.3.x Visit N (Week X, Day Y±Z)') and " +
              "any narrative text alongside the visit, not just the Schedule-of-Assessments table. " +
              "If you see 'Day 14±3' or 'Day 140 (±7 days)' for this visit, return 3 or 7 respectively. " +
              "Only return 0 if the protocol explicitly states no window or the visit is genuinely fixed.",
          },
          window_plus_days: {
            type: "integer",
            description:
              "Permissible visit window — days AFTER the scheduled date that are still in window. " +
              "Before returning 0, actively search the protocol for ± notation tied to this visit: " +
              "look in inline visit-description sections (e.g. '6.3.x Visit N (Week X, Day Y±Z)') and " +
              "any narrative text alongside the visit, not just the Schedule-of-Assessments table. " +
              "If you see 'Day 14±3' or 'Day 140 (±7 days)' for this visit, return 3 or 7 respectively. " +
              "Only return 0 if the protocol explicitly states no window or the visit is genuinely fixed.",
          },
          procedures: {
            type: "array",
            items: { type: "string" },
            description: "List of procedures, assessments, or activities performed at this visit",
          },
          schedule_variant: {
            type: "string",
            description:
              "Name of the schedule variant as it appears in the document (e.g. 'All Subjects', 'PK Substudy Participants', 'Biomarker Substudy'). Use the table section header or column header identifying which subject population this visit applies to. Empty string if the document presents a single schedule for all subjects. Used by the SOTR dedup step to disambiguate visits when the same visit_name appears under multiple sub-populations.",
          },
          cross_references: {
            type: "array",
            description:
              "Every OTHER place in this document that references this visit by ANY name (the visit_name string, the study day as 'Day N' or 'D N', the visit number as 'Visit N' or 'V N', or any other alias the protocol uses). Each entry is a verbatim passage that adds context not already captured in `procedures` — examples include: dosing rules, safety monitoring requirements, lab handling instructions, eligibility constraints, procedural dependencies, or exceptions. Skip the original Schedule of Assessments table itself; only include passages from elsewhere in the document. If the visit is not referenced anywhere outside the schedule, return an empty array.",
            items: {
              type: "object",
              properties: {
                source_section: {
                  type: "string",
                  description:
                    "Heading of the section the passage was found in, e.g. '7.4 Safety monitoring' or 'Appendix B: Lab handling'. Include the section number if the protocol uses one.",
                },
                snippet: {
                  type: "string",
                  description:
                    "Verbatim passage from the document that mentions this visit and adds context. One to three sentences, trimmed to what actually adds information about the visit.",
                },
                page: {
                  type: ["integer", "null"],
                  description: "Page number where the passage appears, if known.",
                },
              },
              required: ["source_section", "snippet"],
            },
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

    // Reducto returns one of:
    //   (a) synchronous: data.result.chunks            (small docs)
    //   (b) async, top-level URL:    data.url          (legacy)
    //   (c) async, nested URL:       data.result.url   (current shape for large docs)
    // The fetched async payload itself returns chunks at the top level (current)
    // or under .result.chunks (legacy). Accept both at each layer.
    const asyncUrl = data.result?.url ?? data.url;
    if (data.result && Array.isArray(data.result.chunks)) {
      rawChunks = data.result.chunks;
    } else if (asyncUrl) {
      try {
        const urlRes = await fetch(asyncUrl);
        if (!urlRes.ok) throw new Error(`Reducto result fetch error: ${urlRes.status}`);
        const urlData = await urlRes.json();
        if (Array.isArray(urlData.chunks)) {
          rawChunks = urlData.chunks;
        } else if (urlData.result && Array.isArray(urlData.result.chunks)) {
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

// -----------------------------------------------------------------------------
// Phase B3 — cross-reference extraction for a *known* visit list.
//
// Called against any previously-parsed document (via its stored Reducto
// job_id) when a sibling document supplies a Schedule of Assessments. The
// LLM is asked to scan THIS document for every place that mentions any of
// the known visits and return a flat array of cross-references keyed by
// visit_name + study_day.
//
// Returns an array of CrossRefHit; the caller groups them by
// (visit_name, study_day) and merges into protocol_visit_templates.
// -----------------------------------------------------------------------------

interface CrossRefHit {
  visit_name: string;
  study_day: number;
  source_section: string;
  snippet: string;
  page: number | null;
}

function buildCrossRefSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      cross_references: {
        type: "array",
        description:
          "Every passage in this document that references one of the known visits by ANY alias " +
          "(visit_name, 'Day N', 'D N', 'Visit N', 'V N', or any other naming convention the " +
          "document uses). For each, return a verbatim passage that adds context not already in " +
          "the schedule (dosing rules, safety monitoring requirements, lab handling, eligibility " +
          "constraints, procedural dependencies, exceptions). Skip Schedule-of-Assessments tables. " +
          "If the document doesn't reference any of the visits, return an empty array.",
        items: {
          type: "object",
          properties: {
            visit_name: {
              type: "string",
              description:
                "Must exactly match one of the visit_name values from the system prompt's visit list.",
            },
            study_day: {
              type: "integer",
              description:
                "Must exactly match the study_day paired with that visit_name in the visit list.",
            },
            source_section: {
              type: "string",
              description: "Heading of the section the passage was found in (with section number if present).",
            },
            snippet: {
              type: "string",
              description: "Verbatim passage, 1–3 sentences, trimmed to what actually adds context.",
            },
            page: {
              type: ["integer", "null"],
              description: "Page number where the passage appears, if known.",
            },
          },
          required: ["visit_name", "study_day", "source_section", "snippet"],
        },
      },
    },
    required: ["cross_references"],
  };
}

async function extractCrossReferencesForVisits(
  jobId: string,
  visits: Array<{ visit_name: string; study_day: number }>,
  reductoKey: string,
): Promise<CrossRefHit[]> {
  if (visits.length === 0) return [];

  const visitList = visits
    .map((v) => `- visit_name: "${v.visit_name}", study_day: ${v.study_day}`)
    .join("\n");

  return withRetry(async () => {
    const res = await fetch(`${REDUCTO_BASE_URL}/extract`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reductoKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: `jobid://${jobId}`,
        instructions: {
          schema: buildCrossRefSchema(),
          system_prompt:
            "You are scanning a clinical trial document for cross-references to a known list of " +
            "study visits. For each visit, look anywhere in the document outside the Schedule-of-" +
            "Assessments table for passages that mention it (by any alias) and add context.\n\n" +
            "Known visits:\n" +
            visitList +
            "\n\nReturn only passages explicitly in the document. Do not infer or fabricate. " +
            "When you return a cross_reference, the visit_name + study_day MUST match one of the " +
            "pairs above exactly.",
        },
        settings: {
          citations: { enabled: true, numerical_confidence: false },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto extract error: ${err}`);
      throw new Error(`Reducto extract error: ${err}`);
    }

    const data = await res.json();
    const result = (data.result ?? data) as { cross_references?: unknown };
    if (!Array.isArray(result.cross_references)) return [];

    return (result.cross_references as unknown[])
      .filter(
        (r): r is Record<string, unknown> =>
          !!r &&
          typeof r === "object" &&
          typeof (r as Record<string, unknown>).visit_name === "string" &&
          typeof (r as Record<string, unknown>).study_day === "number" &&
          typeof (r as Record<string, unknown>).source_section === "string" &&
          typeof (r as Record<string, unknown>).snippet === "string" &&
          String((r as Record<string, unknown>).source_section).trim().length > 0 &&
          String((r as Record<string, unknown>).snippet).trim().length > 0,
      )
      .map((r) => ({
        visit_name: String(r.visit_name).trim(),
        study_day: Math.trunc(r.study_day as number),
        source_section: String(r.source_section).trim(),
        snippet: String(r.snippet).trim(),
        page: typeof r.page === "number" ? Math.trunc(r.page) : null,
      }));
  }, "extractCrossReferencesForVisits");
}

// -----------------------------------------------------------------------------
// Phase B3 — merge cross-references into protocol_visit_templates,
// partitioned by source document.
//
// On re-ingest of the same source document, we want its old contributions
// removed and the new ones inserted (idempotent). Entries from OTHER
// documents are preserved. The partition key is `document_id` stamped on
// every cross-reference at write time.
//
// supabase: a service-role client (RLS bypass) since we may merge across
// documents the caller doesn't directly own.
// -----------------------------------------------------------------------------

interface MergeTarget {
  protocol_id: string;
  source_document_id: string;
  hits: CrossRefHit[];
}

// Group hits by (visit_name, study_day). Returns a Map keyed by `${name}|${day}`.
function groupHitsByVisit(hits: CrossRefHit[]): Map<string, CrossRefHit[]> {
  const out = new Map<string, CrossRefHit[]>();
  for (const h of hits) {
    const key = `${h.visit_name}|${h.study_day}`;
    const arr = out.get(key) ?? [];
    arr.push(h);
    out.set(key, arr);
  }
  return out;
}

async function mergeCrossReferencesIntoTemplates(
  supabase: ReturnType<typeof createClient>,
  target: MergeTarget,
): Promise<{ templatesTouched: number; entriesInserted: number }> {
  if (target.hits.length === 0) return { templatesTouched: 0, entriesInserted: 0 };

  const { data: templates, error } = await supabase
    .from("protocol_visit_templates")
    .select("id, visit_name, study_day, cross_references")
    .eq("protocol_id", target.protocol_id);

  if (error) {
    console.error("[ingest] cross_ref_merge_load_failed", { error: error.message });
    return { templatesTouched: 0, entriesInserted: 0 };
  }

  type TemplateRow = {
    id: string;
    visit_name: string;
    study_day: number;
    cross_references: unknown;
  };

  const byKey = new Map<string, TemplateRow>();
  for (const t of (templates ?? []) as TemplateRow[]) {
    byKey.set(`${t.visit_name}|${t.study_day}`, t);
  }

  const grouped = groupHitsByVisit(target.hits);
  let templatesTouched = 0;
  let entriesInserted = 0;

  for (const [key, newHits] of grouped) {
    const template = byKey.get(key);
    if (!template) continue;

    const existing = Array.isArray(template.cross_references)
      ? (template.cross_references as Array<Record<string, unknown>>)
      : [];

    // Drop prior contributions from this source document, keep the rest,
    // then append the new ones with the source document_id stamped on each.
    const preserved = existing.filter(
      (r) => r && r.document_id !== target.source_document_id,
    );
    const appended = newHits.map((h) => ({
      source_section: h.source_section,
      snippet: h.snippet,
      page: h.page,
      document_id: target.source_document_id,
    }));
    const next = [...preserved, ...appended];

    const { error: upErr } = await supabase
      .from("protocol_visit_templates")
      .update({ cross_references: next })
      .eq("id", template.id);

    if (upErr) {
      console.error("[ingest] cross_ref_merge_update_failed", {
        template_id: template.id,
        error: upErr.message,
      });
      continue;
    }

    templatesTouched += 1;
    entriesInserted += appended.length;
  }

  return { templatesTouched, entriesInserted };
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
            "Use null for any field not found. Do not infer, calculate, or assume values.\n\n" +
            "When extracting schedule_of_events, prefer the inline visit-description sections " +
            "(commonly numbered like '6.3.x Visit N (Week X, Day Y±Z)' or similar narrative " +
            "subsections under 'Study Procedures' / 'Visit Schedule') over the Schedule-of-" +
            "Assessments (SoA) table. SoA tables typically only list the target day, while the " +
            "inline visit sections carry the ± window notation (e.g. 'Day 14±3', 'Day 140 (±7 " +
            "days)'). For each visit, scan that visit's inline section for ± notation before " +
            "deciding on window_minus_days and window_plus_days. Do NOT default these to 0 " +
            "unless the protocol explicitly states the visit has no window or is fixed.",
        },
        settings: {
          citations: {
            enabled: true,
            numerical_confidence: false, // categorical high/low is enough; saves response size
          },
          // schedule_of_events can run 30-50 entries in long protocols; without
          // this flag Reducto silently truncates arrays past ~10 elements.
          array_extract: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto extract error: ${err}`);
      throw new Error(`Reducto extract error: ${err}`);
    }

    const data = await res.json();
    // Reducto Studio occasionally returns object keys with trailing spaces
    // (e.g. "visit_name " or "schedule_of_events "). Strip them recursively
    // before downstream code reads the fields; without this the SOTR adapter
    // and visit dedup step would silently miss the affected fields.
    const trimmed = trimKeys((data.result ?? data)) as Record<string, unknown>;
    // Reducto wraps every leaf field as { value, citations } (nested too, e.g.
    // schedule_of_events[i].visit_name = { value, citations }). The SOTR
    // adapter expects flat values + a single top-level _reducto_citations
    // sentinel keyed by field name. Reshape here so the adapter contract
    // doesn't have to know about the wrapper shape.
    return reshapeReductoExtractForAdapter(trimmed);
  }, "extractClinicalFields");
}

// Recursively trim trailing/leading whitespace from object keys. Reducto Studio
// returns trailing-space keys for some schemas; without this the downstream
// adapter (which keys lookups by exact field name) silently misses fields.
function trimKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.trim(), trimKeys(v)]),
    );
  }
  return value;
}

// Normalize a raw Reducto citation into the shape the SOTR adapter expects:
//   { text, pages: number[], confidence, section?, bbox: [{page,x1,y1,x2,y2}] }
// Reducto's per-field citation has:
//   { content, bbox: {left, top, width, height, page}, confidence, ... }
// Returns null if the input isn't recognisable as a citation.
function normalizeReductoCitation(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const text = typeof c.content === "string"
    ? c.content
    : typeof c.text === "string" ? c.text : undefined;

  let pages: number[] | undefined;
  let bbox: Array<Record<string, number>> | undefined;
  const rawBbox = c.bbox;
  if (rawBbox && typeof rawBbox === "object" && !Array.isArray(rawBbox)) {
    const b = rawBbox as Record<string, unknown>;
    if (typeof b.page === "number") pages = [b.page];
    if (
      typeof b.left   === "number" && typeof b.top    === "number" &&
      typeof b.width  === "number" && typeof b.height === "number" &&
      typeof b.page   === "number"
    ) {
      bbox = [{
        page: b.page,
        x1:   b.left,
        y1:   b.top,
        x2:   b.left + b.width,
        y2:   b.top  + b.height,
      }];
    }
  } else if (Array.isArray(rawBbox)) {
    bbox  = rawBbox as Array<Record<string, number>>;
    pages = (rawBbox as Array<Record<string, unknown>>)
      .map((b) => b?.page)
      .filter((p): p is number => typeof p === "number");
  }

  return {
    ...(text !== undefined            ? { text } : {}),
    ...(pages?.length                  ? { pages } : {}),
    ...(typeof c.confidence === "string" ? { confidence: c.confidence } : {}),
    ...(typeof c.section    === "string" ? { section:    c.section }    : {}),
    ...(bbox?.length                  ? { bbox } : {}),
  };
}

// Recursively unwrap Reducto's per-leaf {value, citations} wrappers. Returns
// the flat value and one representative citation for this subtree (used for
// array elements where the adapter expects a single citation per entry).
function unwrapValueCitations(
  node: unknown,
): { value: unknown; cit: Record<string, unknown> | null } {
  if (Array.isArray(node)) {
    return { value: node.map((n) => unwrapValueCitations(n).value), cit: null };
  }
  if (node === null || typeof node !== "object") {
    return { value: node, cit: null };
  }
  const obj = node as Record<string, unknown>;
  const keys = Object.keys(obj);

  // {value, citations} wrapper — unwrap to the inner value and lift the first citation.
  if (keys.length === 2 && "value" in obj && "citations" in obj) {
    const inner   = unwrapValueCitations(obj.value);
    const citList = Array.isArray(obj.citations) ? obj.citations : [obj.citations];
    const cit     = normalizeReductoCitation(citList[0]) ?? inner.cit;
    return { value: inner.value, cit };
  }

  // Plain object (e.g. one schedule_of_events entry): recurse into each
  // property. Pick visit_name's citation as the representative when present —
  // it's the most semantically meaningful per-visit anchor.
  const out: Record<string, unknown> = {};
  let representative: Record<string, unknown> | null = null;

  if ("visit_name" in obj) {
    const r = unwrapValueCitations(obj.visit_name);
    out.visit_name = r.value;
    representative = r.cit;
  }
  for (const k of keys) {
    if (k === "visit_name") continue;
    const r = unwrapValueCitations(obj[k]);
    out[k] = r.value;
    if (!representative) representative = r.cit;
  }
  return { value: out, cit: representative };
}

// Convert Reducto's nested {value, citations} response into the flat shape +
// _reducto_citations sentinel that the SOTR adapter consumes. Backward-
// compatible: if Reducto returns the old flat shape, citations come back
// empty and items still persist (just without evidence rows).
function reshapeReductoExtractForAdapter(
  result: Record<string, unknown>,
): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  const citationMap: Record<string, unknown> = {};

  for (const [field, node] of Object.entries(result)) {
    if (node === null || node === undefined) {
      flat[field] = node;
      continue;
    }
    if (Array.isArray(node)) {
      // Adapter expects citations[field] to be an array of citations parallel
      // to the value array (one per element).
      const elems: unknown[] = [];
      const cites: Array<Record<string, unknown> | null> = [];
      for (const elem of node) {
        const r = unwrapValueCitations(elem);
        elems.push(r.value);
        cites.push(r.cit);
      }
      flat[field] = elems;
      citationMap[field] = cites;
    } else {
      const r = unwrapValueCitations(node);
      flat[field] = r.value;
      if (r.cit) citationMap[field] = r.cit;
    }
  }

  return { ...flat, _reducto_citations: citationMap };
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

  // Resolve user_id + email from the caller's JWT so documents are scoped to
  // their owner. Email is needed for the missing-organization fallback in the
  // B2.4 inline-protocol-create block below.
  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let userId: string | null = null;
  let userEmail: string | null = null;
  if (userToken) {
    const { data: { user } } = await createClient(supabaseUrl, serviceRoleKey).auth.getUser(userToken);
    userId = user?.id ?? null;
    userEmail = user?.email ?? null;
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
    const { title, source, content, pdf_base64, protocol_id } = body;

    // Optional caller-provided protocol_id. The auto-tag trigger only fires
    // when protocol_id IS NULL, so an explicit value here is respected and
    // skips the extracted_fields.protocol_number lookup. Useful when:
    //   - the document is being uploaded from a protocol-scoped surface
    //     (e.g. ProtocolTab "Upload document"), or
    //   - Reducto won't reliably surface protocol_number (text uploads,
    //     supplemental docs like IBs without a header).
    const callerProtocolId =
      typeof protocol_id === "string" && protocol_id.length > 0 ? protocol_id : null;

    let chunks: ChunkData[] = [];
    let extractedFields: Record<string, unknown> | null = null;
    // Persisted on the documents row so Phase B3 fan-out can re-Extract
    // against this parse later (when a sibling document with an SoA lands).
    let reductoJobId: string | null = null;

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
      reductoJobId = parseResult.jobId ?? null;

      if (chunks.length === 0) {
        throw new Error("Reducto returned no text chunks from the PDF");
      }

      if (parseResult.jobId) {
        // B3.1: Strict failure semantics. If Reducto Parse succeeded (we have
        // chunks) but Extract fails, the document is half-baked — no
        // extracted_fields means an empty SOTR drawer, no auto-tag, no
        // schedule of events. Surface the failure clearly so the user can
        // retry, rather than silently producing a status='ready' doc with
        // nothing useful in it. Outer catch at ~line 1417 maps thrown
        // errors to documents.status='failed' + error_message + 5xx.
        try {
          extractedFields = await extractClinicalFields(parseResult.jobId, reductoKey);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[ingest] extract_failed", { error: msg });
          throw new Error(`Reducto Extract pass failed: ${msg}`);
        }
      }
    } else if (content && typeof content === "string") {
      chunks = splitIntoChunks(content);
    } else {
      return new Response(
        JSON.stringify({ error: "Either content (text) or pdf_base64 is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert document — status defaults to 'pending' via column default.
    // protocol_id is set explicitly here only when the caller provided one;
    // otherwise the documents_autotag_protocol_trg trigger fills it from
    // extracted_fields.protocol_number on the post-parse UPDATE.
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({
        title: title ?? "",
        source: source ?? "",
        user_id: userId,
        ...(callerProtocolId ? { protocol_id: callerProtocolId } : {}),
      })
      .select("id")
      .single();

    if (docError) throw docError;
    docId = doc.id;

    // -----------------------------------------------------------------
    // SOTR PR-4: persist the PDF in the protocol-pdfs bucket so the
    // Source Truth Panel can render the cited page later. Path
    // convention: "{user_id}/{document_id}.pdf" — RLS on storage.objects
    // checks the leading folder against auth.uid().
    //
    // Best-effort: a storage failure should not abort the whole ingest
    // (chunks + extracted_fields are still useful for RAG and worksheet
    // items). storage_path stays NULL on failure; the UI handles that.
    // -----------------------------------------------------------------
    let storagePath: string | null = null;
    if (pdf_base64) {
      try {
        const pathToWrite = `${userId}/${docId}.pdf`;
        // Reuse the already-decoded pdfBytes from the parse step above.
        const binaryStr = atob(pdf_base64);
        const bytesForUpload = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytesForUpload[i] = binaryStr.charCodeAt(i);
        }
        const { error: uploadError } = await supabase.storage
          .from("protocol-pdfs")
          .upload(pathToWrite, bytesForUpload, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (uploadError) {
          console.error("[ingest] pdf_storage_upload_failed", {
            document_id: docId,
            // Log only the error message; never the path or URL.
            error: uploadError.message,
          });
        } else {
          storagePath = pathToWrite;
        }
      } catch (e) {
        console.error("[ingest] pdf_storage_upload_threw", {
          document_id: docId,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }

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

    // ---------------------------------------------------------------------
    // SOTR persistence — runs BEFORE the documents.status='ready' flip so
    // that "ready" reliably means "user can open the SOTR drawer and find
    // data there." If this step fails (after retries), the document stays
    // out of 'ready' and the whole ingest fails — user sees a clear
    // upload-failed signal rather than an empty drawer.
    //
    // Idempotent on re-ingest: the RPC deletes prior evidence rows for the
    // document_id before re-inserting. Item rows upsert by field_path.
    // ---------------------------------------------------------------------
    let sotrItemsUpserted = 0;
    let sotrEvidenceInserted = 0;
    let sotrLinksInserted = 0;
    if (extractedFields) {
      const adapterOutput = mapReductoExtractToSotr(
        docId,
        extractedFields as ReductoExtractResponse,
        reductoJobId,
      );

      const sotrResult = await withRetry(async () => {
        const { data, error } = await supabase.rpc("sotr_ingest_adapter_output", {
          p_document_id:       docId,
          p_items:             adapterOutput.items,
          p_evidence:          adapterOutput.evidence,
          p_links:             adapterOutput.links,
          p_extraction_run_id: reductoJobId,
        });
        if (error) {
          // Non-retryable: bad data shape, auth/permission, RPC missing.
          // Retryable: transient network, deadlock, statement timeout.
          const code = (error as { code?: string }).code ?? "";
          const isPermanent = code.startsWith("42") || code === "23503";
          if (isPermanent) throw new NonRetryableError(`sotr_ingest_rpc_${code}: ${error.message}`);
          throw new Error(`sotr_ingest_rpc_${code || "transient"}: ${error.message}`);
        }
        return data as Record<string, unknown>;
      }, "sotrIngestAdapterOutput");

      sotrItemsUpserted    = Number(sotrResult["items_upserted"]    ?? 0);
      sotrEvidenceInserted = Number(sotrResult["evidence_inserted"] ?? 0);
      sotrLinksInserted    = Number(sotrResult["links_inserted"]    ?? 0);

      console.log("[ingest] sotr_persist_succeeded", {
        document_id:       docId,
        items_upserted:    sotrItemsUpserted,
        evidence_inserted: sotrEvidenceInserted,
        links_inserted:    sotrLinksInserted,
      });
    }

    const { error: updateError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        ...(extractedFields ? { extracted_fields: extractedFields } : {}),
        ...(storagePath ? { storage_path: storagePath } : {}),
        ...(reductoJobId ? { reducto_job_id: reductoJobId } : {}),
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

      let resolvedProtocolId = docRow?.protocol_id ?? null;

      // ---------------------------------------------------------------------
      // B2.4: auto-create protocol when the extracted study_number didn't
      // match any existing row for the caller's org.
      //
      // The documents_autotag_protocol_trg trigger above sets protocol_id
      // only when a `protocols.study_number_normalized` match exists. If
      // we still have a null protocol_id but Reducto pulled out a
      // protocol_number, that means this is the caller's first time loading
      // this study — create the protocols row, stamp it with the caller's
      // ownership, then tag this document to it.
      // ---------------------------------------------------------------------
      if (!resolvedProtocolId && extractedFields) {
        const studyNumber =
          typeof extractedFields.protocol_number === "string"
            ? extractedFields.protocol_number.trim()
            : "";
        if (studyNumber) {
          const { data: profile } = await supabase
            .from("user_profiles")
            .select("organization")
            .eq("id", userId)
            .maybeSingle();
          const profileOrg = typeof profile?.organization === "string" ? profile.organization.trim() : "";

          // Fall back to the email domain ("acme.com") or "Personal Workspace"
          // so a new user without a completed profile never gets stuck on the
          // onboarding wall after a successful parse. The owner_org column is
          // a free-text mirror that's used for RLS scoping with org-mates; the
          // domain is a sensible default since people at the same org usually
          // share a domain. The user can update their profile later and we
          // could backfill owner_org via a migration if needed.
          const emailDomain =
            userEmail && userEmail.includes("@")
              ? userEmail.split("@")[1].trim().toLowerCase()
              : "";
          const ownerOrg = profileOrg || emailDomain || "Personal Workspace";
          if (!profileOrg) {
            console.warn("[ingest] protocol_autocreate_fallback_owner_org", {
              document_id: docId,
              fallback: emailDomain ? "email_domain" : "personal_workspace",
              owner_org: ownerOrg,
            });
          }

          const protoTitle =
            (typeof extractedFields.protocol_title === "string" && extractedFields.protocol_title.trim()) ||
            studyNumber;
          const sponsorName =
            (typeof extractedFields.sponsor_name === "string" && extractedFields.sponsor_name.trim()) ||
            "Unknown sponsor";

            // Map Reducto's study_phase to the DB enum.
            const phaseRaw =
              typeof extractedFields.study_phase === "string" ? extractedFields.study_phase : "";
            const PHASE_MAP: Record<string, string> = {
              "Phase I": "PHASE_1",
              "Phase II": "PHASE_2",
              "Phase III": "PHASE_3",
              "Phase IV": "PHASE_4",
              "Not applicable": "NOT_APPLICABLE",
              "Unknown": "NOT_APPLICABLE",
            };
            const phaseEnum = PHASE_MAP[phaseRaw] ?? "NOT_APPLICABLE";

            const { data: newProtocol, error: insertProtocolError } = await supabase
              .from("protocols")
              .insert({
                study_number: studyNumber,
                title: protoTitle,
                sponsor: sponsorName,
                owner_id: userId,
                owner_org: ownerOrg,
              })
              .select("id")
              .maybeSingle();

            if (insertProtocolError) {
              // 23505 = unique violation. Could happen if a parallel ingest
              // beat us to it. Re-read documents to see if the trigger
              // caught up on second pass.
              console.warn("[ingest] protocol_autocreate_failed", {
                document_id: docId,
                study_number: studyNumber,
                error: insertProtocolError.message,
              });
            } else if (newProtocol) {
              // Seed the ACTIVE protocol_version. Site Mode consumes the
              // active version's phase label.
              await supabase.from("protocol_versions").insert({
                protocol_id: newProtocol.id,
                version_number: 1,
                status: "ACTIVE",
                clinical_trial_phase: phaseEnum,
              });

              // Tag this document.
              await supabase
                .from("documents")
                .update({ protocol_id: newProtocol.id })
                .eq("id", docId);

              resolvedProtocolId = newProtocol.id;
              console.log("[ingest] protocol_autocreated", {
                document_id: docId,
                protocol_id: newProtocol.id,
                study_number: studyNumber,
                owner_id: userId,
              });
            }
        }
      }

      const schedule = Array.isArray(extractedFields?.schedule_of_events)
        ? extractedFields!.schedule_of_events
        : [];

      const totalCrossRefs = (schedule as Array<{ cross_references?: unknown[] }>)
        .reduce((acc, s) => acc + (Array.isArray(s.cross_references) ? s.cross_references.length : 0), 0);

      console.log("[ingest] schedule_extracted", {
        document_id: docId,
        protocol_id: resolvedProtocolId,
        entry_count: schedule.length,
        cross_reference_count: totalCrossRefs,
      });

      if (resolvedProtocolId && schedule.length > 0) {
        type CrossRefEntry = {
          source_section?: unknown;
          snippet?: unknown;
          page?: unknown;
        };
        type ScheduleEntry = {
          visit_name?: unknown;
          study_day?: unknown;
          window_minus_days?: unknown;
          window_plus_days?: unknown;
          procedures?: unknown;
          cross_references?: unknown;
        };

        // Per-visit cross-reference sanitiser. Reducto sometimes returns
        // stray objects with missing fields; we drop anything without both
        // a source_section and a snippet rather than upsert garbage. The
        // document_id is stamped here (not by the LLM) so future cross-
        // document merges can attribute each entry back to its origin doc.
        const sanitizeCrossRefs = (raw: unknown): Array<{
          source_section: string;
          snippet: string;
          page: number | null;
          document_id: string;
        }> => {
          if (!Array.isArray(raw)) return [];
          return (raw as CrossRefEntry[])
            .filter(
              (r): r is CrossRefEntry =>
                !!r &&
                typeof r.source_section === "string" &&
                typeof r.snippet === "string" &&
                String(r.source_section).trim().length > 0 &&
                String(r.snippet).trim().length > 0,
            )
            .map((r) => ({
              source_section: String(r.source_section).trim(),
              snippet: String(r.snippet).trim(),
              page: typeof r.page === "number" ? Math.trunc(r.page) : null,
              document_id: docId,
            }));
        };

        const rows = (schedule as ScheduleEntry[])
          .filter((s) => s && typeof s.visit_name === "string" && typeof s.study_day === "number")
          .map((s) => ({
            protocol_id: resolvedProtocolId,
            visit_name: String(s.visit_name).trim(),
            study_day: Math.trunc(s.study_day as number),
            window_minus_days: typeof s.window_minus_days === "number" ? Math.max(0, Math.trunc(s.window_minus_days)) : 0,
            window_plus_days: typeof s.window_plus_days === "number" ? Math.max(0, Math.trunc(s.window_plus_days)) : 0,
            procedures: Array.isArray(s.procedures)
              ? (s.procedures as unknown[]).filter((p): p is string => typeof p === "string")
              : [],
            cross_references: sanitizeCrossRefs(s.cross_references),
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

    // ---------------------------------------------------------------------
    // Phase B3 — cross-document fan-out.
    //
    // Two paths, depending on what THIS document contributed:
    //
    //   Path A: this doc supplied an SoA (schedule.length > 0). Templates
    //   were just upserted with this doc's intra-doc cross-references.
    //   For every OTHER document tagged to the same protocol that has a
    //   stored Reducto job_id, re-Extract against the new visit list and
    //   merge that sibling's cross-references in.
    //
    //   Path B: this doc had no SoA, but auto-tag landed it on a protocol
    //   that already has templates. Scan THIS doc for cross-references to
    //   the existing visit list.
    //
    // Both paths share the merge helper, which partitions cross_references
    // by document_id so re-ingesting one doc replaces only its own entries
    // without disturbing what other docs contributed.
    //
    // Best-effort — failures don't fail the whole ingest.
    // ---------------------------------------------------------------------
    let fanoutDocsScanned = 0;
    let fanoutEntriesMerged = 0;
    try {
      const { data: docRow2 } = await supabase
        .from("documents")
        .select("protocol_id")
        .eq("id", docId)
        .maybeSingle();
      const protocolId = docRow2?.protocol_id ?? null;
      const reductoKey = Deno.env.get("REDUCTO_API_KEY");

      if (protocolId && reductoKey) {
        const schedule = Array.isArray(extractedFields?.schedule_of_events)
          ? (extractedFields!.schedule_of_events as Array<{
              visit_name?: unknown;
              study_day?: unknown;
            }>)
          : [];

        if (schedule.length > 0 && templatesInserted > 0) {
          // Path A — fan out to siblings.
          const visitListForFanOut = schedule
            .filter(
              (s) =>
                typeof s.visit_name === "string" &&
                typeof s.study_day === "number",
            )
            .map((s) => ({
              visit_name: String(s.visit_name).trim(),
              study_day: Math.trunc(s.study_day as number),
            }));

          const { data: siblings } = await supabase
            .from("documents")
            .select("id, reducto_job_id, title")
            .eq("protocol_id", protocolId)
            .neq("id", docId)
            .not("reducto_job_id", "is", null);

          for (const s of (siblings ?? []) as Array<{
            id: string;
            reducto_job_id: string;
            title: string | null;
          }>) {
            try {
              const hits = await extractCrossReferencesForVisits(
                s.reducto_job_id,
                visitListForFanOut,
                reductoKey,
              );
              const merge = await mergeCrossReferencesIntoTemplates(supabase, {
                protocol_id: protocolId,
                source_document_id: s.id,
                hits,
              });
              fanoutDocsScanned += 1;
              fanoutEntriesMerged += merge.entriesInserted;
            } catch (e) {
              console.error("[ingest] fanout_sibling_failed", {
                sibling_id: s.id,
                sibling_title: s.title,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        } else if (schedule.length === 0 && reductoJobId !== null) {
          // Path B — scan THIS doc against existing templates.
          const { data: existing } = await supabase
            .from("protocol_visit_templates")
            .select("visit_name, study_day")
            .eq("protocol_id", protocolId);

          const visits = ((existing ?? []) as Array<{
            visit_name: string;
            study_day: number;
          }>).map((v) => ({
            visit_name: v.visit_name,
            study_day: v.study_day,
          }));

          if (visits.length > 0) {
            try {
              const hits = await extractCrossReferencesForVisits(
                reductoJobId,
                visits,
                reductoKey,
              );
              const merge = await mergeCrossReferencesIntoTemplates(supabase, {
                protocol_id: protocolId,
                source_document_id: docId,
                hits,
              });
              fanoutDocsScanned += 1;
              fanoutEntriesMerged += merge.entriesInserted;
            } catch (e) {
              console.error("[ingest] fanout_self_failed", {
                document_id: docId,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
        }
      }

      console.log("[ingest] cross_ref_fanout", {
        document_id: docId,
        docs_scanned: fanoutDocsScanned,
        entries_merged: fanoutEntriesMerged,
      });
    } catch (e) {
      console.error("[ingest] fanout_processing_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // Re-read documents.protocol_id one more time so the response reflects
    // whatever the autotag trigger / B2.4 inline-create / cross-doc fan-out
    // ended up resolving. The frontend uses this to route the user post-upload
    // (e.g., into the Protocol tab if any items need review).
    let finalProtocolId: string | null = null;
    {
      const { data: docFinal } = await supabase
        .from("documents")
        .select("protocol_id")
        .eq("id", docId)
        .maybeSingle();
      finalProtocolId = (docFinal?.protocol_id as string | null) ?? null;
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: docId,
        protocol_id: finalProtocolId,
        chunks_created: inserted,
        extracted_fields: extractedFields,
        templates_inserted: templatesInserted,
        templates_materialized: templateMaterialized,
        cross_ref_docs_scanned: fanoutDocsScanned,
        cross_ref_entries_merged: fanoutEntriesMerged,
        sotr_items_upserted: sotrItemsUpserted,
        sotr_evidence_inserted: sotrEvidenceInserted,
        sotr_links_inserted: sotrLinksInserted,
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
