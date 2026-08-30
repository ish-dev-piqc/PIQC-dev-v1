import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  embedText,
  kickOffReductoParseAsync,
  splitIntoChunks,
  uploadToReducto,
  type ChunkData,
} from "../_shared/ingestPipeline.ts";

// =============================================================================
// /ingest — fast entry point for protocol ingest.
//
// PDF path (the production case):
//   1. Auth (user JWT)
//   2. SHA-256(pdf_bytes) for dedup
//   3. SELECT documents WHERE user_id, content_hash
//      ├─ status='ready'  → return 200 { existing IDs, deduped:true }
//      ├─ status='pending' → return 202 { existing IDs, deduped:true }
//      └─ status='failed' → fall through, retry as new document
//   4. INSERT documents (status='pending', content_hash)
//   5. Upload PDF bytes to Supabase Storage (best-effort)
//   6. Upload to Reducto + kick off ASYNC parse with Svix webhook config
//   7. UPDATE documents.reducto_job_id
//   8. Return 202 { document_id, status: 'pending' }
//
// Reducto then runs parse in their cloud (no time pressure on us). When done,
// Svix POSTs to /reducto-webhook, which finishes the work via the shared
// processIngestCompletion orchestrator.
//
// Text path (admin RAG documents — rare, small, fast):
//   Kept synchronous since no Reducto involvement. Inserts document, chunks
//   inline via splitIntoChunks, embeds, marks 'ready', returns 200.
// =============================================================================

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const jsonHeaders = { ...corsHeaders, "Content-Type": "application/json" };

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 5;
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const EMBED_BATCH_SIZE = 20;

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

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkRateLimit(ip)) {
    return new Response(
      JSON.stringify({ error: "Too many requests — please wait before ingesting again" }),
      { status: 429, headers: jsonHeaders },
    );
  }

  const contentLength = parseInt(req.headers.get("content-length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(
      JSON.stringify({ error: "Request body too large (max 50 MB)" }),
      { status: 413, headers: jsonHeaders },
    );
  }

  const openaiKey = Deno.env.get("OPENAI_API_KEY");
  if (!openaiKey) {
    return new Response(
      JSON.stringify({ error: "OPENAI_API_KEY not configured" }),
      { status: 500, headers: jsonHeaders },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Resolve user_id from caller's JWT for ownership.
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
      { status: 401, headers: jsonHeaders },
    );
  }

  let docId: string | null = null;

  try {
    const body = await req.json();
    const { title, source, filename, content, pdf_base64, protocol_id, kind } = body;

    const callerProtocolId =
      typeof protocol_id === "string" && protocol_id.length > 0 ? protocol_id : null;

    // Document kind — 'PROTOCOL' (default) or 'AUDIT_EVIDENCE' (audit evidence
    // register, text path only; protocol_id must stay NULL so evidence never
    // enters protocol-scoped search).
    const docKind = kind ?? "PROTOCOL";
    if (docKind !== "PROTOCOL" && docKind !== "AUDIT_EVIDENCE") {
      return new Response(
        JSON.stringify({ error: `Unknown document kind: ${kind}` }),
        { status: 400, headers: jsonHeaders },
      );
    }
    if (docKind === "AUDIT_EVIDENCE" && pdf_base64) {
      return new Response(
        JSON.stringify({
          error: "PDF evidence isn't supported yet — paste the text content instead",
        }),
        { status: 400, headers: jsonHeaders },
      );
    }
    if (docKind === "AUDIT_EVIDENCE" && callerProtocolId) {
      return new Response(
        JSON.stringify({ error: "Evidence documents cannot carry a protocol_id" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    // -----------------------------------------------------------------
    // PDF PATH — async via Reducto + Svix webhook
    // -----------------------------------------------------------------
    if (pdf_base64) {
      const reductoKey = Deno.env.get("REDUCTO_API_KEY");
      if (!reductoKey) {
        return new Response(
          JSON.stringify({ error: "REDUCTO_API_KEY not configured" }),
          { status: 500, headers: jsonHeaders },
        );
      }

      // Decode PDF bytes once for both hashing and Reducto upload.
      const binaryStr = atob(pdf_base64);
      const pdfBytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) pdfBytes[i] = binaryStr.charCodeAt(i);

      // Step 1: hash + dedup check.
      const contentHash = await sha256Hex(pdfBytes);
      const { data: existing } = await supabase
        .from("documents")
        .select("id, status, protocol_id")
        .eq("user_id", userId)
        .eq("content_hash", contentHash)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        if (existing.status === "ready") {
          return new Response(
            JSON.stringify({
              success: true,
              document_id: existing.id,
              protocol_id: existing.protocol_id,
              status: "ready",
              deduped: true,
            }),
            { headers: jsonHeaders },
          );
        }
        if (existing.status === "pending") {
          return new Response(
            JSON.stringify({
              success: true,
              document_id: existing.id,
              protocol_id: existing.protocol_id,
              status: "pending",
              deduped: true,
            }),
            { status: 202, headers: jsonHeaders },
          );
        }
        // status === 'failed' → fall through and retry as new document
      }

      // Step 2: INSERT documents (status='pending' via column default).
      const { data: doc, error: docError } = await supabase
        .from("documents")
        .insert({
          title: title ?? "",
          source: source ?? "Protocol upload",
          filename: filename ?? null,
          user_id: userId,
          content_hash: contentHash,
          kind: docKind,
          ...(callerProtocolId ? { protocol_id: callerProtocolId } : {}),
        })
        .select("id")
        .single();
      if (docError) throw docError;
      docId = doc.id;

      // Step 3: Upload PDF to Storage (best-effort — SOTR drawer needs this
      // later for cited-page rendering, but a storage failure shouldn't
      // abort the ingest pipeline).
      try {
        const pathToWrite = `${userId}/${docId}.pdf`;
        const { error: uploadError } = await supabase.storage
          .from("protocol-pdfs")
          .upload(pathToWrite, pdfBytes, {
            contentType: "application/pdf",
            upsert: true,
          });
        if (uploadError) {
          console.error("[ingest] pdf_storage_upload_failed", {
            document_id: docId,
            error: uploadError.message,
          });
        } else {
          await supabase
            .from("documents")
            .update({ storage_path: pathToWrite })
            .eq("id", docId);
        }
      } catch (e) {
        console.error("[ingest] pdf_storage_upload_threw", {
          document_id: docId,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      // Step 4: Upload PDF to Reducto + kick off async parse. Job runs in
      // Reducto's cloud (no time pressure on us). When REDUCTO_WEBHOOK_SECRET is
      // configured, Reducto POSTs the completed job to /reducto-webhook directly
      // (server-side, browser-independent — the long-PDF reliability fix);
      // otherwise the frontend polls /ingest-status as before. The cron recover
      // is the safety net for a missed webhook either way.
      const fileId = await uploadToReducto(pdfBytes, reductoKey);
      const webhookSecret = Deno.env.get("REDUCTO_WEBHOOK_SECRET");
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const webhook = webhookSecret && supabaseUrl
        ? {
          url: `${supabaseUrl}/functions/v1/reducto-webhook?token=${encodeURIComponent(webhookSecret)}`,
          documentId: docId,
        }
        : undefined;
      const reductoJobId = await kickOffReductoParseAsync(fileId, reductoKey, webhook);

      // Step 5: Stash the job_id so /ingest-recover can find this doc if
      // Reducto's webhook delivery fails.
      await supabase
        .from("documents")
        .update({ reducto_job_id: reductoJobId })
        .eq("id", docId);

      console.log("[ingest] async_parse_kicked_off", {
        document_id: docId,
        reducto_job_id: reductoJobId,
        user_id: userId,
      });

      return new Response(
        JSON.stringify({
          success: true,
          document_id: docId,
          status: "pending",
        }),
        { status: 202, headers: jsonHeaders },
      );
    }

    // -----------------------------------------------------------------
    // TEXT PATH — sync (no Reducto, no schedule extraction, just RAG)
    // -----------------------------------------------------------------
    if (content && typeof content === "string") {
      const chunks: ChunkData[] = splitIntoChunks(content);

      // Hash vouches for the retained text (evidence provenance); no dedup —
      // documents_user_hash_idx is deliberately non-unique.
      const contentHash = await sha256Hex(new TextEncoder().encode(content));

      const { data: doc, error: docError } = await supabase
        .from("documents")
        .insert({
          title: title ?? "",
          source: source ?? "",
          user_id: userId,
          content_hash: contentHash,
          kind: docKind,
          ...(callerProtocolId ? { protocol_id: callerProtocolId } : {}),
        })
        .select("id")
        .single();
      if (docError) throw docError;
      docId = doc.id;

      let inserted = 0;
      for (let b = 0; b < chunks.length; b += EMBED_BATCH_SIZE) {
        const batch = chunks.slice(b, b + EMBED_BATCH_SIZE);
        const embeddings = await Promise.all(
          batch.map((c) => embedText(c.content, openaiKey)),
        );
        const rows = batch.map((c, i) => ({
          document_id: docId,
          content: c.content,
          chunk_index: b + i,
          embedding: JSON.stringify(embeddings[i]),
          page_start: null,
          page_end: null,
          section_heading: null,
          block_types: null,
        }));
        const { error: insertError } = await supabase.from("chunks").insert(rows);
        if (insertError) throw insertError;
        inserted += batch.length;
      }

      await supabase
        .from("documents")
        .update({ status: "ready" })
        .eq("id", docId);

      return new Response(
        JSON.stringify({
          success: true,
          document_id: docId,
          status: "ready",
          chunks_created: inserted,
        }),
        { headers: jsonHeaders },
      );
    }

    return new Response(
      JSON.stringify({ error: "Either content (text) or pdf_base64 is required" }),
      { status: 400, headers: jsonHeaders },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (docId) {
      await supabase
        .from("documents")
        .update({ status: "failed", error_message: message })
        .eq("id", docId);
    }
    console.error("[ingest] error", { document_id: docId, error: message });
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
