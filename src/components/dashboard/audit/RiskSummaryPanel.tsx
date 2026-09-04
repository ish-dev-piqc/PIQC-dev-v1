import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Sparkles,
  Pencil,
  History as HistoryIcon,
  X,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useAuditData } from '../../../context/AuditDataContext';
import { useAudit } from '../../../context/AuditContext';
import type { ClinicalTrialPhase } from '../../../types/audit';
import { CLINICAL_TRIAL_PHASE_LABELS } from '../../../lib/audit/labels';
import { scoreFocusArea } from '../../../lib/heatmap';
import HeatIndicator from '../../heatmap/HeatIndicator';
import HistoryDrawer from './HistoryDrawer';
import {
  fetchRiskSummary,
  upsertRiskSummary,
  approveRiskSummary,
  fetchParsedStudyContext,
  focusAreasFromRisks,
  linkProtocolRisksToSummary,
  manualStudyContext,
} from '../../../lib/audit/riskSummaryApi';
import { fetchProtocolRisksForAudit } from '../../../lib/audit/intakeApi';
import { getStageReadout } from '../../../lib/audit/auditApi';

// =============================================================================
// RiskSummaryPanel — right rail of the audit workspace.
//
// Renders the VendorRiskSummaryObject for the active audit over Supabase reads
// + RPC calls (AuditDataContext is the shared cache; Scope Review's gate reads
// the same store).
//
// Three states:
//   - No summary yet → "Generate from protocol": study context captured from
//                      the audit protocol's parsed document (with provenance),
//                      the sections tagged at Intake linked, focus areas seeded
//                      from their domains. The narrative is the auditor's.
//   - DRAFT          → edit + approve buttons
//   - APPROVED       → approved badge; editing or linking demotes to DRAFT
//
// Sponsor-name-free by rule — narrative copy stays generic.
// =============================================================================

interface RiskSummaryPanelProps {
  auditId: string;
  // 'rail' (default) renders the always-visible right rail, hidden below xl.
  // 'drawer' renders a slide-over overlay used on tablet/phone where there's
  // no room for the rail.
  variant?: 'rail' | 'drawer';
  onClose?: () => void;
}

