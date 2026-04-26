// POST /api/audits/[auditId]/workspace/[entryId]/confirm-risk
//      Auditor explicitly re-confirms an entry whose linked risk object was
//      modified by a protocol amendment. Clears riskContextOutdated flag.

import { NextRequest, NextResponse } from "next/server";
import { confirmRiskContext, WorkspaceEntryError } from "@/lib/workspace-entries";
import { ConfirmRiskContextSchema } from "@/lib/types/workspace-entries";
import { parseJson, validationError } from "@/lib/api/json";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; entryId: string }> }
) {
  const { entryId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = ConfirmRiskContextSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const updated = await confirmRiskContext(entryId, parsed.data);
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
