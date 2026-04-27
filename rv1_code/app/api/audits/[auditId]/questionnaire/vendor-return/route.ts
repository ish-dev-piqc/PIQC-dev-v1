// POST /api/audits/[auditId]/questionnaire/vendor-return
//      Bulk-ingest vendor's returned responses. source=VENDOR on each.
//      Instance transitions to VENDOR_RESPONDED.

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { captureVendorReturn, getInstanceByAudit } from "@/lib/questionnaires";
import { VendorReturnSchema } from "@/lib/types/questionnaire";
import { requireAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const instance = await getInstanceByAudit(auditId);
  if (!instance) {
    return NextResponse.json(
      { error: "No questionnaire instance for this audit." },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = VendorReturnSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  try {
    const updated = await captureVendorReturn({ instanceId: instance.id, actorId: auth.userId, ...input });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Vendor return ingestion failed" },
      { status: 400 }
    );
  }
}
