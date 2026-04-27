// POST /api/audits/[auditId]/deliverables/[kind]/approve
//      Sets approvalStatus = APPROVED, stamps approvedAt/approvedBy.
//      Refused if content fails per-kind validity check.

import { NextRequest, NextResponse } from "next/server";
import { approveDeliverable, getRenderedDeliverable } from "@/lib/deliverables";
import { ApproveDeliverableSchema } from "@/lib/types/deliverables";
import { parseJson, validationError } from "@/lib/api/json";
import { parseKindOrError, translateDeliverableError } from "../_helpers";
import { requireAuth } from "@/lib/auth";

interface Params {
  params: Promise<{ auditId: string; kind: string }>;
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId, kind: rawKind } = await params;
  const kind = parseKindOrError(rawKind);
  if (kind instanceof NextResponse) return kind;

  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ApproveDeliverableSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    await approveDeliverable({ auditId, kind, actorId: auth.userId });
    const rendered = await getRenderedDeliverable(auditId, kind);
    return NextResponse.json(rendered);
  } catch (err) {
    return translateDeliverableError(err, "Failed to approve");
  }
}
