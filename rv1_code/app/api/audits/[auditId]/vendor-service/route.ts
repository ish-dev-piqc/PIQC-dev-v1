// GET  /api/audits/[auditId]/vendor-service — fetch service + all mappings
// POST /api/audits/[auditId]/vendor-service — create VendorServiceObject

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { createVendorService, getVendorServiceWithMappings } from "@/lib/vendor-services";
import { requireAuth } from "@/lib/auth";

const CreateVendorServiceSchema = z.object({
  serviceName: z.string().min(1),
  serviceType: z.string().min(1),
  serviceDescription: z.string().optional(),
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
    input = CreateVendorServiceSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const service = await createVendorService(auditId, input, auth.userId);
  return NextResponse.json(service, { status: 201 });
}
