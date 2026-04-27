// =============================================================================
// API helpers — request body parsing + validation error response
//
// Hoisted out of individual route handlers so all D-010+ routes share one
// parse/validate pipeline. Adding a new route means: parseJson → safeParse →
// call lib → translate library errors. No duplicated try/catch.
// =============================================================================

import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";

// Returns the parsed body, or a 400 response if the body is not valid JSON.
// Callers should: `const body = await parseJson(req); if (body instanceof NextResponse) return body;`
export async function parseJson(req: NextRequest): Promise<unknown | NextResponse> {
  try {
    return await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

// Casts a Prisma Json column value to string[] with a runtime element check.
// Prisma types Json fields as `Prisma.JsonValue`; at the page boundary we
// know the column was written as string[] but TypeScript doesn't. This guard
// surfaces corrupt data loudly instead of passing it downstream silently.
//
// Usage: parseJsonStringArray(row.vendorDependencyFlags, "vendorDependencyFlags")
export function parseJsonStringArray(value: unknown, field = "field"): string[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `Expected ${field} to be a JSON string array, received ${typeof value}`
    );
  }
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new Error(
        `Expected ${field}[${i}] to be a string, received ${typeof item}`
      );
    }
    return item;
  });
}

// Translates a Zod validation failure into a standard 422 response.
export function validationError(err: ZodError): NextResponse {
  return NextResponse.json(
    { error: "Validation failed", issues: err.issues },
    { status: 422 }
  );
}
