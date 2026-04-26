// PATCH /api/audits/[auditId]/questionnaire/status
//       Transition the QuestionnaireInstance status. Linear lifecycle is
//       enforced server-side (lib/questionnaires.ts → ALLOWED_TRANSITIONS).

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  getInstanceByAudit,
  transitionInstanceStatus,
} from "@/lib/questionnaires";
import { InstanceStatusTransitionSchema } from "@/lib/types/questionnaire";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
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
    input = InstanceStatusTransitionSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 422 }
      );
    }
    throw err;
  }

  try {
    const updated = await transitionInstanceStatus({
      instanceId: instance.id,
      ...input,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Status transition failed" },
      { status: 400 }
    );
  }
}
