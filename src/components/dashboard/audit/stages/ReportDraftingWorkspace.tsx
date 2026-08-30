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
import PiqcMark from '../PiqcMark';
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
  requestLlmConclusions,
  LlmExecutiveSummaryError,
} from '../../../../lib/audit/reportApi';
import type { MockWorkspaceEntry } from '../../../../lib/audit/mockWorkspaceEntries';
import type { ProvisionalClassification } from '../../../../types/audit';
import { hasReachedStage } from '../../../../lib/audit/workflowStages';
import HistoryDrawer from '../HistoryDrawer';
import PrefillAgentNote from '../PrefillAgentNote';
import StagePreviewNotice from '../StagePreviewNotice';

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

// Landing notice — transient acknowledgment that a PIQC chat write-back
// just landed text on Stage 7. Set by AuditWorkspaceShell after a
// successful onAssistantWriteback; cleared by dismiss button, audit
// switch, or navigation away from Stage 7. Optional so the workspace
// can still mount headless from tests or from any future caller that
// doesn't wire the notice channel.
interface Props {
  landingNotice?: { field: 'executive_summary' | 'conclusions'; at: number } | null;
  onDismissLandingNotice?: () => void;
}

export default function ReportDraftingWorkspace({
  landingNotice,
  onDismissLandingNotice,
}: Props = {}) {
  const { theme } = useTheme();
  const { activeAudit, advanceStage, advanceStageError } = useAudit();
  const { reports, setReports, ...data } = useAuditData();
  const isLight = theme === 'light';

  // One-ahead preview guard (UX2): the nav allows viewing Stage 7 while the
  // audit is still at Stage 6. Reads render; the prefill RPC, both LLM
  // refinements, and every mutating control stay off until the stage is real.
  const hasReached =
    !!activeAudit &&
    hasReachedStage(activeAudit.workflow_type, activeAudit.current_stage, 'REPORT_DRAFTING');

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
  // AUD-301: surface failures of user-initiated saves (stub / summary /
  // conclusions). The auto-refine paths keep the sanctioned silent-with-signal
  // fallback (llmFallback) since they are background, not user-initiated.
  const [saveError, setSaveError] = useState<string | null>(null);
  // In-flight guard for the readiness latch — prevents double-fire and lets
  // the button reflect the pending compare-and-swap.
  const [approving, setApproving] = useState(false);
  // Independent in-flight + fallback state for the conclusions section. The
  // two refinements run in parallel from the same useEffect but each has its
  // own UI surface — the chip, body dim, Edit-disabled, and dismissable
  // fallback note all read per-section.
  const [llmConclusionsRefining, setLlmConclusionsRefining] = useState(false);
  const [llmConclusionsFallback, setLlmConclusionsFallback] = useState<string | null>(null);

  // Tracks audits whose LLM-refinement attempt has fired in this session,
  // so a re-render or navigation back to Stage 7 doesn't re-prompt OpenAI.
  // The server-side trail (executive_summary_source column transitioning to
  // 'llm') is the durable guard; this is the network-noise / cost optimisation.
  // Mirrors attemptedPrefillRef's idempotency idiom from PRs #58 + #62.
  const attemptedLlmRef = useRef<Set<string>>(new Set());
  // Separate idempotency ref for the conclusions LLM call — the two sections
  // refine independently, and a failure-then-retry on one shouldn't gate the
  // other. Double idempotency (in-session ref + server-side conclusions_source
  // = 'templated' guard) matches the exec-summary pattern.
  const attemptedLlmConclusionsRef = useRef<Set<string>>(new Set());

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
      if (!initial && hasReached && !attemptedPrefillRef.current.has(id)) {
        attemptedPrefillRef.current.add(id);
        await prefillReportDraft(id);
        draft = await fetchReportDraft(id);
      }
      setReports((prev) => ({ ...prev, [id]: draft }));

      // North-star upgrade-in-place: if the draft is still templated AND
      // hasn't been approved yet AND we haven't tried LLM in this session,
      // fire the audit-summary edge function to refine each section. The
      // auditor sees the templated text first (calm), then it gets replaced
      // by the LLM narrative when the call resolves (~3-8s).
      //
      // Exec summary + conclusions LLM refinements fire in PARALLEL. Each
      // has independent in-flight / fallback state so the auditor can see
      // either resolve first. Server-side guards still serialize the writes:
      // both flows call audit_mode_upsert_report_draft, but each call passes
      // only its section's source field, leaving the other field's source
      // preserved by the RPC's COALESCE. The two await chains don't share
      // any closure-mutable state — `draft` is captured once at entry, and
      // each branch reads its own provenance/text from the original snapshot.
      //
      // Guards (per section):
      //   - Skip if approved — auditor signed off; don't silently demote
      //   - Skip if source already 'llm' or 'auditor_edited'
      //   - In-session ref + server source column = double idempotency
      //
      // Failure mode (per section): templated text stays in place; surface
      // an invitational inline note; console.warn carries the dev-team signal.
      const llmTasks: Promise<void>[] = [];

      if (
        hasReached &&
        draft &&
        draft.executive_summary_source === 'templated' &&
        draft.approval_status === 'DRAFT' &&
        !attemptedLlmRef.current.has(id)
      ) {
        attemptedLlmRef.current.add(id);
        setLlmRefining(true);
        llmTasks.push(
          (async () => {
            try {
              const narrative = await requestLlmExecutiveSummary(id);
              // Refetch right before write to pick up any conclusions LLM
              // refinement that raced ahead. If the refetch FAILS (returns
              // null — RLS denial, network blip), bail rather than fall back
              // to the stale templated snapshot — that fallback could clobber
              // a conclusions LLM write that already landed. Templated text
              // stays in place; the silent-with-signal fallback note shows.
              const current = await fetchReportDraft(id);
              if (!current) {
                throw new Error('Pre-write refetch returned null; refusing to write to avoid stale clobber');
              }
              // The human's latch wins over the agent: if the auditor marked
              // the report ready while this refine was in flight, discard the
              // refinement rather than silently demoting their approval.
              if (current.approval_status !== 'DRAFT') {
                console.info('[ReportDraftingWorkspace] exec-summary refinement discarded — report was approved mid-refine');
                return;
              }
              const refined = await upsertReportDraft(
                id,
                narrative,
                current.conclusions,
                'Executive summary refined by LLM',
                'llm',
              );
              if (refined.ok) {
                setReports((prev) => ({ ...prev, [id]: refined.data }));
              }
            } catch (err) {
              const message =
                err instanceof LlmExecutiveSummaryError
                  ? err.message
                  : 'Starting from your templated draft — edit below.';
              console.warn('[ReportDraftingWorkspace] LLM exec-summary refinement failed', err);
              setLlmFallback(message);
            } finally {
              setLlmRefining(false);
            }
          })(),
        );
      }

      if (
        hasReached &&
        draft &&
        draft.conclusions_source === 'templated' &&
        draft.approval_status === 'DRAFT' &&
        !attemptedLlmConclusionsRef.current.has(id)
      ) {
        attemptedLlmConclusionsRef.current.add(id);
        setLlmConclusionsRefining(true);
        llmTasks.push(
          (async () => {
            try {
              const narrative = await requestLlmConclusions(id);
              // Same refetch-or-bail contract as the exec-summary branch:
              // if the refetch fails we must NOT fall back to the stale
              // snapshot, because a successful exec-summary LLM write may
              // have already landed and the snapshot still holds templated
              // text. Better to leave the templated conclusions in place and
              // surface the fallback note than silently demote exec back.
              const current = await fetchReportDraft(id);
              if (!current) {
                throw new Error('Pre-write refetch returned null; refusing to write to avoid stale clobber');
              }
              // Same human-latch-wins contract as the exec-summary branch.
              if (current.approval_status !== 'DRAFT') {
                console.info('[ReportDraftingWorkspace] conclusions refinement discarded — report was approved mid-refine');
                return;
              }
              const refined = await upsertReportDraft(
                id,
                current.executive_summary,
                narrative,
                'Conclusions refined by LLM',
                undefined,
                'llm',
              );
              if (refined.ok) {
                setReports((prev) => ({ ...prev, [id]: refined.data }));
              }
            } catch (err) {
              const message =
                err instanceof LlmExecutiveSummaryError
                  ? err.message
                  : 'Starting from your templated conclusions — edit below.';
              console.warn('[ReportDraftingWorkspace] LLM conclusions refinement failed', err);
              setLlmConclusionsFallback(message);
            } finally {
              setLlmConclusionsRefining(false);
            }
          })(),
        );
      }

      await Promise.all(llmTasks);
    };

    load();
    // hasReached is a dep so the bootstrap fires the moment the audit actually
    // advances into Stage 7 after an earlier read-only preview ran.
  }, [activeAudit?.id, hasReached, setReports]);

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
    const result = await upsertReportDraft(
      auditId,
      '[Stub] This audit reviewed the contracted vendor service against the protocol-defined risk scope. Findings, observations, and OFIs are summarised below. Edit this paragraph down to your judgement.',
      '[Stub] Auditor conclusions go here.',
      'Report stub generated',
    );
    if (result.ok) {
      setSaveError(null);
      const stub = result.data;
      setReports((prev) => ({ ...prev, [auditId]: stub }));
      setDraftSummary(stub.executive_summary);
      setDraftConclusions(stub.conclusions);
    } else {
      setSaveError(result.error);
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

    const result = await upsertReportDraft(
      auditId,
      trimmed,
      report.conclusions,
      undefined,
      newSource,
    );
    if (result.ok) {
      setSaveError(null);
      setReports((prev) => ({ ...prev, [auditId]: result.data }));
      setEditing(null);
    } else {
      setSaveError(result.error);
    }
  };

  const saveConclusions = async () => {
    if (!report || !auditId) return;
    // Symmetric with saveSummary: if the auditor opens the editor and saves
    // an LLM draft unchanged, keep the 'llm' provenance (they accepted as-is).
    // Any modification → 'auditor_edited' so the GxP trail captures the human
    // touch. Omitting the source preserves the previous value server-side,
    // but explicit transitions read more cleanly in the delta log.
    const trimmed = draftConclusions.trim();
    const llmDraftAcceptedAsIs =
      report.conclusions_source === 'llm' && trimmed === report.conclusions;
    const newSource: 'llm' | 'auditor_edited' = llmDraftAcceptedAsIs ? 'llm' : 'auditor_edited';

    const result = await upsertReportDraft(
      auditId,
      report.executive_summary,
      trimmed,
      undefined,
      undefined,
      newSource,
    );
    if (result.ok) {
      setSaveError(null);
      setReports((prev) => ({ ...prev, [auditId]: result.data }));
      setEditing(null);
    } else {
      setSaveError(result.error);
    }
  };

  const approve = async () => {
    if (!report || !auditId || approving) return;
    setApproving(true);
    // Compare-and-swap on the row version the auditor is looking at — the
    // readiness latch attests to exactly this content (spec: audit-export-
    // readiness). On STALE_CONTENT the row moved underneath us (LLM refine
    // landing, a concurrent edit): refresh and invite a re-review.
    const result = await approveReportDraft(report.id, report.updated_at);
    if (result.ok) {
      setSaveError(null);
      setReports((prev) => ({ ...prev, [auditId]: result.data }));
    } else {
      const fresh = await fetchReportDraft(auditId);
      if (fresh) setReports((prev) => ({ ...prev, [auditId]: fresh }));
      setSaveError(
        result.errorHint === 'STALE_CONTENT' || result.errorHint === 'MISSING_EXPECTED_VERSION'
          ? 'This draft changed since you last reviewed it — refreshed for another look.'
          : result.error,
      );
    }
    setApproving(false);
  };

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const inputBorder = isLight
    ? 'border-[#CBD5E1] focus:border-brand-600 focus:ring-1 focus:ring-brand-600/30'
    : 'border-white/15 focus:border-brand-300 focus:ring-1 focus:ring-brand-300/30';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-[#CBD5E1]'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/35';

  // ---------------------------------------------------------------------------
  // Empty state
  // ---------------------------------------------------------------------------
  if (!report) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
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
        {hasReached && (
          <button
            type="button"
            onClick={generateStub}
            className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonPrimary}`}
          >
            <Sparkles size={14} />
            Generate report stub
          </button>
        )}
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
      {!hasReached && <StagePreviewNotice currentStage={activeAudit.current_stage} />}
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
              <Sparkles size={10} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
              Started from: risk summary focus areas + audit observations
            </p>
          )}
        </div>
        <StatusBadge approved={approved} isLight={isLight} />
      </div>

      {/* Templated-prefill banner. Hidden once EITHER section flips to 'llm' —
          the page-level "Drafted with AI" banner below carries the stronger
          agentic narration. Stacking templated + LLM banners adds cognitive
          load instead of collapsing it (doctrine_agentic_ux_patterns.md). */}
      {report.prefilled_at &&
        report.executive_summary_source !== 'llm' &&
        report.conclusions_source !== 'llm' && (
          <PrefillAgentNote
            storageKey={`piq-stage7-prefill-note-dismissed:${auditId}`}
            message="The executive summary and conclusions were drafted from your approved risk summary and audit observations. Review and edit each before approving."
          />
        )}

      {/* Page-level LLM banner. ONE statement covering both sections when
          either (or both) is AI-drafted. Replaces what used to be two per-
          section banners stacking with near-identical "Drafted with AI"
          headlines — north-star regression. Per-section *chips* still tell
          the auditor which sections are AI-drafted vs templated vs edited;
          this banner narrates *that* the agent did work, not *which* one. */}
      {(report.executive_summary_source === 'llm' ||
        report.conclusions_source === 'llm') && (
        <PrefillAgentNote
          storageKey={`piq-stage7-llm-banner-dismissed:${auditId}`}
          headline="Drafted with AI."
          message="Refined from your approved Stage 4 risk summary and Stage 6 findings. Review and edit each section before approving."
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
        {landingNotice?.field === 'executive_summary' && (
          <PiqcLandingNote
            field="executive_summary"
            onDismiss={onDismissLandingNotice}
            isLight={isLight}
          />
        )}
        <div className="mb-2">
          <ExecSummarySourceChip
            source={report.executive_summary_source ?? 'templated'}
            refining={llmRefining}
            isLight={isLight}
          />
        </div>

        {/* The "Drafted with AI" narration moved up to the page-level banner
            above the unclassified warning (one statement covers both sections).
            Per-section chip below still tells the auditor this section is
            AI-drafted vs templated vs edited. */}

        {/* Invitational fallback note when the LLM call failed and the
            templated text is what's showing. Framed as a starting-point
            invitation ("Starting from your templated draft — edit below.")
            rather than a remedial confession.
            Icon + palette deliberately neutral (FileText, calm bg matching
            PrefillAgentNote) — amber + AlertTriangle would contradict the
            invitational copy by signalling "warning." The console.warn
            upstream carries the "AI failed" signal for the dev team. */}
        {saveError && (
          <div
            role="alert"
            className={`flex items-start gap-2 px-3 py-2 mb-3 rounded-md border ${
              isLight ? 'bg-red-50 border-red-200 text-red-700' : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            <AlertTriangle size={12} className="flex-shrink-0 mt-0.5" />
            <p className="text-[11px] leading-relaxed flex-1">Couldn’t save your changes: {saveError}</p>
            <button
              type="button"
              onClick={() => setSaveError(null)}
              aria-label="Dismiss"
              className="inline-flex items-center justify-center w-5 h-5 rounded opacity-70 hover:opacity-100"
            >
              <XIcon size={11} />
            </button>
          </div>
        )}
        {llmFallback && report.executive_summary_source === 'templated' && (
          <div
            data-testid="exec-summary-llm-fallback"
            className={`flex items-start gap-2 px-3 py-2 mb-3 rounded-md border ${
              isLight
                ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]'
                : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
            }`}
          >
            <FileText size={12} className="flex-shrink-0 mt-0.5 opacity-70" />
            <p className="text-[11px] leading-relaxed flex-1">{llmFallback}</p>
            <button
              type="button"
              onClick={() => setLlmFallback(null)}
              aria-label="Dismiss"
              className={`inline-flex items-center justify-center w-5 h-5 rounded ${
                isLight ? 'text-[#334155]/55 hover:bg-white/60' : 'text-[#CBD5E1]/55 hover:bg-white/[0.06]'
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
              // Disable while EITHER section is mid-LLM-refinement. Saving an
              // exec edit while conclusions is refining would clobber the
              // in-flight conclusions write with the stale templated text
              // currently in render state (saveSummary writes report.conclusions
              // directly). Same race in reverse for the conclusions Edit.
              disabled={llmRefining || llmConclusionsRefining || !hasReached}
              title={
                llmRefining || llmConclusionsRefining
                  ? 'Wait for the agent to finish drafting'
                  : undefined
              }
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
                        ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/75'
                        : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65'
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

      {/* Conclusions — editable. Mirrors the exec-summary surface: source
          chip + LLM banner + invitational fallback + body dim during in-flight
          + Edit disabled during in-flight. Each side reads independently;
          the auditor can land on an LLM exec summary + templated conclusions
          (or vice versa) if one of the two LLM calls fails. */}
      <Section title="Conclusions" sectionHeader={sectionHeader}>
        {landingNotice?.field === 'conclusions' && (
          <PiqcLandingNote
            field="conclusions"
            onDismiss={onDismissLandingNotice}
            isLight={isLight}
          />
        )}
        <div className="mb-2">
          <ConclusionsSourceChip
            source={report.conclusions_source ?? 'templated'}
            refining={llmConclusionsRefining}
            isLight={isLight}
          />
        </div>

        {/* "Drafted with AI" narration is page-level (above) — covers both
            sections in one statement. The conclusions chip below still
            declares this section's source. */}

        {llmConclusionsFallback && report.conclusions_source === 'templated' && (
          <div
            data-testid="conclusions-llm-fallback"
            className={`flex items-start gap-2 px-3 py-2 mb-3 rounded-md border ${
              isLight
                ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]'
                : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
            }`}
          >
            <FileText size={12} className="flex-shrink-0 mt-0.5 opacity-70" />
            <p className="text-[11px] leading-relaxed flex-1">{llmConclusionsFallback}</p>
            <button
              type="button"
              onClick={() => setLlmConclusionsFallback(null)}
              aria-label="Dismiss"
              className={`inline-flex items-center justify-center w-5 h-5 rounded ${
                isLight ? 'text-[#334155]/55 hover:bg-white/60' : 'text-[#CBD5E1]/55 hover:bg-white/[0.06]'
              }`}
            >
              <XIcon size={11} />
            </button>
          </div>
        )}

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
            <p
              className={`${headingColor} text-sm whitespace-pre-wrap leading-relaxed transition-opacity ${
                llmConclusionsRefining ? 'opacity-60' : ''
              }`}
            >
              {report.conclusions}
            </p>
            <button
              type="button"
              data-testid="conclusions-edit-button"
              onClick={() => beginEdit('conclusions')}
              // Same cross-section race guard as exec-summary Edit — see comment
              // on that button. Disabled while EITHER section is in-flight.
              disabled={llmConclusionsRefining || llmRefining || !hasReached}
              title={
                llmConclusionsRefining || llmRefining
                  ? 'Wait for the agent to finish drafting'
                  : undefined
              }
              className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${buttonSecondary}`}
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
                // Gated on: unclassified entries, either LLM refine in flight
                // (the text on screen may be about to change), and the latch
                // call itself being in flight. Doctrine: the latch attests to
                // what the human saw, so nothing may be mutating while it arms.
                disabled={
                  unclassifiedCount > 0 || llmRefining || llmConclusionsRefining || approving || !hasReached
                }
                className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
              >
                <CheckCircle2 size={14} />
                {approving ? 'Marking ready…' : 'Mark ready to export'}
              </button>
            )}
            <button
              type="button"
              onClick={() => advanceStage('FINAL_REVIEW_EXPORT')}
              disabled={!approved || alreadyAdvanced || !hasReached}
              className={`inline-flex items-center gap-1.5 text-sm font-semibold px-3.5 py-2 rounded-md transition-colors ${buttonApprove}`}
            >
              Advance to Final review
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
        {/* Server-side gate rejection surfaced from AuditContext.advanceStage.
            Without this the click is silently lost (AUD-301 class). */}
        {advanceStageError && (
          <div
            role="alert"
            className={`text-xs px-3 py-2 mt-4 rounded-md border ${
              isLight
                ? 'bg-red-50 border-red-200 text-red-700'
                : 'bg-red-500/15 border-red-500/30 text-red-300'
            }`}
          >
            Couldn’t advance the stage: {advanceStageError}
          </div>
        )}
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

