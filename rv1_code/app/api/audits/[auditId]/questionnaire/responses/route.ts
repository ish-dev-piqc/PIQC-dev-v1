// PATCH /api/audits/[auditId]/questionnaire/responses
//       Capture or update a single response. Body: questionId + source + optional fields.

import { NextRequest, NextResponse } from "next/server";
import { captureResponse, getInstanceByAudit } from "@/lib/questionnaires";
import { ResponseCaptureSchema } from "@/lib/types/questionnaire";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

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
      actorId: auth.userId,
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
