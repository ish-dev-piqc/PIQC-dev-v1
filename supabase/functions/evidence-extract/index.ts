// =============================================================================
// evidence-extract edge function — Word/Excel → text for the evidence register
// (PR-B2).
//
// A stateless transform: takes { filename, file_base64 }, returns
// { text, warnings, format }. Writes NOTHING — no database access, no service
// role, no storage. The client puts the extracted text into the evidence
// drawer's textarea for the auditor to REVIEW, then the shipped paste flow
// takes over (checkbox normalization → /ingest text path → attach RPC).
// /ingest is untouched.
//
//   .docx → npm:mammoth extractRawText (checkbox glyphs survive; the client
//           normalizes them before ingest, same as paste)
//   .xlsx → npm:xlsx (same lib the frontend already ships) — one "## Sheet:"
//           section per non-empty sheet, CSV-linearized
//
// Failure is honest and remediable: unsupported/corrupt files return a
// message telling the auditor to paste the text instead — the v1 path never
// went away. Output is capped at 500k chars WITH a warning (visible
// truncation beats silent embedding of a phone book).
//
// Auth: JWT validated against the auth server (anon-key client). No DB reads
// mean no RLS surface, but extraction is still compute — authenticated
// callers only, rate-limited.
// =============================================================================

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import mammoth from "npm:mammoth@1.8.0";
import * as XLSX from "npm:xlsx@0.18.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX       = 10;
const MAX_BODY_BYTES       = 20 * 1024 * 1024; // ~14MB file as base64 + envelope
const MAX_TEXT_CHARS       = 500_000;

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  if (rateLimitBuckets.size > 10_000) {
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (v.resetAt < now) rateLimitBuckets.delete(k);
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

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  console.log(JSON.stringify({
    level, event, timestamp: new Date().toISOString(), ...fields,
  }));
}

const PASTE_FALLBACK = "— open the file and paste its text instead; the paste path always works.";

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: jsonHeaders });
  }

  const ip = req.headers.get("cf-connecting-ip")
    ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim()
    ?? "unknown";
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }),
      { status: 429, headers: jsonHeaders });
  }

  const lenHeader = req.headers.get("content-length");
  if (lenHeader && parseInt(lenHeader, 10) > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: "File too large (max ~14 MB) " + PASTE_FALLBACK }),
      { status: 413, headers: jsonHeaders });
  }

  // JWT validation against the auth server — anon-key client, no service role.
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    log("error", "evidence_extract.missing_env", { request_id: requestId });
    return new Response(JSON.stringify({ error: "Service configuration error" }),
      { status: 500, headers: jsonHeaders });
  }
  const authHeader = req.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: "Not authenticated" }),
      { status: 401, headers: jsonHeaders });
  }
  const { data: { user } } = await createClient(supabaseUrl, supabaseAnonKey)
    .auth.getUser(token);
  if (!user) {
    return new Response(JSON.stringify({ error: "Not authenticated" }),
      { status: 401, headers: jsonHeaders });
  }

  let body: { filename?: string; file_base64?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: jsonHeaders });
  }
  const filename = typeof body.filename === "string" ? body.filename : "";
  const fileBase64 = typeof body.file_base64 === "string" ? body.file_base64 : "";
  if (!filename || !fileBase64) {
    return new Response(JSON.stringify({ error: "filename and file_base64 are required" }),
      { status: 400, headers: jsonHeaders });
  }

  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext !== "docx" && ext !== "xlsx") {
    return new Response(
      JSON.stringify({ error: `.${ext} files aren't supported yet (Word .docx and Excel .xlsx only) ${PASTE_FALLBACK}` }),
      { status: 400, headers: jsonHeaders });
  }

  let bytes: Uint8Array;
  try {
    const binaryStr = atob(fileBase64);
    bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  } catch {
    return new Response(JSON.stringify({ error: "file_base64 is not valid base64" }),
      { status: 400, headers: jsonHeaders });
  }

  const warnings: string[] = [];
  let text = "";

  try {
    if (ext === "docx") {
      const result = await mammoth.extractRawText({ arrayBuffer: bytes.buffer });
      text = String(result.value ?? "");
      for (const m of result.messages ?? []) {
        if (m?.message) warnings.push(String(m.message));
      }
    } else {
      const workbook = XLSX.read(bytes, { type: "array" });
      const sections: string[] = [];
      for (const sheetName of workbook.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
        if (csv.trim().length === 0) continue;
        sections.push(`## Sheet: ${sheetName}\n${csv}`);
      }
      if (sections.length < workbook.SheetNames.length) {
        warnings.push(`${workbook.SheetNames.length - sections.length} empty sheet(s) skipped`);
      }
      text = sections.join("\n\n");
    }
  } catch (err) {
    log("warn", "evidence_extract.parse_failed", {
      request_id: requestId, format: ext, error: String(err),
    });
    return new Response(
      JSON.stringify({ error: `Couldn't read this ${ext === "docx" ? "Word" : "Excel"} file ${PASTE_FALLBACK}` }),
      { status: 422, headers: jsonHeaders });
  }

  if (text.trim().length === 0) {
    return new Response(
      JSON.stringify({ error: `No text found in the file ${PASTE_FALLBACK}` }),
      { status: 422, headers: jsonHeaders });
  }

  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    warnings.push(`Document truncated at ${MAX_TEXT_CHARS.toLocaleString("en-US")} characters`);
  }

  // Counts only — never content.
  log("info", "evidence_extract.ok", {
    request_id: requestId,
    format: ext,
    bytes: bytes.length,
    chars: text.length,
    warning_count: warnings.length,
  });

  return new Response(JSON.stringify({ text, warnings, format: ext }),
    { status: 200, headers: jsonHeaders });
});
