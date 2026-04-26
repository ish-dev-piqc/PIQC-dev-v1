// PATCH /api/audits/[auditId]/questionnaire/responses
//       Capture or update a single response. Used for auditor pre-fill and
//       one-by-one edits. Body must include questionId + source + actorId.

import { NextRequest, NextResponse } from "next/server";
import { captureResponse, getInstanceByAudit } from "@/lib/questionnaires";
import { ResponseCaptureSchema } from "@/lib/types/questionnaire";
import { parseJson, validationError } from "@/lib/api/json";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const instance = await getInstanceByAudit(auditId);
  if (!instance) {
    return NextResponse.json(
      { error: "No questionnaire instance for this audit. POST to create one first." },
      { status: 404 }
    );
  }

  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ResponseCaptureSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const updated = await captureResponse({
      instanceId: instance.id,
      ...parsed.data,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to capture response" },
      { status: 400 }
    );
  }
}
