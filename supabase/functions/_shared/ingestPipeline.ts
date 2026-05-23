// =============================================================================
// Shared ingest pipeline — the post-parse work shared by /ingest (for
// dedup-hit / text-only paths), /reducto-webhook (the async happy path), and
// /ingest-recover (the stuck-pending safety net).
//
// Why this exists: the original /ingest function did Reducto upload + parse +
// extract + embeddings + SOTR persist + B2.4 + visit templates + cross-doc
// fan-out all inside one HTTP request, which exceeded Supabase Edge Functions'
// 150-second wall-clock cap on long protocols (504 IDLE_TIMEOUT). The async
// refactor split that into:
//
//   /ingest                — fast (hash + dedup + INSERT pending + Storage +
//                            kick off Reducto async with Svix webhook config)
//   /reducto-webhook       — Svix callback. Verifies signature, returns 200
//                            quickly, then runs processIngestCompletion()
//                            via EdgeRuntime.waitUntil in the background.
//   /ingest-recover        — Authenticated. For stuck-pending documents,
//                            polls Reducto job status and runs
//                            processIngestCompletion() if Reducto says done.
//
// This module is the slow-path completion logic that all three call.
// =============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { mapReductoExtractToSotr } from "./sourceEvidenceAdapter.ts";
import type { ReductoExtractResponse } from "./sotrTypes.ts";

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

export const CHUNK_SIZE = 400;
export const CHUNK_OVERLAP = 50;
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const REDUCTO_BASE_URL = "https://platform.reducto.ai";
export const EMBED_MAX_RETRIES = 3;
export const REDUCTO_MAX_RETRIES = 3;
const EMBED_BATCH_SIZE = 20;

// -----------------------------------------------------------------------------
// Error type + retry helper (used throughout)
// -----------------------------------------------------------------------------

/** Signals that an error should not be retried (e.g. 4xx auth/client errors). */
export class NonRetryableError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries = REDUCTO_MAX_RETRIES,
): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await sleep(1_000 * Math.pow(2, attempt - 1));
    try {
      return await fn();
    } catch (err) {
      if (err instanceof NonRetryableError) throw err;
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error(`${label} failed after ${maxRetries} retries`);
}

// -----------------------------------------------------------------------------
// Reducto chunk shapes
// -----------------------------------------------------------------------------

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

export interface ChunkData {
  content: string;
  page_start: number | null;
  page_end: number | null;
  section_heading: string | null;
  block_types: string[] | null;
}

/** Map Reducto's raw chunk shape into our internal ChunkData (with bbox-derived
 * page ranges + section-header tracking). Factored out of the previous
 * parsePdfWithReducto so both the sync parse and async-result-fetch paths
 * produce the same shape. */
