// PATCH /api/audits/[auditId]/vendor-service/mappings/[id]
//       Auditor override of derived criticality and rationale. Delta-tracked.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { DerivedCriticality } from "@prisma/client";
import { updateServiceMapping } from "@/lib/vendor-services";
import { requireAuth } from "@/lib/auth";

const UpdateMappingSchema = z.object({
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
    input = UpdateMappingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const updated = await updateServiceMapping(id, { actorId: auth.userId, ...input });
  return NextResponse.json(updated);
}
