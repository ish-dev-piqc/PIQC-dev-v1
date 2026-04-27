// GET   /api/audits/[auditId]/deliverables/[kind]
// POST  /api/audits/[auditId]/deliverables/[kind] — create deterministic stub
// PATCH /api/audits/[auditId]/deliverables/[kind] — edit content; APPROVED → DRAFT
//
// `kind` must be one of: confirmationLetter | agenda | checklist

import { NextRequest, NextResponse } from "next/server";
import {
  createDeliverableStub,
  getRenderedDeliverable,
  updateDeliverable,
} from "@/lib/deliverables";
import {
  CreateDeliverableStubSchema,
  UpdateDeliverableBodySchema,
} from "@/lib/types/deliverables";
import { parseJson, validationError } from "@/lib/api/json";
import { parseKindOrError, translateDeliverableError } from "./_helpers";
import { requireAuth } from "@/lib/auth";

interface Params {
  params: Promise<{ auditId: string; kind: string }>;
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { auditId, kind: rawKind } = await params;
  const kind = parseKindOrError(rawKind);
  if (kind instanceof NextResponse) return kind;

  const rendered = await getRenderedDeliverable(auditId, kind);
  if (!rendered) return new NextResponse(null, { status: 204 });
  return NextResponse.json(rendered);
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId, kind: rawKind } = await params;
  const kind = parseKindOrError(rawKind);
  if (kind instanceof NextResponse) return kind;

  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = CreateDeliverableStubSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await createDeliverableStub({ auditId, kind, actorId: auth.userId });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered, { status: 201 });
  } catch (err) {
    return translateDeliverableError(err, "Failed to create stub");
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId, kind: rawKind } = await params;
  const kind = parseKindOrError(rawKind);
  if (kind instanceof NextResponse) return kind;

  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateDeliverableBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await updateDeliverable({
      auditId,
      kind,
      actorId: auth.userId,
      content: parsed.data.content as never,
    });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered);
  } catch (err) {
    return translateDeliverableError(err, "Failed to update deliverable");
  }
}
