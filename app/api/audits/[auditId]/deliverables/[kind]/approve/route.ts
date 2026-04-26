// POST /api/audits/[auditId]/deliverables/[kind]/approve
//       Sets approvalStatus = APPROVED, stamps approvedAt/approvedBy.
//       Refused if content fails the per-kind validity check (e.g. empty body,
//       no items). Once all three deliverables for an audit are APPROVED,
//       the AUDIT_CONDUCT stage gate opens (lib/audit-stage.ts).
//
// Returns the RenderedDeliverable so the workspace can apply state without a
// follow-up GET.

import { NextRequest, NextResponse } from "next/server";
import { approveDeliverable, getRenderedDeliverable } from "@/lib/deliverables";
import { ApproveDeliverableSchema } from "@/lib/types/deliverables";
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

  const parsed = ApproveDeliverableSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await approveDeliverable({
      auditId,
      kind,
      actorId: parsed.data.actorId,
    });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered);
  } catch (err) {
    return translateDeliverableError(err, "Failed to approve");
  }
}
