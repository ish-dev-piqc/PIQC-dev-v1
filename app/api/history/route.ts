// DEPRECATED — use /api/audits/[auditId]/history instead.
//
// This route existed at the global scope, which meant any caller with a valid
// objectId UUID could read any object's history across all audits — a GxP
// confidentiality gap. Moved to the audit-scoped URL so it inherits the same
// auth middleware that will gate all /api/audits/[auditId]/* routes.
//
// All internal consumers (HistoryDrawer) have been updated to use the new URL.
// This file returns 410 Gone so any stale client gets a clear signal.

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "This endpoint has moved. Use /api/audits/[auditId]/history?objectType=X&objectId=Y instead.",
    },
    { status: 410 }
  );
}
