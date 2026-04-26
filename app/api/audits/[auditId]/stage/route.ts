// GET   /api/audits/[auditId]/stage
//       Returns the stage readout (current stage + position + gate state).
// PATCH /api/audits/[auditId]/stage
//       Transition to a new stage. Forward exactly +1; backward any distance.
//       Forward gate to PRE_AUDIT_DRAFTING requires both questionnaire and risk
//       summary approved — translates StageTransitionError.code to HTTP status.
//       Returns the post-transition StageReadout (not the raw Audit row) so
//       clients don't need a follow-up GET to recompute gate state.

import { NextRequest, NextResponse } from "next/server";
import {
  StageTransitionError,
  getStageReadout,
  transitionAuditStage,
} from "@/lib/audit-stage";
import { TransitionAuditStageSchema } from "@/lib/types/audit-stage";
import { parseJson, validationError } from "@/lib/api/json";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const readout = await getStageReadout(auditId);
  if (!readout) {
    return NextResponse.json({ error: "Audit not found" }, { status: 404 });
  }
  return NextResponse.json(readout);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = TransitionAuditStageSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await transitionAuditStage({
      auditId,
      ...parsed.data,
    });
    // Return the post-transition readout so the workspace shell can avoid a
    // follow-up GET. Cannot be null here — we just transitioned an existing
    // audit. Fail loud if the invariant is somehow violated.
    const readout = await getStageReadout(auditId);
    if (!readout) {
      return NextResponse.json(
        { error: "Audit disappeared mid-transition" },
        { status: 500 }
      );
    }
    return NextResponse.json(readout);
  } catch (err) {
    if (err instanceof StageTransitionError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: stageErrorStatus(err.code) }
      );
    }
    throw err;
  }
}

function stageErrorStatus(code: StageTransitionError["code"]): number {
  switch (code) {
    case "AUDIT_NOT_FOUND":
      return 404;
    case "INVALID_FORWARD_JUMP":
    case "ALREADY_AT_STAGE":
      return 400;
    case "GATE_QUESTIONNAIRE_NOT_APPROVED":
    case "GATE_RISK_SUMMARY_NOT_APPROVED":
    case "GATE_DELIVERABLES_NOT_APPROVED":
      return 409;
  }
}
