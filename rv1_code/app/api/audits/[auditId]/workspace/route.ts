// GET  /api/audits/[auditId]/workspace — list all entries, ordered by createdAt asc
// POST /api/audits/[auditId]/workspace — create entry; inherits risk attrs if protocolRiskId supplied

import { NextRequest, NextResponse } from "next/server";
import { createWorkspaceEntry, listWorkspaceEntries, WorkspaceEntryError } from "@/lib/workspace-entries";
import { CreateWorkspaceEntrySchema } from "@/lib/types/workspace-entries";
import { parseJson, validationError } from "@/lib/api/json";
import { requireAuth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const entries = await listWorkspaceEntries(auditId);
  return NextResponse.json(entries);
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

  const parsed = CreateWorkspaceEntrySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  try {
    const entry = await createWorkspaceEntry(auditId, { ...parsed.data, actorId: auth.userId });
    return NextResponse.json(entry, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceEntryError && err.code === "AUDIT_NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof WorkspaceEntryError && err.code === "RISK_OBJECT_NOT_FOUND") {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create entry" },
      { status: 400 }
    );
  }
}
