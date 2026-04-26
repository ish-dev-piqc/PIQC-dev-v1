// GET  /api/audits/[auditId]/vendor-service — fetch service + all mappings
// POST /api/audits/[auditId]/vendor-service — create VendorServiceObject

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createVendorService, getVendorServiceWithMappings } from "@/lib/vendor-services";

const CreateVendorServiceSchema = z.object({
  serviceName: z.string().min(1),
  serviceType: z.string().min(1),
  serviceDescription: z.string().optional(),
  actorId: z.string().uuid(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const service = await getVendorServiceWithMappings(auditId);
  if (!service) return new NextResponse(null, { status: 204 });
  return NextResponse.json(service);
}

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
    input = CreateVendorServiceSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const { actorId, ...serviceInput } = input;
  const service = await createVendorService(auditId, serviceInput, actorId);
  return NextResponse.json(service, { status: 201 });
}
