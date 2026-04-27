// POST /api/protocols/ingest
//
// Called by PIQC when a new protocol version is ready for Vendor PIQC.
// Validates the payload, creates Protocol + ProtocolVersion, and triggers
// amendment alerts for any active Audits on the previous version.
//
// [PIQC] D-009: when the API contract is finalized, the payload shape may change.
// Update PiqcIngestPayloadSchema in lib/types/piqc.ts and re-validate field names.
//
// Auth: this endpoint is internal (PIQC → Vendor PIQC). A shared secret or
// service-to-service token must be added before production.
// Dev team note: add bearer token validation here when auth is configured.

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { PiqcIngestPayloadSchema } from "@/lib/types/piqc";
import { ingestProtocolVersion } from "@/lib/protocol-versions";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let payload;
  try {
    payload = PiqcIngestPayloadSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid payload", issues: err.issues },
        { status: 422 }
      );
    }
    throw err;
  }

  const { protocol, protocolVersion } = await ingestProtocolVersion(payload);

  return NextResponse.json(
    {
      protocolId: protocol.id,
      protocolVersionId: protocolVersion.id,
      versionNumber: protocolVersion.versionNumber,
      status: protocolVersion.status,
    },
    { status: 201 }
  );
}
