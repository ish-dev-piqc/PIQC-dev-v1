import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pencil,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Sparkles,
  FileText,
  History as HistoryIcon,
  Loader2,
  X as XIcon,
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
  prefillReportDraft,
  requestLlmExecutiveSummary,
  LlmExecutiveSummaryError,
} from '../../../../lib/audit/reportApi';
import type { MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import type { ProvisionalClassification } from '../../../../types/audit';
import HistoryDrawer from '../HistoryDrawer';
import PrefillAgentNote from '../PrefillAgentNote';

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
  const [historyOpen, setHistoryOpen] = useState(false);
  // Auto-fire LLM refinement state. The agent runs on first Stage 7 open
  // for any audit whose draft is still 'templated' — no button, no decision
  // surface. Auditor lands on a drafted report; they review and approve.
  //   llmRefining: background spinner on the source chip while in flight
  //   llmFallback: dismissable inline note when LLM failed and we kept the
  //                templated text intact (silent-with-signal degradation)
  const [llmRefining, setLlmRefining] = useState(false);
  const [llmFallback, setLlmFallback] = useState<string | null>(null);

  // Tracks audits whose LLM-refinement attempt has fired in this session,
  // so a re-render or navigation back to Stage 7 doesn't re-prompt OpenAI.
  // The server-side trail (executive_summary_source column transitioning to
  // 'llm') is the durable guard; this is the network-noise / cost optimisation.
  // Mirrors attemptedPrefillRef's idempotency idiom from PRs #58 + #62.
  const attemptedLlmRef = useRef<Set<string>>(new Set());

  // Tracks audits whose prefill RPC has already been attempted in this session
  // so opening Stage 7 / re-rendering doesn't fire the RPC repeatedly. The
  // server's 23505 idempotency is the durable guard; this is network-noise
  // optimisation. Mirrors PR #58's pattern in PreAuditDraftingWorkspace.
  const attemptedPrefillRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    setEditing(null);
  }, [activeAudit?.id]);

  useEffect(() => {
    if (!activeAudit?.id) return;
    const id = activeAudit.id;

    const load = async () => {
      const initial = await fetchReportDraft(id);
      let draft = initial;

      // Silent agentic bootstrap: if no report exists AND we haven't already
      // attempted prefill for this audit this session, fire the prefill RPC.
      // The RPC server-side-gates on approved Stage 4 risk summary and skips
      // silently if pre-conditions aren't met.
      if (!initial && !attemptedPrefillRef.current.has(id)) {
        attemptedPrefillRef.current.add(id);
        await prefillReportDraft(id);
        draft = await fetchReportDraft(id);
      }
      setReports((prev) => ({ ...prev, [id]: draft }));

      // North-star upgrade-in-place: if the draft is still templated AND
      // hasn't been approved yet AND we haven't tried LLM in this session,
      // fire the audit-summary edge function to refine the exec summary.
      // The auditor sees the templated text first (calm), then it gets
      // replaced by the LLM narrative when the call resolves (~3-8s).
      //
      // Guards:
      //   - Skip if approved — auditor signed off on templated; don't
      //     silently undo that by demoting the report back to DRAFT.
      //   - Skip if source already 'llm' or 'auditor_edited' — no second-
      //     guessing prior state in this session.
      //   - In-session ref + server-side source column = double idempotency.
      //
      // Failure mode: templated text stays in place; surface a dismissable
      // inline note so the auditor sees gracefully degraded behaviour and
      // the dev team has a debug signal (console.warn).
      if (
        draft &&
        draft.executive_summary_source === 'templated' &&
        draft.approval_status === 'DRAFT' &&
        !attemptedLlmRef.current.has(id)
      ) {
        attemptedLlmRef.current.add(id);
        setLlmRefining(true);
        try {
          const narrative = await requestLlmExecutiveSummary(id);
          const refined = await upsertReportDraft(
            id,
            narrative,
            draft.conclusions,
            'Executive summary refined by LLM',
            'llm',
          );
          if (refined) {
            setReports((prev) => ({ ...prev, [id]: refined }));
          }
        } catch (err) {
          // Invitational framing, not remedial. The auditor doesn't need to
          // read "AI failed" — the console.warn above carries the dev-team
          // debug signal. The visible note pivots from "we tried and failed"
          // to "here's your starting point — extend below." Same information
          // surface; agentic-positive tone matches the north star.
          //
          // Server-side specific errors (e.g. 409 "Stage 4 not approved") still
          // surface their message verbatim since they're actionable upstream
          // signals the auditor needs to act on.
          const message =
            err instanceof LlmExecutiveSummaryError
              ? err.message
              : 'Starting from your templated draft — edit below.';
          console.warn('[ReportDraftingWorkspace] LLM refinement failed', err);
          setLlmFallback(message);
        } finally {
          setLlmRefining(false);
        }
      }
    };

    load();
  }, [activeAudit?.id, setReports]);

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
    // Source resolution on save:
    //   - If current source is 'llm' AND the auditor didn't change the text
    //     since the LLM filled it, keep 'llm' (they accepted the draft as-is)
    //   - Otherwise flag 'auditor_edited' so the audit trail captures the
    //     human edit. The server preserves the previous value if we omit
    //     the param entirely — passing 'auditor_edited' is the explicit
    //     transition signal.
    const trimmed = draftSummary.trim();
    const llmDraftAcceptedAsIs =
      report.executive_summary_source === 'llm' &&
      trimmed === report.executive_summary;
    const newSource: 'llm' | 'auditor_edited' = llmDraftAcceptedAsIs
      ? 'llm'
      : 'auditor_edited';

    const updated = await upsertReportDraft(
      auditId,
      trimmed,
      report.conclusions,
      undefined,
      newSource,
    );
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
          {report.prefilled_at && (
            <p
              data-testid="report-prefill-chip"
              className={`${mutedColor} text-[11px] mt-1 inline-flex items-center gap-1`}
              title="Drafted from approved Stage 4 risk summary + Stage 6 workspace entries"
            >
              <Sparkles size={10} className={isLight ? 'text-[#4a6fa5]' : 'text-[#6e8fb5]'} />
              Started from: risk summary focus areas + audit observations
            </p>
          )}
        </div>
        <StatusBadge approved={approved} isLight={isLight} />
      </div>

      {/* Agentic moment — one-time note. Dismissable; persists per (stage, audit)
          in localStorage. Mirrors the Stage 5 banner pattern from PR #58.
          Hidden when source === 'llm' — the per-section LLM banner below
          carries the agentic narration in that state and stacking both
          would add cognitive load instead of collapsing it. */}
      {report.prefilled_at && report.executive_summary_source !== 'llm' && (
        <PrefillAgentNote
          storageKey={`piq-stage7-prefill-note-dismissed:${auditId}`}
          message="The executive summary and conclusions were drafted from your approved risk summary and audit observations. Review and edit each before approving."
        />
      )}

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

      {/* Executive summary — editable. Agent has already drafted by the
          time the auditor lands here (auto-fire on first open if templated).
          Auditor reads, edits if needed, approves. No "generate" buttons.

          During the in-flight refinement window (~3-8s), the chip itself
          says "Drafting with AI…" and the templated body dims to opacity-60
          so the auditor sees ONE narrative — agent is drafting — instead of
          three contradicting signals (templated chip + spinner + templated
          body that reads as final). North-star alignment: collapse cognitive
          load by way of the agentic workflow experience. */}
      <Section title="Executive summary" sectionHeader={sectionHeader}>
        <div className="mb-2">
          <ExecSummarySourceChip
            source={report.executive_summary_source ?? 'templated'}
            refining={llmRefining}
            isLight={isLight}
          />
        </div>

        {/* Calm narration when the LLM successfully refined the draft.
            Uses the established PrefillAgentNote pattern (PRs #58 + #62)
            so the agentic moment reads consistently across stages. One-time
            dismissable per (audit, llm). */}
        {report.executive_summary_source === 'llm' && (
          <div className="mb-3">
            <PrefillAgentNote
              storageKey={`piq-stage7-llm-banner-dismissed:${auditId}`}
              headline="Drafted with AI."
              message={
                <>
                  Refined from your approved Stage 4 risk summary and Stage 6
                  observations. Review and edit before approving.
                </>
              }
            />
          </div>
        )}

        {/* Invitational fallback note when the LLM call failed and the
            templated text is what's showing. Framed as a starting-point
            invitation ("Starting from your templated draft — edit below.")
            rather than a remedial confession.
            Icon + palette deliberately neutral (FileText, calm bg matching
            PrefillAgentNote) — amber + AlertTriangle would contradict the
            invitational copy by signalling "warning." The console.warn
            upstream carries the "AI failed" signal for the dev team. */}
        {llmFallback && report.executive_summary_source === 'templated' && (
          <div
            data-testid="exec-summary-llm-fallback"
            className={`flex items-start gap-2 px-3 py-2 mb-3 rounded-md border ${
              isLight
                ? 'bg-[#eef2f6] border-[#cbd2db] text-[#374152]'
                : 'bg-white/[0.04] border-white/10 text-[#d2d7e0]'
            }`}
          >
            <FileText size={12} className="flex-shrink-0 mt-0.5 opacity-70" />
            <p className="text-[11px] leading-relaxed flex-1">{llmFallback}</p>
            <button
              type="button"
              onClick={() => setLlmFallback(null)}
              aria-label="Dismiss"
              className={`inline-flex items-center justify-center w-5 h-5 rounded ${
                isLight ? 'text-[#374152]/55 hover:bg-white/60' : 'text-[#d2d7e0]/55 hover:bg-white/[0.06]'
              }`}
            >
              <XIcon size={11} />
            </button>
          </div>
        )}

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
            <div className="flex items-center gap-2 flex-wrap">
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
            <p
              className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed transition-opacity ${
                llmRefining ? 'opacity-60' : ''
              }`}
            >
              {report.executive_summary}
            </p>
            {/* Edit button disabled during the LLM refinement window — text
                the auditor would edit is about to be replaced. Re-enables
                automatically when the call resolves (success or failure).
                The `title` attribute carries the reason to both visible
                tooltip and screen readers — without it, the disabled state
                reads as "system is broken" rather than "agent is working." */}
            <button
              type="button"
              data-testid="exec-summary-edit-button"
              onClick={() => beginEdit('summary')}
              disabled={llmRefining}
              title={llmRefining ? 'Wait for the agent to finish drafting' : undefined}
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSecondary}`}
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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              title="View change history"
              aria-label="Open change history for the audit report"
            >
              <HistoryIcon size={12} />
              History
            </button>
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

      {historyOpen && report && (
        <HistoryDrawer
          objectType="REPORT_DRAFT_OBJECT"
          objectId={report.id}
          title="Audit report"
          subTitle="Report drafting · change history"
          onClose={() => setHistoryOpen(false)}
        />
      )}
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

