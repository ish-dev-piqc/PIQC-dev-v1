// POST /api/audits — create a new Audit

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { AuditType } from "@prisma/client";
import { createAudit } from "@/lib/audits";

const CreateAuditSchema = z.object({
  vendorId: z.string().uuid(),
  protocolVersionId: z.string().uuid(),
  auditName: z.string().min(1),
  auditType: z.nativeEnum(AuditType),
  leadAuditorId: z.string().uuid(),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try {
    input = CreateAuditSchema.parse(body);
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    }
    throw err;
  }

  const audit = await createAudit(input);
  return NextResponse.json(audit, { status: 201 });
}
