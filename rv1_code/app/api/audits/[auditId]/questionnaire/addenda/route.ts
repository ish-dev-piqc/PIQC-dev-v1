// POST /api/audits/[auditId]/questionnaire/addenda
//      Generate section 5.3.x addendum questions from VendorServiceMappingObject entries.
//      Set replaceExisting=true to wipe and regenerate from scratch.

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { generateAddenda, getInstanceByAudit } from "@/lib/questionnaires";
import { GenerateAddendaSchema } from "@/lib/types/questionnaire";
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
      { error: "No questionnaire instance for this audit. POST to create one first." },
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
    input = GenerateAddendaSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  try {
    const result = await generateAddenda({ instanceId: instance.id, actorId: auth.userId, ...input });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to generate addenda" },
      { status: 400 }
    );
  }
}
