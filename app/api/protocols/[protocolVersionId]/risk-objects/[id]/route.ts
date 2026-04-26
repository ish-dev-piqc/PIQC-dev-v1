// PATCH /api/protocols/[protocolVersionId]/risk-objects/[id]
//
// Updates a ProtocolRiskObject. Only changed fields are written.
// Writes a StateHistoryDelta recording before/after in the same transaction.
// Used when an auditor revisits and edits a previously tagged section.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { updateRiskObject } from "@/lib/risk-objects";

const UpdateRiskObjectSchema = z.object({
  actorId: z.string().uuid(),
  reason: z.string().optional(),
  values: z
    .object({
      endpointTier: z.enum(["PRIMARY", "SECONDARY", "SAFETY", "SUPPORTIVE"]).optional(),
      impactSurface: z.enum(["DATA_INTEGRITY", "PATIENT_SAFETY", "BOTH"]).optional(),
      timeSensitivity: z.boolean().optional(),
      vendorDependencyFlags: z.array(z.string()).min(1).optional(),
      operationalDomainTag: z.string().min(1).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "At least one field must be provided",
    }),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ protocolVersionId: string; id: string }> }
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
    input = UpdateRiskObjectSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 422 }
      );
    }
    throw err;
  }

  const updated = await updateRiskObject(id, input);

  return NextResponse.json(updated);
}
