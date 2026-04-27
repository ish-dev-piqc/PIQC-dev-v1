// GET /api/audits/[auditId]/questionnaire/export
//     Returns the questionnaire as a markdown "first draft" for auditor polish.
//     Sponsor-name-free — auditors add branding externally.

import { NextRequest, NextResponse } from "next/server";
import { exportQuestionnaireMarkdown, getInstanceByAudit } from "@/lib/questionnaires";
import { requireAuth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const { auditId } = await params;
  const instance = await getInstanceByAudit(auditId);
  if (!instance) {
    return NextResponse.json(
      { error: "No questionnaire instance found for this audit. Initiate the questionnaire before exporting." },
      { status: 404 }
    );
  }

  const markdown = await exportQuestionnaireMarkdown(instance.id);

  return new NextResponse(markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": 'attachment; filename="questionnaire-draft.md"',
    },
  });
}
