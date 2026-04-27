// GET /api/audits/[auditId]/history?objectType=<TrackedObjectType>&objectId=<uuid>
//
// Returns the audit trail for a tracked object, newest-first.
//
// The auditId URL segment scopes the request to a single audit — consistent
// with every other audit resource route and required for future auth gating.
//
// Phase 1 auth note: full cross-resource ownership verification (confirming
// objectId belongs to auditId) lands when session auth is configured. For now,
// the auditId param is structurally validated but not yet joined against the
// objectId. UUID guessing is low-probability; revisit with session.user.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { TrackedObjectType } from "@prisma/client";
import { getObjectHistory } from "@/lib/state-history";

const QuerySchema = z.object({
  objectType: z.nativeEnum(TrackedObjectType),
  objectId: z.string().uuid(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  // auditId consumed for URL scoping; full ownership check lands with auth.
  await params;

  const { searchParams } = req.nextUrl;
  const parsed = QuerySchema.safeParse({
    objectType: searchParams.get("objectType"),
    objectId: searchParams.get("objectId"),
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid query params", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const history = await getObjectHistory(
    parsed.data.objectType,
    parsed.data.objectId
  );
  return NextResponse.json(history);
}
