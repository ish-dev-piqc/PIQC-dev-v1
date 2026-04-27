// POST /api/audits/[auditId]/questionnaire/approve
//      Sets QuestionnaireInstance.approvedAt/approvedBy.
//      Refused unless status is COMPLETE.

import { NextRequest, NextResponse } from "next/server";
import { approveQuestionnaireInstance } from "@/lib/questionnaires";
import { parseJson } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  // Body is empty for this endpoint — actorId comes from session
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  try {
    const approved = await approveQuestionnaireInstance({ auditId, actorId: auth.userId });
    return NextResponse.json(approved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to approve" },
      { status: 400 }
    );
  }
}
