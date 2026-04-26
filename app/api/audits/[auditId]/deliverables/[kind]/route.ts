// GET   /api/audits/[auditId]/deliverables/[kind]
//       Fetch the rendered deliverable. Returns 204 if not yet created.
// POST  /api/audits/[auditId]/deliverables/[kind]
//       Idempotently create the deterministic stub. Body: { actorId }.
//       Returns the RenderedDeliverable (not the raw row) so the workspace
//       can apply state directly without a follow-up GET.
// PATCH /api/audits/[auditId]/deliverables/[kind]
//       Edit the content. APPROVED deliverable returns to DRAFT.
//       Returns the RenderedDeliverable (same reason as POST).
//
// `kind` URL segment must be one of: confirmationLetter | agenda | checklist.

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
  const { auditId, kind: rawKind } = await params;
  const kind = parseKindOrError(rawKind);
  if (kind instanceof NextResponse) return kind;

  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = CreateDeliverableStubSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await createDeliverableStub({
      auditId,
      kind,
      actorId: parsed.data.actorId,
    });
    // Return the rendered shape so the workspace can apply state directly —
    // no follow-up GET needed. Cannot be null (we just created it).
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered, { status: 201 });
  } catch (err) {
    return translateDeliverableError(err, "Failed to create stub");
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
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
      actorId: parsed.data.actorId,
      // Library performs the per-kind content shape validation; the route
      // only validates the envelope (actorId + content presence).
      content: parsed.data.content as never,
    });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered);
  } catch (err) {
    return translateDeliverableError(err, "Failed to update deliverable");
  }
}
