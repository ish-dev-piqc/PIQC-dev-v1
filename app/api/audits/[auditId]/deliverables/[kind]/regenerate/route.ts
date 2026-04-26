// POST /api/audits/[auditId]/deliverables/[kind]/regenerate
//       Replace the deliverable's content with a freshly composed stub from
//       upstream context (Audit + approved risk summary). Destructive: any
//       in-progress edits are overwritten. APPROVED deliverables are demoted
//       to DRAFT (re-approval required) — same invariant as PATCH.
//
//       Returns the RenderedDeliverable so the workspace can apply state
//       without a follow-up GET.

import { NextRequest, NextResponse } from "next/server";
import { getRenderedDeliverable, regenerateDeliverable } from "@/lib/deliverables";
import { CreateDeliverableStubSchema } from "@/lib/types/deliverables";
import { parseJson, validationError } from "@/lib/api/json";
import { parseKindOrError, translateDeliverableError } from "../_helpers";

interface Params {
  params: Promise<{ auditId: string; kind: string }>;
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
    await regenerateDeliverable({
      auditId,
      kind,
      actorId: parsed.data.actorId,
    });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered);
  } catch (err) {
    return translateDeliverableError(err, "Failed to regenerate");
  }
}
