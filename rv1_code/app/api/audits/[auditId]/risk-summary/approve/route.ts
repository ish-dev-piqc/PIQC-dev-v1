// POST /api/audits/[auditId]/risk-summary/approve
//      Sets approvalStatus = APPROVED, stamps approvedAt/approvedBy.
//      Refused if narrative is empty.

import { NextRequest, NextResponse } from "next/server";
import { approveRiskSummary } from "@/lib/risk-summary";
import { ApproveRiskSummarySchema } from "@/lib/types/risk-summary";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ApproveRiskSummarySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const approved = await approveRiskSummary({ auditId, actorId: auth.userId });
    return NextResponse.json(approved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to approve" },
      { status: 400 }
    );
  }
}
