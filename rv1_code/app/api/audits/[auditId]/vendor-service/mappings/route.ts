// POST /api/audits/[auditId]/vendor-service/mappings
//      Links VendorServiceObject to a ProtocolRiskObject.
//      Criticality derived automatically from the risk object's fields.

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { createServiceMapping } from "@/lib/vendor-services";
import { requireAuth } from "@/lib/auth";

const CreateMappingSchema = z.object({
  protocolRiskId: z.string().uuid(),
  criticalityRationale: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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

  const mapping = await createServiceMapping(service.id, input, auth.userId);
  return NextResponse.json(mapping, { status: 201 });
}
