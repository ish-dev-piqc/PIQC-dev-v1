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

function splitIntoChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];

  let i = 0;
  while (i < words.length) {
    const chunk = words.slice(i, i + CHUNK_SIZE).join(" ");
    if (chunk.trim()) chunks.push(chunk.trim());
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

async function embedText(text: string, apiKey: string): Promise<number[]> {
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
    throw new Error(`OpenAI embedding error: ${err}`);
  }

  const data = await res.json();
  return data.data[0].embedding as number[];
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

async function parsePdfWithReducto(fileId: string, reductoKey: string): Promise<string[]> {
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

  let chunks: string[] = [];

  if (data.result && Array.isArray(data.result.chunks)) {
    chunks = data.result.chunks
      .map((c: { content?: string; embed?: string }) => (c.embed || c.content || "").trim())
      .filter((c: string) => c.length > 0);
  } else if (data.url) {
    const urlRes = await fetch(data.url);
    const urlData = await urlRes.json();
    if (urlData.result && Array.isArray(urlData.result.chunks)) {
      chunks = urlData.result.chunks
        .map((c: { content?: string; embed?: string }) => (c.embed || c.content || "").trim())
        .filter((c: string) => c.length > 0);
    }
  }

  return chunks;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json();
    const { title, source, content, pdf_base64 } = body;

    let chunks: string[] = [];

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

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .insert({ title: title ?? "", source: source ?? "" })
      .select("id")
      .single();

    if (docError) throw docError;

    const batchSize = 20;
    let inserted = 0;

    for (let b = 0; b < chunks.length; b += batchSize) {
      const batch = chunks.slice(b, b + batchSize);

      const embeddings = await Promise.all(
        batch.map((chunk) => embedText(chunk, openaiKey))
      );

      const rows = batch.map((chunk, i) => ({
        document_id: doc.id,
        content: chunk,
        chunk_index: b + i,
        embedding: JSON.stringify(embeddings[i]),
      }));

      const { error: insertError } = await supabase.from("chunks").insert(rows);
      if (insertError) throw insertError;

      inserted += batch.length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        document_id: doc.id,
        chunks_created: inserted,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