export function mapRawChunksToChunkData(rawChunks: ReductoChunk[]): ChunkData[] {
  const SECTION_BLOCK_TYPES = new Set(["Section Header", "Title"]);
  let currentSection: string | null = null;

  return rawChunks
    .map((c: ReductoChunk): ChunkData | null => {
      const content = (c.embed || c.content || "").trim();
      if (!content) return null;

      const blocks: ReductoBlock[] = Array.isArray(c.blocks) ? c.blocks : [];

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

/** Plain-text fallback for non-PDF text uploads. */
export function splitIntoChunks(text: string): ChunkData[] {
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

// -----------------------------------------------------------------------------
// OpenAI embeddings
// -----------------------------------------------------------------------------

export async function embedText(text: string, apiKey: string): Promise<number[]> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < EMBED_MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(1_000 * Math.pow(2, attempt - 1));
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

// -----------------------------------------------------------------------------
// Reducto API
// -----------------------------------------------------------------------------

export async function uploadToReducto(pdfBytes: Uint8Array, reductoKey: string): Promise<string> {
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

/**
 * Kick off a Reducto parse asynchronously. Returns the job_id immediately;
 * the caller polls /job/{job_id} until status is Completed/Failed (see
 * fetchReductoJobResult below). Frontend polling is driven from
 * /ingest-status while a document is in status='pending'.
 *
 * No webhook config — Reducto's webhook delivery is via Svix which requires
 * dashboard access PIQC doesn't have today. Polling is the equivalent path
 * per Reducto's docs (docs.reducto.ai/async-invocation).
 */
export async function kickOffReductoParseAsync(
  fileId: string,
  reductoKey: string,
): Promise<string> {
  return withRetry(async () => {
    const res = await fetch(`${REDUCTO_BASE_URL}/parse_async`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reductoKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: fileId,
        retrieval: {
          chunking: { chunk_mode: "variable", chunk_overlap: 50 },
          embedding_optimized: true,
          filter_blocks: ["Header", "Footer", "Page Number"],
        },
        settings: {
          ocr_system: "standard",
          extraction_mode: "hybrid",
        },
        formatting: {
          table_output_format: "dynamic",
          add_page_markers: true,
          merge_tables: true,
          include: ["change_tracking"],
        },
        enhance: {
          agentic: [{ scope: "table" }, { scope: "figure" }],
          intelligent_ordering: true,
        },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto parse_async error: ${err}`);
      throw new Error(`Reducto parse_async error: ${err}`);
    }

    const data = await res.json();
    const jobId = data.job_id as string | undefined;
    if (!jobId) throw new Error("Reducto parse_async returned no job_id");
    return jobId;
  }, "kickOffReductoParseAsync");
}

/**
 * Fetch the result for a completed Reducto parse job. Returns the raw chunks
 * + the job status. Used by /reducto-webhook after Svix tells us the job is
 * done, and by /ingest-recover when polling stuck-pending documents.
 */
export async function fetchReductoJobResult(
  jobId: string,
  reductoKey: string,
): Promise<{ status: string; chunks: ChunkData[] }> {
  return withRetry(async () => {
    const res = await fetch(`${REDUCTO_BASE_URL}/job/${jobId}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${reductoKey}` },
    });

    if (!res.ok) {
      const err = await res.text();
      if (res.status < 500) throw new NonRetryableError(`Reducto job fetch error: ${err}`);
      throw new Error(`Reducto job fetch error: ${err}`);
    }

    const data = await res.json();
    const status = (data.status as string | undefined) ?? "Unknown";

    let rawChunks: ReductoChunk[] = [];
    if (Array.isArray(data.result?.chunks)) {
      rawChunks = data.result.chunks;
    } else if (Array.isArray(data.chunks)) {
      rawChunks = data.chunks;
    }

    return { status, chunks: mapRawChunksToChunkData(rawChunks) };
  }, "fetchReductoJobResult");
}

// -----------------------------------------------------------------------------
// CLINICAL_EXTRACT_SCHEMA + Reducto Extract pass
// -----------------------------------------------------------------------------

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
        "Schedule of events / visit schedule. Each entry is one planned visit with its study-day offset and procedures.",
      items: {
        type: "object",
        properties: {
          visit_name: { type: "string" },
          study_day: { type: "integer" },
          window_minus_days: {
            type: "integer",
            description:
              "Permissible visit window — days BEFORE the scheduled date. Search inline visit-description " +
              "sections for ± notation (e.g. 'Day 14±3'). Return 0 only if explicitly stated as no window.",
          },
          window_plus_days: {
            type: "integer",
            description:
              "Permissible visit window — days AFTER the scheduled date. Same ± search guidance as window_minus_days.",
          },
          procedures: {
            type: "array",
            items: { type: "string" },
          },
          schedule_variant: {
            type: "string",
            description:
              "Sub-population label (e.g. 'PK Substudy Participants'). Empty string if single schedule.",
          },
          cross_references: {
            type: "array",
            description:
              "Every OTHER place in this document that references this visit, adding context not in `procedures`.",
            items: {
              type: "object",
              properties: {
                source_section: { type: "string" },
                snippet: { type: "string" },
                page: { type: ["integer", "null"] },
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

export async function extractClinicalFields(
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
            "Assessments (SoA) table for ± window notation.",
        },
        settings: {
          citations: { enabled: true, numerical_confidence: false },
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
    const trimmed = trimKeys((data.result ?? data)) as Record<string, unknown>;
    return reshapeReductoExtractForAdapter(trimmed);
  }, "extractClinicalFields");
}

// -----------------------------------------------------------------------------
// Reducto Extract response post-processing (value/citation unwrap helpers)
// -----------------------------------------------------------------------------

function trimKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(trimKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.trim(), trimKeys(v)]),
    );
  }
  return value;
}

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
      typeof b.left === "number" && typeof b.top === "number" &&
      typeof b.width === "number" && typeof b.height === "number" &&
      typeof b.page === "number"
    ) {
      bbox = [{
        page: b.page,
        x1: b.left,
        y1: b.top,
        x2: b.left + b.width,
        y2: b.top + b.height,
      }];
    }
  } else if (Array.isArray(rawBbox)) {
    bbox = rawBbox as Array<Record<string, number>>;
    pages = (rawBbox as Array<Record<string, unknown>>)
      .map((b) => b?.page)
      .filter((p): p is number => typeof p === "number");
  }

  return {
    ...(text !== undefined ? { text } : {}),
    ...(pages?.length ? { pages } : {}),
    ...(typeof c.confidence === "string" ? { confidence: c.confidence } : {}),
    ...(typeof c.section === "string" ? { section: c.section } : {}),
    ...(bbox?.length ? { bbox } : {}),
  };
}

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

  if (keys.length === 2 && "value" in obj && "citations" in obj) {
    const inner = unwrapValueCitations(obj.value);
    const citList = Array.isArray(obj.citations) ? obj.citations : [obj.citations];
    const cit = normalizeReductoCitation(citList[0]) ?? inner.cit;
    return { value: inner.value, cit };
  }

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

// -----------------------------------------------------------------------------
// Cross-doc fan-out (Phase B3) — extract + merge
// -----------------------------------------------------------------------------

export interface CrossRefHit {
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
          "(visit_name, 'Day N', 'Visit N', etc). Return a verbatim passage that adds context not " +
          "already in the schedule. Skip Schedule-of-Assessments tables. " +
          "Return empty array if no references.",
        items: {
          type: "object",
          properties: {
            visit_name: { type: "string" },
            study_day: { type: "integer" },
            source_section: { type: "string" },
            snippet: { type: "string" },
            page: { type: ["integer", "null"] },
          },
          required: ["visit_name", "study_day", "source_section", "snippet"],
        },
      },
    },
    required: ["cross_references"],
  };
}

export async function extractCrossReferencesForVisits(
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

interface MergeTarget {
  protocol_id: string;
  source_document_id: string;
  hits: CrossRefHit[];
}

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

export async function mergeCrossReferencesIntoTemplates(
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

// -----------------------------------------------------------------------------
// processIngestCompletion — the orchestrator that runs all the post-parse
// work. Called from /reducto-webhook (via EdgeRuntime.waitUntil) and from
// /ingest-recover (synchronously, within an authenticated request).
// -----------------------------------------------------------------------------

export interface ProcessCompletionOpts {
  /** Document row we're completing. status must be 'pending' at start. */
  docId: string;
  /** Reducto job_id from the async parse kick-off (stored on documents). */
  reductoJobId: string;
  /** Owner of the document (used for B2.4 inline-create when no protocols
   *  row matches the extracted study_number). */
  userId: string;
  /** Email used for the missing-org fallback in B2.4. */
  userEmail: string | null;
  /** Pre-resolved API keys (callers fetch from env once). */
  openaiKey: string;
  reductoKey: string;
}

export interface ProcessCompletionResult {
  ok: boolean;
  protocolId: string | null;
  chunksInserted: number;
  templatesInserted: number;
  sotrItemsUpserted: number;
  error?: string;
}

/**
 * Run the second half of ingest given a completed Reducto parse job. On any
 * error, marks documents.status='failed' with error_message and returns a
 * result with `ok: false`. On success, documents.status='ready'.
 *
 * Caller is responsible for: verifying the document_id+job_id pairing,
 * idempotency check (status != 'pending' → skip), and deciding the HTTP
 * response code (this function never throws to the caller).
 */
export async function processIngestCompletion(
  supabase: ReturnType<typeof createClient>,
  opts: ProcessCompletionOpts,
): Promise<ProcessCompletionResult> {
  const { docId, reductoJobId, userId, userEmail, openaiKey, reductoKey } = opts;
  const result: ProcessCompletionResult = {
    ok: false,
    protocolId: null,
    chunksInserted: 0,
    templatesInserted: 0,
    sotrItemsUpserted: 0,
  };

  try {
    // ---------------------------------------------------------------------
    // 1. Fetch parse result + extract clinical fields
    // ---------------------------------------------------------------------
    const parseResult = await fetchReductoJobResult(reductoJobId, reductoKey);
    if (parseResult.status !== "Completed" && parseResult.status !== "completed") {
      throw new Error(`Reducto job not completed (status=${parseResult.status})`);
    }
    if (parseResult.chunks.length === 0) {
      throw new Error("Reducto returned no chunks for completed job");
    }

    let extractedFields: Record<string, unknown> | null = null;
    try {
      extractedFields = await extractClinicalFields(reductoJobId, reductoKey);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Reducto extract pass failed: ${msg}`);
    }

    // ---------------------------------------------------------------------
    // 2. Insert chunks with embeddings (batched 20 in parallel within batch)
    // ---------------------------------------------------------------------
    for (let b = 0; b < parseResult.chunks.length; b += EMBED_BATCH_SIZE) {
      const batch = parseResult.chunks.slice(b, b + EMBED_BATCH_SIZE);
      const embeddings = await Promise.all(
        batch.map((c) => embedText(c.content, openaiKey)),
      );
      const rows = batch.map((c, i) => ({
        document_id: docId,
        content: c.content,
        chunk_index: b + i,
        embedding: JSON.stringify(embeddings[i]),
        page_start: c.page_start,
        page_end: c.page_end,
        section_heading: c.section_heading,
        block_types: c.block_types ? JSON.stringify(c.block_types) : null,
      }));
      const { error: insertError } = await supabase.from("chunks").insert(rows);
      if (insertError) throw insertError;
      result.chunksInserted += batch.length;
    }

    // ---------------------------------------------------------------------
    // 3. SOTR persistence
    // ---------------------------------------------------------------------
    if (extractedFields) {
      const adapterOutput = mapReductoExtractToSotr(
        docId,
        extractedFields as ReductoExtractResponse,
        reductoJobId,
      );

      const sotrResult = await withRetry(async () => {
        const { data, error } = await supabase.rpc("sotr_ingest_adapter_output", {
          p_document_id: docId,
          p_items: adapterOutput.items,
          p_evidence: adapterOutput.evidence,
          p_links: adapterOutput.links,
          p_extraction_run_id: reductoJobId,
        });
        if (error) {
          const code = (error as { code?: string }).code ?? "";
          const isPermanent = code.startsWith("42") || code === "23503";
          if (isPermanent) throw new NonRetryableError(`sotr_ingest_rpc_${code}: ${error.message}`);
          throw new Error(`sotr_ingest_rpc_${code || "transient"}: ${error.message}`);
        }
        return data as Record<string, unknown>;
      }, "sotrIngestAdapterOutput");

      result.sotrItemsUpserted = Number(sotrResult["items_upserted"] ?? 0);
      console.log("[ingest] sotr_persist_succeeded", {
        document_id: docId,
        items_upserted: result.sotrItemsUpserted,
      });
    }

    // ---------------------------------------------------------------------
    // 4. UPDATE documents → fires autotag trigger
    // ---------------------------------------------------------------------
    const { error: updateError } = await supabase
      .from("documents")
      .update({
        status: "ready",
        ...(extractedFields ? { extracted_fields: extractedFields } : {}),
        reducto_job_id: reductoJobId,
      })
      .eq("id", docId);
    if (updateError) throw updateError;

    // ---------------------------------------------------------------------
    // 5. B2.4 inline protocol auto-create + visit templates
    // ---------------------------------------------------------------------
    try {
      const { data: docRow } = await supabase
        .from("documents")
        .select("protocol_id")
        .eq("id", docId)
        .maybeSingle();

      let resolvedProtocolId = docRow?.protocol_id ?? null;

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
            console.warn("[ingest] protocol_autocreate_failed", {
              document_id: docId,
              study_number: studyNumber,
              error: insertProtocolError.message,
            });
          } else if (newProtocol) {
            await supabase.from("protocol_versions").insert({
              protocol_id: newProtocol.id,
              version_number: 1,
              status: "ACTIVE",
              clinical_trial_phase: phaseEnum,
            });

            await supabase
              .from("documents")
              .update({ protocol_id: newProtocol.id })
              .eq("id", docId);

            resolvedProtocolId = newProtocol.id;
            console.log("[ingest] protocol_autocreated", {
              document_id: docId,
              protocol_id: newProtocol.id,
              study_number: studyNumber,
            });
          }
        }
      }

      result.protocolId = resolvedProtocolId;

      const schedule = Array.isArray(extractedFields?.schedule_of_events)
        ? extractedFields!.schedule_of_events
        : [];

      if (resolvedProtocolId && schedule.length > 0) {
        type CrossRefEntry = { source_section?: unknown; snippet?: unknown; page?: unknown };
        type ScheduleEntry = {
          visit_name?: unknown;
          study_day?: unknown;
          window_minus_days?: unknown;
          window_plus_days?: unknown;
          procedures?: unknown;
          cross_references?: unknown;
        };

        const sanitizeCrossRefs = (raw: unknown) => {
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
            result.templatesInserted = rows.length;

            const { data: protoRow } = await supabase
              .from("protocols")
              .select("demo_anchor_date")
              .eq("id", resolvedProtocolId)
              .maybeSingle();
            if (protoRow?.demo_anchor_date) {
              await supabase.rpc("materialize_protocol_visits", {
                p_protocol_id: resolvedProtocolId,
              });
            }
          }
        }
      }
    } catch (e) {
      console.error("[ingest] schedule_processing_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // ---------------------------------------------------------------------
    // 6. Cross-doc fan-out (best-effort)
    // ---------------------------------------------------------------------
    try {
      const { data: docRow2 } = await supabase
        .from("documents")
        .select("protocol_id")
        .eq("id", docId)
        .maybeSingle();
      const protocolId = docRow2?.protocol_id ?? null;
      const schedule = Array.isArray(extractedFields?.schedule_of_events)
        ? (extractedFields!.schedule_of_events as Array<{ visit_name?: unknown; study_day?: unknown }>)
        : [];

      if (protocolId && schedule.length > 0 && result.templatesInserted > 0) {
        const visitListForFanOut = schedule
          .filter((s) => typeof s.visit_name === "string" && typeof s.study_day === "number")
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

        for (const s of (siblings ?? []) as Array<{ id: string; reducto_job_id: string; title: string | null }>) {
          try {
            const hits = await extractCrossReferencesForVisits(
              s.reducto_job_id,
              visitListForFanOut,
              reductoKey,
            );
            await mergeCrossReferencesIntoTemplates(supabase, {
              protocol_id: protocolId,
              source_document_id: s.id,
              hits,
            });
          } catch (e) {
            console.error("[ingest] fanout_sibling_failed", {
              sibling_id: s.id,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      } else if (protocolId && schedule.length === 0) {
        const { data: existing } = await supabase
          .from("protocol_visit_templates")
          .select("visit_name, study_day")
          .eq("protocol_id", protocolId);
        const visits = ((existing ?? []) as Array<{ visit_name: string; study_day: number }>).map((v) => ({
          visit_name: v.visit_name,
          study_day: v.study_day,
        }));
        if (visits.length > 0) {
          try {
            const hits = await extractCrossReferencesForVisits(reductoJobId, visits, reductoKey);
            await mergeCrossReferencesIntoTemplates(supabase, {
              protocol_id: protocolId,
              source_document_id: docId,
              hits,
            });
          } catch (e) {
            console.error("[ingest] fanout_self_failed", {
              document_id: docId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        }
      }
    } catch (e) {
      console.error("[ingest] fanout_processing_failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    result.ok = true;
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ingest] processIngestCompletion failed", { document_id: docId, error: message });
    await supabase
      .from("documents")
      .update({ status: "failed", error_message: message })
      .eq("id", docId);
    result.error = message;
    return result;
  }
}
