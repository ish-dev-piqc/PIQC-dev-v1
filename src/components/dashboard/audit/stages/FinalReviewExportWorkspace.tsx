import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Circle,
  Download,
  Lock,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  fetchReportDraft,
  finalSignOffReport,
  markReportExported,
} from '../../../../lib/audit/reportApi';

// =============================================================================
// FinalReviewExportWorkspace — FINAL_REVIEW_EXPORT (Stage 8) center pane.
//
// Pre-export gate checklist (auto-derived from upstream approvals), final
// auditor sign-off, export action. Sponsor branding is added externally on
// export per the GxP rule.
// =============================================================================

interface GateItem {
  label: string;
  passed: boolean;
  detail: string;
}

export default function FinalReviewExportWorkspace() {
  const { theme } = useTheme();
  const { activeAudit } = useAudit();
  const { reports, setReports, ...data } = useAuditData();
  const isLight = theme === 'light';

  const [confirmingSignoff, setConfirmingSignoff] = useState(false);

  useEffect(() => {
    if (!activeAudit?.id) return;
    const id = activeAudit.id;
    fetchReportDraft(id).then((draft) => {
      setReports((prev) => ({ ...prev, [id]: draft }));
    });
  }, [activeAudit?.id]);

  if (!activeAudit) return null;

  const auditId = activeAudit.id;
  const questionnaire = data.questionnaires[auditId] ?? null;
  const riskSummary = data.riskSummaries[auditId] ?? null;
  const preAudit = data.preAuditBundles[auditId] ?? {
    confirmation_letter: null,
    agenda: null,
    checklist: null,
  };
  const entries = data.workspaceEntries[auditId] ?? [];
  const report = reports[auditId] ?? null;

  // Compute gates
  const gates: GateItem[] = [
    {
      label: 'Risk summary approved',
      passed: riskSummary?.approval_status === 'APPROVED',
      detail: 'From Stage 4 — auditor confirms scope and approves the risk summary.',
    },
    {
      label: 'Questionnaire approved',
      passed: !!questionnaire?.instance.approved_at,
      detail: 'From Stage 3 — vendor responses reviewed, finalised, and approved.',
    },
    {
      label: 'Confirmation letter approved',
      passed: preAudit.confirmation_letter?.approval_status === 'APPROVED',
      detail: 'From Stage 5 — sent to vendor before audit.',
    },
    {
      label: 'Agenda approved',
      passed: preAudit.agenda?.approval_status === 'APPROVED',
      detail: 'From Stage 5 — audit-day plan.',
    },
    {
      label: 'Checklist approved',
      passed: preAudit.checklist?.approval_status === 'APPROVED',
      detail: "From Stage 5 — auditor's working checklist.",
    },
    {
      label: 'All workspace entries classified',
      passed:
        entries.length > 0 &&
        entries.every((e) => e.provisional_classification !== 'NOT_YET_CLASSIFIED'),
      detail: `From Stage 6 — every observation has an impact + classification (${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}).`,
    },
    {
      label: 'Report draft approved',
      passed: report?.approval_status === 'APPROVED',
      detail: 'From Stage 7 — executive summary and conclusions reviewed and approved.',
    },
  ];

  const allPassed = gates.every((g) => g.passed);
  const passedCount = gates.filter((g) => g.passed).length;
  const finalSignedOff = !!report?.final_signed_off_at;

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const finalSignOff = async () => {
    if (!report || !allPassed) return;
    const updated = await finalSignOffReport(report.id);
    if (updated) {
      setReports((prev) => ({ ...prev, [auditId]: updated }));
      setConfirmingSignoff(false);
    }
  };

  const stubExport = async (format: 'markdown' | 'docx') => {
    if (!report) return;
    const updated = await markReportExported(report.id);
    if (updated) setReports((prev) => ({ ...prev, [auditId]: updated }));
    alert(
      `Export to ${format === 'markdown' ? 'Markdown' : 'Word (.docx)'}: stub.\n\nIn the wired build, this generates a sponsor-name-free draft for polish in external tooling.`,
    );
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#cbd2db] disabled:hover:bg-[#cbd2db]'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400 disabled:bg-white/10 disabled:hover:bg-white/10 disabled:text-white/35';

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 8 · Final review &amp; export
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          {finalSignedOff ? 'Audit closed' : 'Final review'}
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed`}>
          Confirm every upstream artefact is approved, sign off the audit, and export the
          report. Sponsor branding is added externally per the GxP rule.
        </p>
      </div>

      {/* Final sign-off banner */}
      {finalSignedOff && (
        <div
          className={`flex items-start gap-3 p-4 rounded-xl border ${
            isLight
              ? 'bg-emerald-50 border-emerald-200'
              : 'bg-emerald-500/10 border-emerald-500/30'
          }`}
        >
          <div
            className={`inline-flex items-center justify-center w-9 h-9 rounded-full flex-shrink-0 ${
              isLight ? 'bg-emerald-100' : 'bg-emerald-500/20'
            }`}
          >
            <Lock size={16} className={isLight ? 'text-emerald-700' : 'text-emerald-400'} />
          </div>
          <div className="min-w-0">
            <p className={`${headingColor} text-sm font-semibold`}>Audit signed off</p>
            <p className={`${subColor} text-xs mt-0.5`}>
              Final sign-off on{' '}
              {report?.final_signed_off_at && formatTimestamp(report.final_signed_off_at)} by{' '}
              {report?.final_signed_off_by_name ?? 'auditor'}. The audit is locked.
            </p>
          </div>
        </div>
      )}

      {/* Pre-export gate checklist */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Pre-export checklist
          </p>
          <p className={`${subColor} text-xs`}>
            {passedCount} of {gates.length} gates passed
          </p>
        </div>
        <ul className="space-y-2">
          {gates.map((g, i) => (
            <li key={i} className="flex items-start gap-3">
              {g.passed ? (
                <CheckCircle2
                  size={16}
                  className={`flex-shrink-0 mt-0.5 ${isLight ? 'text-emerald-600' : 'text-emerald-400'}`}
                />
              ) : (
                <Circle size={16} className={`flex-shrink-0 mt-0.5 ${mutedColor}`} />
              )}
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${
                    g.passed ? headingColor : isLight ? 'text-[#374152]/60' : 'text-[#d2d7e0]/55'
                  }`}
                >
                  {g.label}
                </p>
                <p className={`${subColor} text-xs mt-0.5`}>{g.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Final sign-off action */}
      {!finalSignedOff && (
        <div className={`${cardBg} border rounded-xl p-5`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p
                className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}
              >
                Final sign-off
              </p>
              <p className={`${headingColor} text-sm font-semibold mt-1`}>
                {allPassed
                  ? 'All gates passed — ready to sign off and close the audit'
                  : 'Resolve the open gates above before signing off'}
              </p>
              {!allPassed && (
                <p className={`${subColor} text-xs mt-1`}>
                  Sign-off locks the audit and is the source of truth for downstream
                  reporting.
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => allPassed && setConfirmingSignoff(true)}
              disabled={!allPassed}
              className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
            >
              <Lock size={14} />
              Sign off audit
            </button>
          </div>
          {confirmingSignoff && (
            <div
              className={`mt-4 px-3 py-2.5 rounded-md border ${
                isLight
                  ? 'bg-emerald-50 border-emerald-200/80'
                  : 'bg-emerald-500/[0.06] border-emerald-500/15'
              }`}
            >
              <p
                className={`text-[11px] mb-2 leading-relaxed ${
                  isLight ? 'text-emerald-700' : 'text-emerald-300'
                }`}
              >
                Confirm final sign-off? Once signed off, the audit is locked and upstream
                edits revert their parent artefact to Draft.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={finalSignOff}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${
                    isLight
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                      : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400'
                  }`}
                >
                  Confirm sign-off
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingSignoff(false)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Export */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div>
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Export
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              First-draft outputs for external polish
            </p>
            <p className={`${subColor} text-xs mt-1 leading-relaxed`}>
              Exports compile the approved upstream artefacts into a sponsor-name-free draft.
              Polish header / footer / branding in Word or Google Docs.
            </p>
          </div>
          {report?.exported_at && (
            <p className={`${mutedColor} text-[11px]`}>
              Last exported {formatTimestamp(report.exported_at)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => stubExport('markdown')}
            disabled={!finalSignedOff}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <Download size={14} />
            Markdown
          </button>
          <button
            type="button"
            onClick={() => stubExport('docx')}
            disabled={!finalSignedOff}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-md transition-colors ${buttonSecondary} disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <FileText size={14} />
            Word (.docx)
          </button>
          {!finalSignedOff && (
            <span className={`text-[11px] flex items-center gap-1.5 ${mutedColor}`}>
              <AlertTriangle size={11} />
              Sign off before exporting.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
