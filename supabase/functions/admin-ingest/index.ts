import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { uploadToReducto, kickOffReductoParseAsync } from "../_shared/ingestPipeline.ts";

// =============================================================================
// /admin-ingest — ONE-OFF, SERVICE-ROLE-ONLY operator tool.
//
// Mirrors the PDF path of /ingest (hash → doc insert → storage → Reducto submit)
// but gated to the service_role bearer with an explicit user_id, so an operator
// can re-ingest a protocol without an end-user browser session. Returns the new
// document_id + reducto_job_id immediately; finalize via /admin-finalize-doc
// once Reducto reports the job complete.
//
// DELETE THIS FUNCTION once the re-ingest is done — not part of the product.
// =============================================================================

const jsonHeaders = { "Content-Type": "application/json" };

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Gate: service_role only (role claim, with exact-match fallback).
  const bearer = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  let bearerRole: string | null = null;
  try {
    bearerRole = JSON.parse(atob(bearer.split(".")[1] ?? "")).role ?? null;
  } catch {
    bearerRole = null;
  }
  if (bearerRole !== "service_role" && bearer !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: jsonHeaders });
  }

  const reductoKey = Deno.env.get("REDUCTO_API_KEY");
  if (!reductoKey) {
    return new Response(JSON.stringify({ error: "REDUCTO_API_KEY not configured" }), { status: 500, headers: jsonHeaders });
  }

  let body: { pdf_base64?: unknown; user_id?: unknown; title?: unknown; filename?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), { status: 400, headers: jsonHeaders });
  }
  const pdfB64 = typeof body.pdf_base64 === "string" ? body.pdf_base64 : null;
  const userId = typeof body.user_id === "string" ? body.user_id : null;
  const title = typeof body.title === "string" ? body.title : "Protocol";
  const filename = typeof body.filename === "string" ? body.filename : null;
  if (!pdfB64 || !userId) {
    return new Response(JSON.stringify({ error: "pdf_base64 and user_id required" }), { status: 400, headers: jsonHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // Decode base64 → bytes.
  const binaryStr = atob(pdfB64);
  const pdfBytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) pdfBytes[i] = binaryStr.charCodeAt(i);

  const contentHash = await sha256Hex(pdfBytes);

  const { data: doc, error: docError } = await supabase
    .from("documents")
    .insert({
      title,
      source: "Protocol upload (admin-ingest)",
      filename,
      user_id: userId,
      content_hash: contentHash,
    })
    .select("id")
    .single();
  if (docError) {
    return new Response(JSON.stringify({ error: "doc insert failed", detail: docError.message }), { status: 500, headers: jsonHeaders });
  }
  const docId = doc.id as string;

  // Storage (best-effort — SOTR cited-page rendering).
  try {
    const pathToWrite = `${userId}/${docId}.pdf`;
    const { error: upErr } = await supabase.storage
      .from("protocol-pdfs")
      .upload(pathToWrite, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (!upErr) {
      await supabase.from("documents").update({ storage_path: pathToWrite }).eq("id", docId);
    }
  } catch {
    // ignore — storage failure shouldn't abort the ingest
  }

  // Reducto submit.
  let reductoJobId: string;
  try {
    const fileId = await uploadToReducto(pdfBytes, reductoKey);
    reductoJobId = await kickOffReductoParseAsync(fileId, reductoKey);
  } catch (e) {
    await supabase
      .from("documents")
      .update({ status: "failed", error_message: e instanceof Error ? e.message : String(e) })
      .eq("id", docId);
    return new Response(
      JSON.stringify({ error: "reducto submit failed", detail: e instanceof Error ? e.message : String(e), document_id: docId }),
      { status: 502, headers: jsonHeaders },
    );
  }

  await supabase.from("documents").update({ reducto_job_id: reductoJobId }).eq("id", docId);

  return new Response(
    JSON.stringify({ ok: true, document_id: docId, reducto_job_id: reductoJobId, status: "pending" }),
    { status: 200, headers: jsonHeaders },
  );
});