export default function RiskSummaryPanel({
  auditId,
  variant = 'rail',
  onClose,
}: RiskSummaryPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  // Shared store — Scope Review's approval gate reads the same data.
  const {
    riskSummaries: summaries,
    setRiskSummaries: setSummaries,
    setStageReadouts,
    protocolRisks,
    setProtocolRisks,
  } = useAuditData();
  const summary = summaries[auditId] ?? null;
  // Protocol + phase for generation come from the active audit; the rail only
  // ever renders for it, but guard on the id so a stale prop can't read the
  // wrong protocol.
  const { activeAudit } = useAudit();
  const protocolId = activeAudit?.id === auditId ? activeAudit.protocol_id : null;
  const phase: ClinicalTrialPhase =
    activeAudit?.id === auditId ? activeAudit.clinical_trial_phase : 'NOT_APPLICABLE';
  const taggedRisks = protocolRisks[auditId] ?? [];

  const [editing, setEditing] = useState(false);
  const [draftNarrative, setDraftNarrative] = useState(summary?.vendor_relevance_narrative ?? '');
  const [draftFocusAreas, setDraftFocusAreas] = useState(
    (summary?.focus_areas ?? []).join(', '),
  );
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [linking, setLinking] = useState(false);
  // One visible line for anything generate / link could not finish — never a
  // console-only failure.
  const [actionError, setActionError] = useState<string | null>(null);

  // Reset editing state when the active audit changes.
  useEffect(() => {
    setEditing(false);
    setConfirmingApprove(false);
    setActionError(null);
    setDraftNarrative(summary?.vendor_relevance_narrative ?? '');
    setDraftFocusAreas((summary?.focus_areas ?? []).join(', '));
    // intentionally only reset on auditId change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // Hydrate the risk summary from Supabase on audit change.
  useEffect(() => {
    if (!auditId) return;
    let cancelled = false;
    void (async () => {
      const fetched = await fetchRiskSummary(auditId);
      if (cancelled) return;
      if (fetched) {
        setSummaries((prev) => ({ ...prev, [auditId]: fetched }));
      }
    })();
    // The tagged sections feed generation and the "not linked" line. Intake and
    // Scope Review hydrate this store too; the rail is on every stage, so fill
    // it when empty rather than showing a false "all linked".
    if (!protocolRisks[auditId]?.length) {
      void fetchProtocolRisksForAudit(auditId).then((risks) => {
        if (cancelled || risks.length === 0) return;
        setProtocolRisks((prev) => ({ ...prev, [auditId]: risks }));
      });
    }
    return () => {
      cancelled = true;
    };
    // setSummaries / setProtocolRisks are stable React.Dispatch refs from context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId]);

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const panelBg = isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const inputBorder = isLight ? 'border-[#CBD5E1] focus:border-brand-600' : 'border-white/15 focus:border-brand-300';
  const inputBg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const buttonPrimary = isLight
    ? 'bg-brand-600 text-white hover:bg-brand-800'
    : 'bg-brand-300 text-[#0F172A] hover:bg-brand-700';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const buttonApprove = isLight
    ? 'bg-emerald-600 text-white hover:bg-emerald-700'
    : 'bg-emerald-500 text-[#020617] hover:bg-emerald-400';

  // ---------------------------------------------------------------------------
  // Actions — backed by audit_mode_* RPCs in
  // supabase/migrations/20260430160000_audit_mode_risk_summary_rpcs.sql
  // ---------------------------------------------------------------------------
  // Generate = capture facts from the parsed protocol + link the tagged
  // sections. The narrative is deliberately left empty: PIQC never authors why
  // a vendor matters, and Approve stays disabled until the auditor writes it.
  const generateFromProtocol = async () => {
    setGenerating(true);
    setActionError(null);
    try {
      const now = new Date().toISOString();
      const [contextRes, risks] = await Promise.all([
        protocolId
          ? fetchParsedStudyContext(protocolId, phase)
          : Promise.resolve<Awaited<ReturnType<typeof fetchParsedStudyContext>>>({ ok: true, data: null }),
        taggedRisks.length > 0 ? Promise.resolve(taggedRisks) : fetchProtocolRisksForAudit(auditId),
      ]);
      // A read failure is not "no document": abort rather than snapshot a
      // context we could not read.
      if (!contextRes.ok) {
        setActionError(`Couldn't read the parsed protocol: ${contextRes.error}`);
        return;
      }
      const studyContext = contextRes.data ? contextRes.data.context : manualStudyContext(phase, now);
      const created = await upsertRiskSummary(
        auditId,
        {
          study_context: studyContext,
          vendor_relevance_narrative: '',
          focus_areas: focusAreasFromRisks(risks),
        },
        'Risk summary generated from protocol',
      );
      if (!created) {
        setActionError('Could not create the risk summary. Try again.');
        return;
      }
      const linkRes = await linkProtocolRisksToSummary(
        created.id,
        risks.map((r) => r.id),
        'Linked at generation',
      );
      // Re-read so protocol_risk_refs reflects the junction the RPC just wrote.
      const fresh = (await fetchRiskSummary(auditId)) ?? created;
      setSummaries((prev) => ({ ...prev, [auditId]: fresh }));
      setDraftNarrative(fresh.vendor_relevance_narrative);
      setDraftFocusAreas(fresh.focus_areas.join(', '));
      if (!linkRes.ok) {
        setActionError(`Summary created, but linking the tagged sections stopped: ${linkRes.error}`);
      }
    } finally {
      setGenerating(false);
    }
  };

  // Sections tagged after generation (or before the store hydrated) that the
  // summary does not yet link. Linking an APPROVED summary demotes it to Draft
  // (20260827000100) — the approval attests to the linked set.
  const unlinkedRisks = summary
    ? taggedRisks.filter((r) => !summary.protocol_risk_refs.some((ref) => ref.id === r.id))
    : [];

  const linkUnlinked = async () => {
    if (!summary || unlinkedRisks.length === 0) return;
    setLinking(true);
    setActionError(null);
    const res = await linkProtocolRisksToSummary(
      summary.id,
      unlinkedRisks.map((r) => r.id),
      'Tagged sections linked',
    );
    const fresh = await fetchRiskSummary(auditId);
    if (fresh) setSummaries((prev) => ({ ...prev, [auditId]: fresh }));
    // Link can flip APPROVED → DRAFT server-side; keep the shared gate readout
    // current, as saveEdits / approve do.
    getStageReadout(auditId).then((readout) => {
      setStageReadouts((prev) => ({ ...prev, [auditId]: readout }));
    });
    if (!res.ok) setActionError(`Linking stopped: ${res.error}`);
    setLinking(false);
  };

  const saveEdits = async () => {
    if (!summary) return;
    const focusAreas = parseFocusAreas(draftFocusAreas);
    const persisted = await upsertRiskSummary(
      auditId,
      {
        vendor_relevance_narrative: draftNarrative,
        focus_areas: focusAreas,
      },
      'Risk summary edited',
    );
    if (persisted) {
      setSummaries((prev) => ({ ...prev, [auditId]: persisted }));
      // Editing can change gate state server-side (demote-on-edit,
      // 20260826000000), so refresh the shared gate readout the same way
      // approve() below does — Stage 4's gate card and Stage 8's checklist
      // read from it, and both can be on screen alongside this rail.
      getStageReadout(auditId).then((readout) => {
        setStageReadouts((prev) => ({ ...prev, [auditId]: readout }));
      });
    }
    setEditing(false);
  };

  const cancelEdit = () => {
    if (!summary) return;
    setDraftNarrative(summary.vendor_relevance_narrative);
    setDraftFocusAreas(summary.focus_areas.join(', '));
    setEditing(false);
  };

  const approve = async () => {
    if (!summary) return;
    // CAS on the row version this panel rendered — the readiness latch attests
    // to exactly the narrative/focus areas the reviewer saw.
    const result = await approveRiskSummary(summary.id, summary.updated_at, 'Risk summary approved');
    if (result.ok) {
      setSummaries((prev) => ({ ...prev, [auditId]: result.data }));
      // Keep Scope Review / Final Review's shared gate readout current — it's
      // consumed there, not re-derived from this store.
      getStageReadout(auditId).then((readout) => {
        setStageReadouts((prev) => ({ ...prev, [auditId]: readout }));
      });
    } else {
      // STALE_CONTENT: the summary changed since render — reload server truth.
      console.error('[RiskSummaryPanel] Approve rejected:', result.error);
      const fresh = await fetchRiskSummary(auditId);
      if (fresh) setSummaries((prev) => ({ ...prev, [auditId]: fresh }));
    }
    setConfirmingApprove(false);
  };

  const beginEdit = () => {
    if (!summary) return;
    setDraftNarrative(summary.vendor_relevance_narrative);
    setDraftFocusAreas(summary.focus_areas.join(', '));
    setEditing(true);
    setConfirmingApprove(false);
  };

  const approved = summary?.approval_status === 'APPROVED';

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  // Wrapper className differs between variants. Drawer adds an overlay panel
  // with fixed positioning so it floats over the workspace.
  const wrapperClass =
    variant === 'rail'
      ? `${panelBg} border-l flex-shrink-0 w-80 hidden xl:flex flex-col overflow-hidden`
      : `${panelBg} border-l shadow-xl flex flex-col overflow-hidden w-full max-w-md h-full`;

  const aside = (
    <aside aria-label="Vendor risk summary" className={wrapperClass}>
      {/* Header */}
      <div className={`px-5 pt-5 pb-3 border-b ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'} flex-shrink-0`}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-[10px] uppercase tracking-wider font-semibold ${sectionHeader}`}>
              Vendor risk summary
            </p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className={`${headingColor} text-sm font-semibold`}>Why this vendor matters</p>
              {summary && (
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-semibold uppercase tracking-wider ${
                    approved
                      ? isLight
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                        : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400'
                      : isLight
                      ? 'bg-amber-50 border-amber-200 text-amber-700'
                      : 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                  }`}
                >
                  {approved ? 'Approved' : 'Draft'}
                </span>
              )}
            </div>
          </div>
          {variant === 'drawer' && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`flex-shrink-0 ${subColor} hover:opacity-75`}
              aria-label="Close risk summary"
            >
              <X size={18} />
            </button>
          )}
        </div>
        {summary?.approved_at && (
          <p className={`${mutedColor} text-[11px] mt-1`}>
            Approved {formatTimestamp(summary.approved_at)}
            {summary.approved_by_name ? ` · ${summary.approved_by_name}` : ''}
          </p>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {actionError && (
          <p role="alert" className="text-xs text-red-500 mb-3 leading-relaxed">
            {actionError}
          </p>
        )}
        {!summary ? (
          <EmptyState
            isLight={isLight}
            cardBg={cardBg}
            subColor={subColor}
            buttonPrimary={buttonPrimary}
            generating={generating}
            onGenerate={() => void generateFromProtocol()}
          />
        ) : (
          <>
            {/* Study context snapshot */}
            <Section sectionHeader={sectionHeader} title="Study context">
              <dl className="space-y-1">
                <Row
                  label="Phase"
                  value={CLINICAL_TRIAL_PHASE_LABELS[summary.study_context.clinical_trial_phase]}
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Therapeutic"
                  value={summary.study_context.therapeutic_space || '—'}
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Primary"
                  value={
                    summary.study_context.primary_endpoints.length > 0
                      ? summary.study_context.primary_endpoints.join('; ')
                      : '—'
                  }
                  subColor={subColor}
                  headingColor={headingColor}
                />
                <Row
                  label="Secondary"
                  value={
                    summary.study_context.secondary_endpoints.length > 0
                      ? summary.study_context.secondary_endpoints.join('; ')
                      : '—'
                  }
                  subColor={subColor}
                  headingColor={headingColor}
                />
              </dl>
              <p className={`${mutedColor} text-[10px] mt-2 leading-relaxed`}>
                {summary.study_context.source === 'parsed_document'
                  ? `Captured from the parsed protocol ${formatDate(summary.study_context.captured_at)} — frozen across protocol amendments.`
                  : summary.study_context.source === 'manual'
                    ? `Study context not captured — no parsed protocol yet (see Stage 1). Snapshot ${formatDate(summary.study_context.captured_at)}.`
                    : `Snapshot ${formatDate(summary.study_context.captured_at)} — frozen across protocol amendments.`}
              </p>
            </Section>

            {/* Vendor relevance narrative */}
            <Section sectionHeader={sectionHeader} title="Vendor relevance narrative">
              {editing ? (
                <textarea
                  value={draftNarrative}
                  onChange={(e) => setDraftNarrative(e.target.value)}
                  rows={8}
                  className={`w-full rounded-md border px-2.5 py-2 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                  placeholder="Why does this vendor matter for this study?"
                />
              ) : summary.vendor_relevance_narrative.trim().length === 0 ? (
                <p className={`text-xs italic ${mutedColor}`}>
                  Not written yet — Edit to add why this vendor matters for this study.
                </p>
              ) : (
                <p className={`text-xs leading-relaxed whitespace-pre-wrap ${headingColor}`}>
                  {summary.vendor_relevance_narrative}
                </p>
              )}
            </Section>

            {/* Focus areas */}
            <Section sectionHeader={sectionHeader} title="Focus areas">
              {editing ? (
                <input
                  type="text"
                  value={draftFocusAreas}
                  onChange={(e) => setDraftFocusAreas(e.target.value)}
                  placeholder="Comma-separated"
                  className={`w-full rounded-md border px-2.5 py-1.5 text-xs ${inputBg} ${inputBorder} ${headingColor} focus:outline-none transition-colors`}
                />
              ) : summary.focus_areas.length === 0 ? (
                <p className={`text-xs italic ${mutedColor}`}>None specified</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.focus_areas.map((f) => (
                    <li key={f} className={`text-xs flex items-start gap-2 ${headingColor}`}>
                      <span
                        className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${
                          isLight ? 'bg-brand-600/55' : 'bg-brand-300/55'
                        }`}
                      />
                      <span className="flex-1 flex items-center gap-1.5 flex-wrap">
                        <span>{f}</span>
                        <HeatIndicator
                          score={scoreFocusArea(f)}
                          variant="chip"
                          hint="cross-audit finding-conversion rate"
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {/* Linked protocol risks */}
            <Section sectionHeader={sectionHeader} title="Linked protocol risks">
              {summary.protocol_risk_refs.length === 0 ? (
                <p className={`text-xs italic ${mutedColor}`}>No protocol risks linked</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.protocol_risk_refs.map((r) => (
                    <li key={r.id} className="text-xs leading-relaxed">
                      <span className={`font-semibold ${headingColor}`}>{r.section_identifier}</span>
                      <span className={subColor}> — {r.section_title}</span>
                      {r.operational_domain_tag && (
                        <span className={`${mutedColor} block text-[10px] mt-0.5`}>
                          {r.operational_domain_tag.replace(/_/g, ' ')}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {unlinkedRisks.length > 0 && (
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className={`text-[11px] ${mutedColor}`}>
                    {unlinkedRisks.length} tagged section{unlinkedRisks.length === 1 ? '' : 's'} not linked
                  </span>
                  <button
                    type="button"
                    onClick={() => void linkUnlinked()}
                    disabled={linking}
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                  >
                    {linking ? 'Linking…' : 'Link'}
                  </button>
                  {approved && (
                    <span className={`text-[10px] ${mutedColor}`}>Linking demotes to Draft.</span>
                  )}
                </div>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Footer actions */}
      {summary && (
        <div className={`px-5 py-3 border-t ${isLight ? 'border-[#E2E8F0]' : 'border-white/5'} flex-shrink-0 space-y-2`}>
          {confirmingApprove && (
            <div
              className={`rounded-md border px-2.5 py-2 ${
                isLight
                  ? 'bg-emerald-50 border-emerald-200/80'
                  : 'bg-emerald-500/[0.06] border-emerald-500/15'
              }`}
            >
              <p className={`text-[11px] mb-2 leading-relaxed ${isLight ? 'text-emerald-700' : 'text-emerald-300'}`}>
                Approve this risk summary? Edits after approval revert it to Draft and require re-approval before advancing.
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={approve}
                  className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove}`}
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingApprove(false)}
                  className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {!editing && !confirmingApprove && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={beginEdit}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                <Pencil size={12} />
                Edit
              </button>
              {!approved && (
                <button
                  type="button"
                  onClick={() => setConfirmingApprove(true)}
                  disabled={!summary.vendor_relevance_narrative.trim()}
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonApprove} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <CheckCircle2 size={12} />
                  Approve
                </button>
              )}
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md ml-auto transition-colors ${buttonSecondary}`}
                title="View change history"
              >
                <HistoryIcon size={12} />
                History
              </button>
            </div>
          )}

          {editing && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveEdits}
                disabled={!draftNarrative.trim()}
                className={`text-xs font-semibold px-2.5 py-1.5 rounded-md transition-colors ${buttonPrimary} disabled:opacity-50`}
              >
                Save
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
              >
                Cancel
              </button>
              {approved && (
                <span className={`text-[10px] ${mutedColor}`}>Saving demotes to Draft.</span>
              )}
            </div>
          )}
        </div>
      )}

      {historyOpen && summary && (
        <HistoryDrawer
          objectType="VENDOR_RISK_SUMMARY_OBJECT"
          objectId={summary.id}
          title="Risk summary"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );

  // Drawer variant: wrap the aside in a fixed-position overlay panel that
  // covers the right side. Click outside or the X to close.
  if (variant === 'drawer') {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/30 flex justify-end animate-fade-in"
        onClick={onClose}
        role="presentation"
      >
        <div onClick={(e) => e.stopPropagation()} className="h-full animate-slide-in-right">
          {aside}
        </div>
      </div>
    );
  }

  return aside;
}

// ============================================================================
// Sub-components
// ============================================================================

interface EmptyStateProps {
  isLight: boolean;
  cardBg: string;
  subColor: string;
  buttonPrimary: string;
  generating: boolean;
  onGenerate: () => void;
}

function EmptyState({ isLight, cardBg, subColor, buttonPrimary, generating, onGenerate }: EmptyStateProps) {
  const iconBg = isLight
    ? 'bg-brand-600/10 border-brand-600/20 text-brand-600'
    : 'bg-brand-600/15 border-brand-600/30 text-brand-300';
  return (
    <div className={`${cardBg} border rounded-lg p-4`}>
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-xl border mb-3 ${iconBg}`}>
        <Sparkles size={14} />
      </div>
      <p className={`${subColor} text-xs leading-relaxed mb-3`}>
        No risk summary yet. Generate one from the parsed protocol and the sections
        tagged at Intake — the study context is captured from the document; the
        narrative is yours to write.
      </p>
      <button
        type="button"
        onClick={onGenerate}
        disabled={generating}
        className={`text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonPrimary}`}
      >
        {generating ? 'Generating…' : 'Generate from protocol'}
      </button>
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  subColor: string;
  headingColor: string;
}

function Row({ label, value, subColor, headingColor }: RowProps) {
  return (
    <div className="flex gap-2 text-xs leading-snug">
      <dt className={`${subColor} flex-shrink-0 w-20`}>{label}</dt>
      <dd className={`${headingColor} m-0 flex-1 break-words`}>{value}</dd>
    </div>
  );
}

interface SectionProps {
  title: string;
  sectionHeader: string;
  children: React.ReactNode;
}

function Section({ title, sectionHeader, children }: SectionProps) {
  return (
    <section className="mb-5">
      <h4 className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold mb-2`}>
        {title}
      </h4>
      {children}
    </section>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function parseFocusAreas(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
