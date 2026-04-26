// PATCH /api/audits/[auditId]/vendor-service/mappings/[id]
// Allows auditor to override derived criticality and edit rationale.
// All changes written to StateHistoryDelta.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { DerivedCriticality } from "@prisma/client";
import { updateServiceMapping } from "@/lib/vendor-services";

const UpdateMappingSchema = z.object({
  actorId: z.string().uuid(),
  reason: z.string().optional(),
  derivedCriticality: z.nativeEnum(DerivedCriticality).optional(),
  criticalityRationale: z.string().min(1).optional(),
}).refine(
  (v) => v.derivedCriticality !== undefined || v.criticalityRationale !== undefined,
  { message: "At least one of derivedCriticality or criticalityRationale must be provided" }
);

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; id: string }> }
) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = UpdateMappingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const updated = await updateServiceMapping(id, input);
  return NextResponse.json(updated);
}
