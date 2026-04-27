// PATCH /api/audits/[auditId]/workspace/[entryId]
//       Update observationText, provisionalImpact, provisionalClassification, or checkpointRef.

import { NextRequest, NextResponse } from "next/server";
import { updateWorkspaceEntry, WorkspaceEntryError } from "@/lib/workspace-entries";
import { UpdateWorkspaceEntrySchema } from "@/lib/types/workspace-entries";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string; entryId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { entryId } = await params;
  const body = await parseJson(req);
  if (body instanceof NextResponse) return body;

  const parsed = UpdateWorkspaceEntrySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const updated = await updateWorkspaceEntry(entryId, { ...parsed.data, actorId: auth.userId });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof WorkspaceEntryError && err.code === "ENTRY_NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update entry" },
      { status: 400 }
    );
  }
}
