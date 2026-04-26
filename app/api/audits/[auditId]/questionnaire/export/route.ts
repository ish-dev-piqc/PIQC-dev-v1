// GET /api/audits/[auditId]/questionnaire/export
//     Returns the questionnaire as a markdown "first draft" suitable for
//     auditor polish in Word / Google Docs.
//
//     Returns 404 if no instance has been created for this audit yet.
//
//     Response format:
//       Content-Type: text/markdown; charset=utf-8
//       Content-Disposition: attachment; filename="questionnaire-draft.md"
//
//     Design notes:
//       - No auth gate in Phase 1 (actorId shim pending auth decision)
//       - Export is always available once an instance exists — no status gate.
//         Auditors export at any workflow stage (draft, in-progress, complete).
//         The export header shows the current status so the recipient knows
//         what state the document reflects.
//       - Sponsor-name-free: the serializer applies the no-branding rule;
//         auditors add sponsor name and header/footer styling externally.

import { NextRequest, NextResponse } from "next/server";
import {
  exportQuestionnaireMarkdown,
  getInstanceByAudit,
} from "@/lib/questionnaires";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ auditId: string }> }
) {
  const { auditId } = await params;

  const instance = await getInstanceByAudit(auditId);
  if (!instance) {
    return NextResponse.json(
      {
        error:
          "No questionnaire instance found for this audit. Initiate the questionnaire before exporting.",
      },
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
