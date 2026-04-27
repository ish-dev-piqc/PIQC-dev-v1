// POST /api/audits/[auditId]/workspace/[entryId]/confirm-risk
//      Auditor re-confirms an entry whose linked risk object was amended.
//      Clears riskContextOutdated flag.

import { NextRequest, NextResponse } from "next/server";
import { confirmRiskContext, WorkspaceEntryError } from "@/lib/workspace-entries";
import { ConfirmRiskContextSchema } from "@/lib/types/workspace-entries";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; entryId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { entryId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ConfirmRiskContextSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const updated = await confirmRiskContext(entryId, { actorId: auth.userId });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof WorkspaceEntryError && err.code === "ENTRY_NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to confirm risk context" },
      { status: 400 }
    );
  }
}
