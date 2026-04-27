// GET  /api/audits/[auditId]/questionnaire
//      Fetch the rendered questionnaire (instance + all questions + responses).
//      Returns 204 if no instance has been created yet.
// POST /api/audits/[auditId]/questionnaire
//      Create a QuestionnaireInstance for this audit (1:1).

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  createQuestionnaireInstance,
  getInstanceByAudit,
  getRenderedQuestionnaire,
} from "@/lib/questionnaires";
import { CreateQuestionnaireInstanceSchema } from "@/lib/types/questionnaire";
import { requireAuth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const instance = await getInstanceByAudit(auditId);
  if (!instance) return new NextResponse(null, { status: 204 });
  const rendered = await getRenderedQuestionnaire(instance.id);
  return NextResponse.json(rendered);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const existing = await getInstanceByAudit(auditId);
  if (existing) {
    return NextResponse.json(
      { error: "QuestionnaireInstance already exists for this audit. Phase 1 supports one instance per audit." },
      { status: 409 }
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
    input = CreateQuestionnaireInstanceSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  try {
    const instance = await createQuestionnaireInstance({ auditId, actorId: auth.userId, ...input });
    return NextResponse.json(instance, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create instance" },
      { status: 400 }
    );
  }
}
