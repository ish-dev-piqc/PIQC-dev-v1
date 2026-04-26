// =============================================================================
// Shared helpers for deliverable routes
//
// Hoisted out so the main `[kind]/route.ts` and `[kind]/approve/route.ts`
// files use the same kind-parsing + DeliverableError → HTTP status mapping.
// =============================================================================

import { NextResponse } from "next/server";
import { DeliverableError } from "@/lib/deliverables";
import { DeliverableKind, DeliverableKindSchema } from "@/lib/types/deliverables";

// Validates the [kind] URL segment. Returns the typed kind or a 404 response.
export function parseKindOrError(raw: string): DeliverableKind | NextResponse {
  const result = DeliverableKindSchema.safeParse(raw);
  if (!result.success) {
    return NextResponse.json(
      { error: `Unknown deliverable kind: ${raw}. Expected one of confirmationLetter, agenda, checklist.` },
      { status: 404 }
    );
  }
  return result.data;
}

// Translates a DeliverableError (or any thrown value) into a JSON response
// with the right HTTP status. INVALID_CONTENT_SHAPE forwards the Zod issues
// in the body so the auditor can see which field is wrong.
export function translateDeliverableError(err: unknown, fallback: string): NextResponse {
  if (err instanceof DeliverableError) {
    return NextResponse.json(
      { error: err.message, code: err.code, issues: err.issues },
      { status: httpStatusForCode(err.code) }
    );
  }
  return NextResponse.json(
    { error: err instanceof Error ? err.message : fallback },
    { status: 400 }
  );
}

function httpStatusForCode(code: DeliverableError["code"]): number {
  switch (code) {
    case "AUDIT_NOT_FOUND":
    case "DELIVERABLE_NOT_FOUND":
      return 404;
    case "ALREADY_EXISTS":
      return 409;
    case "INVALID_FOR_APPROVAL":
    case "INVALID_CONTENT_SHAPE":
      return 422;
  }
}
