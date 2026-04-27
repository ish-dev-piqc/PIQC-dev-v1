// GET   /api/audits/[auditId]/trust-assessment
// POST  /api/audits/[auditId]/trust-assessment — create assessment (first save)
// PATCH /api/audits/[auditId]/trust-assessment — update assessment (subsequent edits)

import { NextRequest, NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { CompliancePosture, MaturityPosture, TrustPosture } from "@prisma/client";
import { createTrustAssessment, getTrustAssessment, updateTrustAssessment } from "@/lib/trust-assessments";
import { requireAuth } from "@/lib/auth";

const PostureFields = {
  // [D-005 PLACEHOLDER] qualitative labels — may change when D-005 is decided
  compliancePosture:       z.nativeEnum(CompliancePosture),
  maturityPosture:         z.nativeEnum(MaturityPosture),
  provisionalTrustPosture: z.nativeEnum(TrustPosture),
};

const CreateSchema = z.object({
  certificationsClaimed:   z.array(z.string()),
  regulatoryClaims:        z.array(z.string()),
  riskHypotheses:          z.array(z.string().min(1)),
  notes:                   z.string().optional(),
  ...PostureFields,
});

const UpdateSchema = z.object({
  reason:  z.string().optional(),
  values: z
    .object({
      certificationsClaimed:   z.array(z.string()).optional(),
      regulatoryClaims:        z.array(z.string()).optional(),
      riskHypotheses:          z.array(z.string().min(1)).optional(),
      notes:                   z.string().optional(),
      compliancePosture:       z.nativeEnum(CompliancePosture).optional(),
      maturityPosture:         z.nativeEnum(MaturityPosture).optional(),
      provisionalTrustPosture: z.nativeEnum(TrustPosture).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, {
      message: "At least one field must be provided",
    }),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;
  const assessment = await getTrustAssessment(auditId);
  if (!assessment) return new NextResponse(null, { status: 204 });
  return NextResponse.json(assessment);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const existing = await getTrustAssessment(auditId);
  if (existing) {
    return NextResponse.json(
      { error: "Trust assessment already exists for this audit. Use PATCH to update." },
      { status: 409 }
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try { input = CreateSchema.parse(body); } catch (err) {
    if (err instanceof ZodError)
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    throw err;
  }

  // assessedBy is the authenticated auditor
  const assessment = await createTrustAssessment(auditId, { assessedBy: auth.userId, ...input });
  return NextResponse.json(assessment, { status: 201 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const existing = await getTrustAssessment(auditId);
  if (!existing) {
    return NextResponse.json(
      { error: "No trust assessment found. Use POST to create one first." },
      { status: 404 }
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let input;
  try { input = UpdateSchema.parse(body); } catch (err) {
    if (err instanceof ZodError)
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 422 });
    throw err;
  }

  const updated = await updateTrustAssessment(existing.id, { actorId: auth.userId, ...input });
  return NextResponse.json(updated);
}