// SourceChip — declarative provenance affordance.
// Tells the auditor what kind of draft they're looking at without competing
// with the section body text itself. Shared by both exec-summary and
// conclusions; the two sections render independent instances with distinct
// data-testids so test selectors and the future delta-history wiring can
// scope cleanly.
//
// During an in-flight LLM refinement the chip swaps to a unified "Drafting
// with AI…" state. Without this, the chip ("Templated draft") and a separate
// spinner ("Refining…") contradict each other for 3-8 seconds while the
// templated body text reads as final. One signal, one tense — matches the
// north-star "agentic feel" doctrine.
function SourceChip({
  source,
  refining,
  isLight,
  testId,
}: {
  source: 'templated' | 'llm' | 'auditor_edited';
  refining: boolean;
  isLight: boolean;
  testId: string;
}) {
  // Refining always wins regardless of underlying source — the chip is a
  // status affordance, not a history affordance. History lives in the delta
  // trail via the History drawer.
  if (refining) {
    return (
      <span
        data-testid={testId}
        data-source="refining"
        className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${
          isLight
            ? 'bg-[#F2F2F2] border-[#CBD5E1] text-brand-600'
            : 'bg-white/[0.04] border-white/10 text-brand-300'
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
        ? 'bg-[#F2F2F2] border-[#CBD5E1] text-brand-600'
        : 'bg-white/[0.04] border-white/10 text-brand-300';
    }
    if (source === 'auditor_edited') {
      return isLight
        ? 'bg-white border-[#E2E8F0] text-[#334155]'
        : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]';
    }
    return isLight
      ? 'bg-white border-[#E2E8F0] text-[#334155]/65'
      : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]/60';
  })();
  return (
    <span
      data-testid={testId}
      data-source={source}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md border ${tone}`}
    >
      {source === 'llm' && <Sparkles size={9} />}
      {labels[source]}
    </span>
  );
}

// Thin wrappers preserve test-friendly section-scoped data-testids and let
// the two callsites read self-documenting at the JSX level.
function ExecSummarySourceChip(props: {
  source: 'templated' | 'llm' | 'auditor_edited';
  refining: boolean;
  isLight: boolean;
}) {
  return <SourceChip {...props} testId="exec-summary-source-chip" />;
}

function ConclusionsSourceChip(props: {
  source: 'templated' | 'llm' | 'auditor_edited';
  refining: boolean;
  isLight: boolean;
}) {
  return <SourceChip {...props} testId="conclusions-source-chip" />;
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

// =============================================================================
// PiqcLandingNote — transient acknowledgment when a PIQC chat write-back
// just landed text on this section. Lives ABOVE the section's source chip
// so the auditor sees the connective tissue (chat → land) before the
// existing provenance signals (source chip + draft pill).
//
// Voice: first-person partner, consistent with the chat panel's empty-state
// primer + signal block + write-back confirm. Single sentence; the source
// chip below carries the formal provenance, so the note can stay light.
//
// Lifecycle is owned by AuditWorkspaceShell — see pendingWritebackNotice
// state there. Dismiss button calls onDismiss which the shell wires to
// clear the state.
// =============================================================================
function PiqcLandingNote({
  field,
  onDismiss,
  isLight,
}: {
  field: 'executive_summary' | 'conclusions';
  onDismiss?: () => void;
  isLight: boolean;
}) {
  const fieldLabel = field === 'executive_summary' ? 'exec summary' : 'conclusions';
  return (
    <div
      data-testid={`piqc-landing-note-${field}`}
      // role="status" announces the note's content to screen-reader users
      // when it mounts. The note is the auditor's only signal that the
      // textarea below them carries text they just sent from PIQC chat —
      // a visual-only cue would leave SR users without the connective
      // tissue. role="status" implies aria-live="polite" per WAI-ARIA, so
      // the announcement waits for the SR user's current utterance to
      // finish rather than interrupting.
      role="status"
      className={`flex items-start gap-2 px-3 py-2 mb-3 rounded-md border ${
        isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]'
          : 'bg-white/[0.04] border-white/10 text-[#CBD5E1]'
      }`}
    >
      <span
        className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-brand-600' : 'text-brand-300'}`}
        aria-hidden
      >
        <PiqcMark size={12} />
      </span>
      <p className="text-[11px] leading-relaxed flex-1">
        Just dropped this into your {fieldLabel} from our chat. Review and edit
        below — nothing is final until you save.
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss this note"
          data-testid={`piqc-landing-note-dismiss-${field}`}
          className={`inline-flex items-center justify-center w-5 h-5 rounded flex-shrink-0 ${
            isLight
              ? 'text-[#334155]/55 hover:text-[#0F172A] hover:bg-white/60'
              : 'text-[#CBD5E1]/55 hover:text-white hover:bg-white/[0.06]'
          }`}
        >
          <XIcon size={11} />
        </button>
      )}
    </div>
  );
}
