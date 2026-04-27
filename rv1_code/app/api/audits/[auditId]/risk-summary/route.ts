// GET   /api/audits/[auditId]/risk-summary
// POST  /api/audits/[auditId]/risk-summary — idempotently create deterministic stub
// PATCH /api/audits/[auditId]/risk-summary — edit narrative/focus areas; APPROVED → DRAFT

import { NextRequest, NextResponse } from "next/server";
import {
  createRiskSummaryStub,
  getRenderedRiskSummary,
  updateRiskSummary,
} from "@/lib/risk-summary";
import {
  CreateRiskSummaryStubSchema,
  UpdateRiskSummarySchema,
} from "@/lib/types/risk-summary";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const rendered = await getRenderedRiskSummary(auditId);
  if (!rendered) return new NextResponse(null, { status: 204 });
  return NextResponse.json(rendered);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = CreateRiskSummaryStubSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const created = await createRiskSummaryStub({ auditId, actorId: auth.userId });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create stub" },
      { status: 400 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateRiskSummarySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const updated = await updateRiskSummary({ auditId, actorId: auth.userId, ...parsed.data });
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update" },
      { status: 400 }
    );
  }
}
