import { useEffect, useMemo, useState } from 'react';
import {
  Pencil,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  FileText,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useAudit } from '../../../../context/AuditContext';
import { useAuditData } from '../../../../context/AuditDataContext';
import {
  PROVISIONAL_IMPACT_LABELS,
  PROVISIONAL_CLASSIFICATION_LABELS,
  SERVICE_TYPE_OPTIONS,
} from '../../../../lib/audit/labels';
import {
  fetchReportDraft,
  upsertReportDraft,
  approveReportDraft,
} from '../../../../lib/audit/reportApi';
import type { MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import type { ProvisionalClassification } from '../../../../types/audit';

// =============================================================================
// ReportDraftingWorkspace — REPORT_DRAFTING (Stage 7) center pane.
//
// Compiles upstream artefacts into a report draft:
//   - Auto: Scope (vendor service + mappings), Risk context (risk summary),
//           Findings / Observations / OFIs (workspace entries grouped by
//           classification)
//   - Auditor-authored: Executive summary, Conclusions
//
// One approval gate covers the whole report. When approved, Stage 8 unlocks.
// Sponsor-name-free by rule.
// =============================================================================

const CLASSIFICATION_GROUPS: { key: ProvisionalClassification; label: string }[] = [
  { key: 'FINDING', label: 'Findings' },
  { key: 'OBSERVATION', label: 'Observations' },
  { key: 'OPPORTUNITY_FOR_IMPROVEMENT', label: 'Opportunities for improvement' },
  { key: 'NOT_YET_CLASSIFIED', label: 'Not yet classified' },
];

export default function ReportDraftingWorkspace() {
  const { theme } = useTheme();
  const { activeAudit, advanceStage } = useAudit();
  const { reports, setReports, ...data } = useAuditData();
  const isLight = theme === 'light';

  const [editing, setEditing] = useState<'summary' | 'conclusions' | null>(null);
  const [draftSummary, setDraftSummary] = useState('');
  const [draftConclusions, setDraftConclusions] = useState('');

  useEffect(() => {
    setEditing(null);
  }, [activeAudit?.id]);

  useEffect(() => {
    if (!activeAudit?.id) return;
    const id = activeAudit.id;
    fetchReportDraft(id).then((draft) => {
      setReports((prev) => ({ ...prev, [id]: draft }));
    });
  }, [activeAudit?.id]);

  // Derive non-hook values (safe with null activeAudit since we read by key)
  const auditId = activeAudit?.id ?? null;
  const report = auditId ? reports[auditId] ?? null : null;
  const vendorService = auditId ? data.vendorServices[auditId] ?? null : null;
  const mappings = auditId ? data.serviceMappings[auditId] ?? [] : [];
  const protocolRisks = auditId ? data.protocolRisks[auditId] ?? [] : [];
  const riskSummary = auditId ? data.riskSummaries[auditId] ?? null : null;
  const entries = useMemo(
    () => (auditId ? data.workspaceEntries[auditId] ?? [] : []),
    [auditId, data.workspaceEntries],
  );

  // Group workspace entries by classification
  const grouped = useMemo(() => {
    const result: Record<ProvisionalClassification, MockWorkspaceEntry[]> = {
      FINDING: [],
      OBSERVATION: [],
      OPPORTUNITY_FOR_IMPROVEMENT: [],
      NOT_YET_CLASSIFIED: [],
    };
    for (const e of entries) result[e.provisional_classification].push(e);
    return result;
  }, [entries]);

  // Defer the no-protocol guard until after all hooks are declared.
  if (!activeAudit || !auditId) return null;

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------
  const generateStub = async () => {
    if (!auditId) return;
    const stub = await upsertReportDraft(
      auditId,
      '[Stub] This audit reviewed the contracted vendor service against the protocol-defined risk scope. Findings, observations, and OFIs are summarised below. Edit this paragraph down to your judgement.',
      '[Stub] Auditor conclusions go here.',
      'Report stub generated',
    );
    if (stub) {
      setReports((prev) => ({ ...prev, [auditId]: stub }));
      setDraftSummary(stub.executive_summary);
      setDraftConclusions(stub.conclusions);
    }
  };

  const beginEdit = (which: 'summary' | 'conclusions') => {
    if (!report) return;
    setDraftSummary(report.executive_summary);
    setDraftConclusions(report.conclusions);
    setEditing(which);
  };

  const saveSummary = async () => {
    if (!report || !auditId) return;
    const updated = await upsertReportDraft(auditId, draftSummary.trim(), report.conclusions);
    if (updated) {
      setReports((prev) => ({ ...prev, [auditId]: updated }));
      setEditing(null);
    }
  };

  const saveConclusions = async () => {
    if (!report || !auditId) return;
    const updated = await upsertReportDraft(auditId, report.executive_summary, draftConclusions.trim());
    if (updated) {
      setReports((prev) => ({ ...prev, [auditId]: updated }));
      setEditing(null);
    }
  };

  const approve = async () => {
    if (!report || !auditId) return;
    const updated = await approveReportDraft(report.id);
    if (updated) setReports((prev) => ({ ...prev, [auditId]: updated }));
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#131a22]';
  const inputBorder = isLight
    ? 'border-[#cbd2db] focus:border-[#4a6fa5] focus:ring-1 focus:ring-[#4a6fa5]/30'
    : 'border-white/15 focus:border-[#6e8fb5] focus:ring-1 focus:ring-[#6e8fb5]/30';
  const buttonPrimary = isLight
    ? 'bg-[#4a6fa5] text-white hover:bg-[#3d5e8f]'
    : 'bg-[#6e8fb5] text-[#1a1f28] hover:bg-[#5e7fa5]';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#e2e8ee] text-[#374152] hover:bg-[#f5f7fa]'
    : 'bg-[#131a22] border border-white/10 text-[#d2d7e0] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#cbd2db]'
    : 'bg-emerald-500 text-[#0d1118] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (!report) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
          Stage 7 · Report drafting
        </p>
        <h2 className={`${headingColor} text-xl font-semibold mt-1`}>
          Draft the audit report
        </h2>
        <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
          Compiles approved upstream artefacts (questionnaire, workspace entries, risk
          summary, vendor service) into a draft report. You author the executive summary
          and conclusions; everything else assembles automatically.
        </p>
        <button
          type="button"
          onClick={generateStub}
          className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
        >
          <Sparkles size={14} />
          Generate report stub
        </button>
      </div>
    );
  }

  const approved = report.approval_status === 'APPROVED';
  const alreadyAdvanced = activeAudit.current_stage === 'FINAL_REVIEW_EXPORT';
  const unclassifiedCount = grouped.NOT_YET_CLASSIFIED.length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
            Stage 7 · Report drafting
          </p>
          <h2 className={`${headingColor} text-xl font-semibold mt-1`}>Audit report draft</h2>
          <p className={`${subColor} text-sm mt-1.5 leading-relaxed max-w-2xl`}>
            Auto-compiled from upstream artefacts. Edit the executive summary and conclusions;
            the rest reflects what you captured in earlier stages. One approval gates Stage 8.
          </p>
        </div>
        <StatusBadge approved={approved} isLight={isLight} />
      </div>

      {/* Unclassified warning */}
      {unclassifiedCount > 0 && (
        <div
          className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
            isLight
              ? 'bg-amber-50 border-amber-200/80 text-amber-700'
              : 'bg-amber-500/[0.06] border-amber-500/15 text-amber-300'
          }`}
        >
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm leading-relaxed">
            <span className="font-semibold">
              {unclassifiedCount} workspace{' '}
              {unclassifiedCount === 1 ? 'entry is' : 'entries are'} unclassified.
            </span>{' '}
            Go back to Stage 6 (Audit conduct) to classify before approving the report.
          </p>
        </div>
      )}

      {/* Executive summary — editable */}
      <Section title="Executive summary" sectionHeader={sectionHeader}>
        {editing === 'summary' ? (
          <div className={`${cardBg} border rounded-md p-4 space-y-3`}>
            <textarea
              value={draftSummary}
              onChange={(e) => setDraftSummary(e.target.value)}
              rows={8}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            />
            {approved && (
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
                  isLight
                    ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
                    : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
                }`}
              >
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Saving will revert the report to Draft and require re-approval.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveSummary}
                disabled={!draftSummary.trim()}
                className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${buttonSecondary}`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={`${cardBg} border rounded-md p-4`}>
            <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
              {report.executive_summary}
            </p>
            <button
              type="button"
              onClick={() => beginEdit('summary')}
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <Pencil size={12} />
              {approved ? 'Revise' : 'Edit'}
            </button>
          </div>
        )}
      </Section>

      {/* Auto-compiled: Scope */}
      <Section title="Scope" sectionHeader={sectionHeader}>
        <AutoCompiledNote
          mutedColor={mutedColor}
          text="Auto-compiled from Stage 2 (Vendor enrichment)."
        />
        {!vendorService ? (
          <Empty subColor={subColor}>No vendor service defined.</Empty>
        ) : (
          <div className={`${cardBg} border rounded-md p-4 space-y-2`}>
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className={`${headingColor} text-sm font-semibold`}>
                {vendorService.service_name}
              </span>
              <span className={mutedColor}>·</span>
              <span className={`${subColor} text-xs`}>
                {SERVICE_TYPE_OPTIONS.find((o) => o.value === vendorService.service_type)?.label ??
                  vendorService.service_type}
              </span>
            </div>
            {vendorService.service_description && (
              <p className={`${subColor} text-sm leading-relaxed`}>
                {vendorService.service_description}
              </p>
            )}
            {mappings.length > 0 && (
              <p className={`${subColor} text-xs mt-2`}>
                {mappings.length} protocol section
                {mappings.length === 1 ? '' : 's'} mapped to this service.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* Auto-compiled: Risk context */}
      <Section title="Risk context" sectionHeader={sectionHeader}>
        <AutoCompiledNote
          mutedColor={mutedColor}
          text="Auto-compiled from Stage 4 (Scope & risk review)."
        />
        {!riskSummary ? (
          <Empty subColor={subColor}>No risk summary captured.</Empty>
        ) : (
          <div className={`${cardBg} border rounded-md p-4 space-y-2`}>
            <p className={`${headingColor} text-sm leading-relaxed whitespace-pre-wrap`}>
              {riskSummary.vendor_relevance_narrative}
            </p>
            {riskSummary.focus_areas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {riskSummary.focus_areas.map((f, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center text-[11px] px-2 py-0.5 rounded border ${
                      isLight
                        ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]/75'
                        : 'bg-white/[0.06] border-white/10 text-[#d2d7e0]/65'
                    }`}
                  >
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Auto-compiled: Findings / Observations / OFIs */}
      {CLASSIFICATION_GROUPS.filter((g) => g.key !== 'NOT_YET_CLASSIFIED').map((group) => {
        const items = grouped[group.key];
        return (
          <Section
            key={group.key}
            title={`${group.label} (${items.length})`}
            sectionHeader={sectionHeader}
          >
            <AutoCompiledNote
              mutedColor={mutedColor}
              text="Auto-compiled from Stage 6 (Audit conduct)."
            />
            {items.length === 0 ? (
              <Empty subColor={subColor}>No {group.label.toLowerCase()} recorded.</Empty>
            ) : (
              <ol className="space-y-2 list-decimal list-inside marker:font-semibold">
                {items.map((e) => {
                  const linkedRisk = e.protocol_risk_id
                    ? protocolRisks.find((r) => r.id === e.protocol_risk_id) ?? null
                    : null;
                  return (
                    <li
                      key={e.id}
                      className={`${cardBg} border rounded-md p-3 ${headingColor} text-sm leading-relaxed`}
                    >
                      <div className="inline-flex items-center gap-1.5 flex-wrap mb-1">
                        <span className={`${mutedColor} text-[11px] font-semibold`}>
                          {e.vendor_domain}
                        </span>
                        <span className={mutedColor}>·</span>
                        <span className={`${subColor} text-[11px]`}>
                          Impact: {PROVISIONAL_IMPACT_LABELS[e.provisional_impact]}
                        </span>
                        <span className={mutedColor}>·</span>
                        <span className={`${subColor} text-[11px]`}>
                          Class: {PROVISIONAL_CLASSIFICATION_LABELS[e.provisional_classification]}
                        </span>
                      </div>
                      <p>{e.observation_text}</p>
                      {(linkedRisk || e.checkpoint_ref) && (
                        <p className={`${mutedColor} text-[11px] mt-1`}>
                          {linkedRisk && (
                            <>
                              Linked: §{linkedRisk.section_identifier} —{' '}
                              {linkedRisk.section_title}
                            </>
                          )}
                          {linkedRisk && e.checkpoint_ref && ' · '}
                          {e.checkpoint_ref && <span className="font-mono">{e.checkpoint_ref}</span>}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
          </Section>
        );
      })}

      {/* Conclusions — editable */}
      <Section title="Conclusions" sectionHeader={sectionHeader}>
        {editing === 'conclusions' ? (
          <div className={`${cardBg} border rounded-md p-4 space-y-3`}>
            <textarea
              value={draftConclusions}
              onChange={(e) => setDraftConclusions(e.target.value)}
              rows={6}
              className={`w-full rounded-md border px-3 py-2 text-sm ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
            />
            {approved && (
              <div
                className={`flex items-start gap-2 px-3 py-2 rounded-md border ${
                  isLight
                    ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
                    : 'bg-amber-500/[0.06] border-amber-500/20 text-amber-300'
                }`}
              >
                <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
                <p className="text-[11px] leading-relaxed">
                  Saving will revert the report to Draft and require re-approval.
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveConclusions}
                disabled={!draftConclusions.trim()}
                className={`text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className={`text-sm font-medium px-3.5 py-2 rounded-md transition-colors ${buttonSecondary}`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className={`${cardBg} border rounded-md p-4`}>
            <p className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed`}>
              {report.conclusions}
            </p>
            <button
              type="button"
              onClick={() => beginEdit('conclusions')}
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
            >
              <Pencil size={12} />
              {approved ? 'Revise' : 'Edit'}
            </button>
          </div>
        )}
      </Section>

      {/* Approval + advance */}
      <div className={`${cardBg} border rounded-xl p-5`}>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
              Report approval
            </p>
            <p className={`${headingColor} text-sm font-semibold mt-1`}>
              {alreadyAdvanced
                ? 'Audit has already advanced past this stage'
                : approved
                ? 'Report approved — ready to advance'
                : 'Awaiting approval'}
            </p>
            {approved && report.approved_at && (
              <p className={`${subColor} text-xs mt-1`}>
                Approved {formatTimestamp(report.approved_at)}
                {report.approved_by_name ? ` · ${report.approved_by_name}` : ''}
              </p>
            )}
            {!approved && unclassifiedCount > 0 && (
              <p className={`${subColor} text-xs mt-1`}>
                Resolve {unclassifiedCount} unclassified entries before approving.
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {!approved && !alreadyAdvanced && (
              <button
                type="button"
                onClick={approve}
                disabled={unclassifiedCount > 0}
                className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
              >
                <CheckCircle2 size={14} />
                Approve report
              </button>
            )}
            <button
              type="button"
              onClick={() => advanceStage('FINAL_REVIEW_EXPORT')}
              disabled={!approved || alreadyAdvanced}
              className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
            >
              Advance to Final review
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function Section({
  title,
  sectionHeader,
  children,
}: {
  title: string;
  sectionHeader: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className={`text-sm font-semibold mb-2 ${sectionHeader}`}>
        <span className="uppercase tracking-wider text-[10px]">{title}</span>
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function AutoCompiledNote({ text, mutedColor }: { text: string; mutedColor: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-[11px] ${mutedColor}`}>
      <FileText size={11} />
      <span>{text}</span>
    </div>
  );
}

function Empty({ subColor, children }: { subColor: string; children: React.ReactNode }) {
  return <p className={`${subColor} text-sm italic`}>{children}</p>;
}

function StatusBadge({ approved, isLight }: { approved: boolean; isLight: boolean }) {
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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
