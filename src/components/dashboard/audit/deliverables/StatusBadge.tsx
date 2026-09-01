import { CheckCircle2 } from 'lucide-react';

// =============================================================================
// StatusBadge — the Approved/Draft chip shown beside a deliverable's approval
// latch. Promoted verbatim from ReportDraftingWorkspace once the same markup
// appeared in FindingsReportSection and AuditCertificateSection (rule of
// three). Presentation only: the latch logic stays with each section.
// =============================================================================

export default function StatusBadge({ approved, isLight }: { approved: boolean; isLight: boolean }) {
  if (approved) {
    return (
      <span
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border ${
          isLight
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
        }`}
      >
        <CheckCircle2 size={11} />
        Approved
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded border ${
        isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
      }`}
    >
      Draft
    </span>
  );
}
