// POST /api/audits/[auditId]/questionnaire/approve
//       Sets QuestionnaireInstance.approvedAt/approvedBy.
//       Refused unless status is COMPLETE. Distinct gate from COMPLETE status —
//       downstream drafting consumes only approved artifacts.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { approveQuestionnaireInstance } from "@/lib/questionnaires";
import { parseJson, validationError } from "@/lib/api/json";

const ApproveSchema = z.object({
  actorId: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ApproveSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const approved = await approveQuestionnaireInstance({
      auditId,
      actorId: parsed.data.actorId,
    });
    return NextResponse.json(approved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to approve" },
      { status: 400 }
    );
  }
}
