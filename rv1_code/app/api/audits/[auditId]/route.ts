// GET /api/audits/[auditId] — fetch audit with full context

import { NextRequest, NextResponse } from "next/server";
import { getAudit } from "@/lib/audits";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const audit = await getAudit(auditId);
  return NextResponse.json(audit);
}
