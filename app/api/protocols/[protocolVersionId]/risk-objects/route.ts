// GET  /api/protocols/[protocolVersionId]/risk-objects
//   Returns all tagged ProtocolRiskObjects for this version.
//   Used by the tagging page to show which sections are done.
//
// POST /api/protocols/[protocolVersionId]/risk-objects
//   Creates a new ProtocolRiskObject from auditor-confirmed form values.
//   Writes a StateHistoryDelta in the same transaction.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { TaggingMode } from "@prisma/client";
import { createRiskObject, getRiskObjectsByVersion } from "@/lib/risk-objects";

const CreateRiskObjectSchema = z.object({
  sectionIdentifier: z.string().min(1),
  sectionTitle: z.string().min(1),
  taggedBy: z.string().uuid(),
  taggingMode: z.nativeEnum(TaggingMode).default("MANUAL"),
  values: z.object({
    endpointTier: z.enum(["PRIMARY", "SECONDARY", "SAFETY", "SUPPORTIVE"]),
    impactSurface: z.enum(["DATA_INTEGRITY", "PATIENT_SAFETY", "BOTH"]),
    timeSensitivity: z.boolean(),
    vendorDependencyFlags: z.array(z.string()).min(1),
    operationalDomainTag: z.string().min(1),
  }),
  // suggestions is optional — absent in Phase 1 manual mode
  suggestions: z
    .object({
      endpointTier: z
        .object({ suggested: z.enum(["PRIMARY", "SECONDARY", "SAFETY", "SUPPORTIVE"]), source: z.enum(["piqc", "llm"]), confidence: z.number().optional() })
        .optional(),
      impactSurface: z
        .object({ suggested: z.enum(["DATA_INTEGRITY", "PATIENT_SAFETY", "BOTH"]), source: z.enum(["piqc", "llm"]), confidence: z.number().optional() })
        .optional(),
      timeSensitivity: z
        .object({ suggested: z.boolean(), source: z.enum(["piqc", "llm"]), confidence: z.number().optional() })
        .optional(),
      vendorDependencyFlags: z
        .object({ suggested: z.array(z.string()), source: z.enum(["piqc", "llm"]), confidence: z.number().optional() })
        .optional(),
      operationalDomainTag: z
        .object({ suggested: z.string(), source: z.enum(["piqc", "llm"]), confidence: z.number().optional() })
        .optional(),
    })
    .optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ protocolVersionId: string }> }
) {
  const { protocolVersionId } = await params;
  const tagged = await getRiskObjectsByVersion(protocolVersionId);
  return NextResponse.json(Object.fromEntries(tagged));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ protocolVersionId: string }> }
) {
  const { protocolVersionId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = CreateRiskObjectSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 422 }
      );
    }
    throw err;
  }

  const riskObject = await createRiskObject(protocolVersionId, input);

  return NextResponse.json(riskObject, { status: 201 });
}