// ExecSummarySourceChip — declarative provenance affordance.
// Tells the auditor what kind of draft they're looking at without competing
// with the executive summary text itself.
//
// During an in-flight LLM refinement the chip swaps to a unified "Drafting
// with AI…" state. Without this, the chip ("Templated draft") and the
// separate spinner ("Refining…") contradict each other for 3-8 seconds,
// while the templated body text reads as final. One signal, one tense —
// matches the north-star "agentic feel" doctrine.
function ExecSummarySourceChip({
  source,
  refining,
  isLight,
}: {
  source: 'templated' | 'llm' | 'auditor_edited';
  refining: boolean;
  isLight: boolean;
}) {
  // Refining always wins regardless of underlying source — the chip is a
  // status affordance, not a history affordance. History lives in the delta
  // trail via the History drawer.
  if (refining) {
    return (
      <span
        data-testid="exec-summary-source-chip"
        data-source="refining"
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
          isLight
            ? 'bg-[#eef2f6] border-[#cbd2db] text-[#4a6fa5]'
            : 'bg-white/[0.04] border-white/10 text-[#6e8fb5]'
        }`}
      >
        <Loader2 size={9} className="animate-spin" />
        Drafting with AI…
      </span>
    );
  }

  const labels: Record<'templated' | 'llm' | 'auditor_edited', string> = {
    templated: 'Templated draft',
    llm: 'AI-drafted',
    auditor_edited: 'Edited by auditor',
  };
  const tone = (() => {
    if (source === 'llm') {
      return isLight
        ? 'bg-[#eef2f6] border-[#cbd2db] text-[#4a6fa5]'
        : 'bg-white/[0.04] border-white/10 text-[#6e8fb5]';
    }
    if (source === 'auditor_edited') {
      return isLight
        ? 'bg-white border-[#e2e8ee] text-[#374152]'
        : 'bg-[#131a22] border-white/10 text-[#d2d7e0]';
    }
    return isLight
      ? 'bg-white border-[#e2e8ee] text-[#374152]/65'
      : 'bg-[#131a22] border-white/10 text-[#d2d7e0]/60';
  })();
  return (
    <span
      data-testid="exec-summary-source-chip"
      data-source={source}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${tone}`}
    >
      {source === 'llm' && <Sparkles size={9} />}
      {labels[source]}
    </span>
  );
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
