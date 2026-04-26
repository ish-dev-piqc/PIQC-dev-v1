// POST /api/audits/[auditId]/vendor-service/mappings
// Links the audit's VendorServiceObject to a ProtocolRiskObject.
// Criticality is derived automatically from the risk object's fields.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { createServiceMapping } from "@/lib/vendor-services";

const CreateMappingSchema = z.object({
  protocolRiskId: z.string().uuid(),
  criticalityRationale: z.string().optional(),
  actorId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = CreateMappingSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const service = await prisma.vendorServiceObject.findUnique({
    where: { auditId },
    select: { id: true },
  });

  if (!service) {
    return NextResponse.json(
      { error: "No VendorServiceObject found for this audit. Create the service first." },
      { status: 409 }
    );
  }

  const { actorId, ...mappingInput } = input;
  const mapping = await createServiceMapping(service.id, mappingInput, actorId);
  return NextResponse.json(mapping, { status: 201 });
}
