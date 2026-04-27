// PATCH /api/protocols/[protocolVersionId]/risk-objects/[id]
//       Updates a ProtocolRiskObject. Only changed fields are written.
//       Writes a StateHistoryDelta in the same transaction.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { updateRiskObject } from "@/lib/risk-objects";
import { requireAuth } from "@/lib/auth";

const UpdateRiskObjectSchema = z.object({
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
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const updated = await updateRiskObject(id, { actorId: auth.userId, ...input });
  return NextResponse.json(updated);
}
