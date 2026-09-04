import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileSearch, Plus, RefreshCw } from 'lucide-react';
import { useTheme } from '../../../../../context/ThemeContext';
import { ENDPOINT_TIER_LABELS, IMPACT_SURFACE_LABELS } from '../../../../../lib/audit/labels';
import type { TaggedSection } from '../../../../../lib/audit/mockProtocolRisks';
import {
  deriveRiskCandidates,
  ISA_CANDIDATE_RULES,
  VENDOR_CANDIDATE_RULES,
  type CandidateSourceItem,
  type RiskCandidate,
} from '../../../../../lib/audit/riskCandidates';
import { fetchCandidateSourceItems } from '../../../../../lib/audit/riskCandidatesApi';
import type { AuditWorkflowType, RiskCandidateRule } from '../../../../../types/audit';

// =============================================================================
// RiskCandidatesPanel — "Suggested from the parsed protocol" (vendor Intake,
// ISA Risk assessment)
//
// Reads the protocol's worksheet items once per mount (and per protocol
// change), derives candidates with the pure rule module for the workflow's
// rule set (vendor: no eligibility criteria; site: all), and lists them
// grouped by rule. Accept hands the candidate to the workspace, which opens
// the tagging form prefilled — nothing is written from here. A candidate
// leaves the list when a tagged risk names its item as source (`tagged` is
// the same store the list below renders from), so an accept is reflected
// without a refetch and survives reload.
//
// No dismiss: a session-only hide would silently resurface on the next
// mount. Auditors who disagree with a proposal leave it; the count in the
// header keeps the list honest about how much is still unreviewed.
// =============================================================================

interface RiskCandidatesPanelProps {
  protocolId: string;
  /** Picks the rule set and where the no-items copy points for the parse
   *  status (vendor Intake has the card above; ISA has it on Stage 1). */
  workflow: AuditWorkflowType;
  /** Risks already tagged on the protocol version — dedupe source. */
  tagged: TaggedSection[];
  /** Mirrors the workspace's "Tag a section" button: a save in flight. */
  disabled: boolean;
  onAccept: (candidate: RiskCandidate) => void;
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; items: CandidateSourceItem[]; derivedAt: string };

const GROUP_LABELS: Record<RiskCandidateRule, string> = {
  endpoint_primary: 'Primary endpoints',
  endpoint_secondary: 'Secondary endpoints',
  dosing: 'Dosing',
  visit: 'Visits',
  criterion: 'Eligibility criteria',
};

const RULE_CHIP_LABELS: Record<RiskCandidateRule, string> = {
  endpoint_primary: 'Primary endpoint',
  endpoint_secondary: 'Secondary endpoint',
  dosing: 'Dosing',
  visit: 'Visit',
  criterion: 'Criterion',
};

export default function RiskCandidatesPanel({
  protocolId,
  workflow,
  tagged,
  disabled,
  onAccept,
}: RiskCandidatesPanelProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [collapsed, setCollapsed] = useState<Partial<Record<RiskCandidateRule, boolean>>>({});

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    fetchCandidateSourceItems(protocolId).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ kind: 'ready', items: result.data, derivedAt: new Date().toISOString() });
      } else {
        setState({ kind: 'error', message: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [protocolId, reloadKey]);

  const rules = workflow === 'VENDOR_AUDIT' ? VENDOR_CANDIDATE_RULES : ISA_CANDIDATE_RULES;

  const view = useMemo(() => {
    if (state.kind !== 'ready') return null;
    const set = deriveRiskCandidates(state.items, tagged, rules, state.derivedAt);
    const taggedSourceIds = new Set(
      tagged.map((t) => t.source_extracted_item_id).filter((id): id is string => Boolean(id)),
    );
    const linked = state.items.filter((item) => taggedSourceIds.has(item.id)).length;
    const groups = rules.map((rule) => ({
      rule,
      candidates: set.candidates.filter((c) => c.rule === rule),
    })).filter((g) => g.candidates.length > 0);
    return { ...set, groups, linked, itemCount: state.items.length };
  }, [state, tagged, rules]);

  const reload = () => setReloadKey((k) => k + 1);

  // ---------------------------------------------------------------------------
  // Theme tokens (match IntakeWorkspace's cards)
  // ---------------------------------------------------------------------------
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowBorder = isLight ? 'border-[#EEF2F6]' : 'border-white/5';
  const identifierBadge = isLight
    ? 'bg-[#F2F2F2] text-brand-600'
    : 'bg-white/[0.06] text-brand-300';
  const chipNeutral = isLight
    ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70'
    : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/65';
  const chipBrand = isLight
    ? 'bg-brand-600/10 border-brand-600/25 text-brand-600'
    : 'bg-brand-300/15 border-brand-300/30 text-brand-300';
  const chipAmber = isLight
    ? 'bg-amber-50/60 border-amber-200/80 text-amber-700'
    : 'bg-amber-500/[0.08] border-amber-500/20 text-amber-300';
  const buttonSecondary = isLight
    ? 'bg-white border border-[#E2E8F0] text-[#334155] hover:bg-[#F8FAFC]'
    : 'bg-[#0F172A] border border-white/10 text-[#CBD5E1] hover:bg-white/[0.04]';
  const errorBox = isLight
    ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-red-500/15 border-red-500/30 text-red-300';

  const suggestionCount = view?.candidates.length ?? 0;

  return (
    <section className={`rounded-xl border ${cardBg}`} aria-label="Suggested from the parsed protocol">
      {/* Header */}
      <div className={`flex items-start justify-between gap-3 flex-wrap px-4 py-3 border-b ${rowBorder}`}>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <FileSearch size={15} className={isLight ? 'text-brand-600' : 'text-brand-300'} />
            <h3 className="text-fg-heading text-sm font-semibold">Suggested from the parsed protocol</h3>
            <span
              title="Proposals come from the parsed protocol's own structure — its primary/secondary endpoint classification, dosing and visit schedule. No model is involved."
              className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${chipNeutral}`}
            >
              Derived, not generated
            </span>
          </div>
          <p className="text-fg-sub text-xs mt-1 leading-relaxed">
            PIQC proposes, you decide — Accept opens the tagging form prefilled; nothing is
            saved until you save it. The operational domain is always yours to choose.
          </p>
        </div>
        {view && (
          <p className="text-fg-muted text-xs flex-shrink-0">
            {suggestionCount} suggestion{suggestionCount === 1 ? '' : 's'}
            {view.linked > 0 && ` · ${view.linked} tagged`}
          </p>
        )}
      </div>

      {/* Body */}
      {state.kind === 'loading' && (
        <p className="px-4 py-4 text-fg-sub text-sm">Reading the parsed protocol…</p>
      )}

      {state.kind === 'error' && (
        <div className="px-4 py-4 space-y-3">
          <div role="alert" className={`text-xs px-3 py-2 rounded-md border ${errorBox}`}>
            Couldn’t read parsed protocol items: {state.message}
          </div>
          <button
            type="button"
            onClick={reload}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <RefreshCw size={12} />
            Retry
          </button>
        </div>
      )}

      {view && view.itemCount === 0 && (
        <div className="px-4 py-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-fg-sub text-sm">
            {workflow === 'VENDOR_AUDIT'
              ? 'No parsed protocol items yet — see the parse status above.'
              : 'No parsed protocol items yet — see the parse status on Stage 1 (Site intake).'}
          </p>
          <button
            type="button"
            onClick={reload}
            className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors ${buttonSecondary}`}
          >
            <RefreshCw size={12} />
            Check again
          </button>
        </div>
      )}

      {view && view.itemCount > 0 && view.candidates.length === 0 && (
        <p className="px-4 py-4 text-fg-sub text-sm">
          {view.linked > 0
            ? 'Nothing left to suggest — every parsed item with a proposal is already tagged.'
            : 'Nothing to propose from the parsed items.'}
        </p>
      )}

      {view && view.groups.length > 0 && (
        <div>
          {view.groups.map(({ rule, candidates }) => {
            const isCollapsed = collapsed[rule] === true;
            return (
              <div key={rule} className={`border-b last:border-b-0 ${rowBorder}`}>
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((prev) => ({ ...prev, [rule]: !isCollapsed }))}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-left"
                >
                  {isCollapsed ? (
                    <ChevronRight size={13} className="text-fg-muted" />
                  ) : (
                    <ChevronDown size={13} className="text-fg-muted" />
                  )}
                  <span className="text-fg-label text-[10px] uppercase tracking-wider font-semibold">
                    {GROUP_LABELS[rule]}
                  </span>
                  <span className="text-fg-muted text-[11px]">· {candidates.length}</span>
                </button>
                {!isCollapsed && (
                  <ul>
                    {candidates.map((c) => (
                      <li
                        key={c.source_extracted_item_id}
                        className={`flex items-start justify-between gap-3 px-4 py-3 border-t ${rowBorder}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span
                              className={`text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded ${identifierBadge}`}
                            >
                              {c.section_identifier}
                            </span>
                            <span className="text-fg-heading text-sm font-medium">{c.section_title}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span
                              className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${chipBrand}`}
                            >
                              {RULE_CHIP_LABELS[c.rule]}
                            </span>
                            <span className="text-fg-muted text-[11px]">
                              {ENDPOINT_TIER_LABELS[c.endpoint_tier]} · {IMPACT_SURFACE_LABELS[c.impact_surface]}
                              {c.time_sensitivity && ' · Time-sensitive'}
                            </span>
                            {/* Same predicate as SOTR's isAwaitingReview: draft or
                                unset = the worksheet reviewer hasn't looked yet. */}
                            <span
                              className={`inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                                !c.review_status || c.review_status === 'draft' ? chipAmber : chipNeutral
                              }`}
                            >
                              {!c.review_status || c.review_status === 'draft'
                                ? 'SOTR: awaiting review'
                                : 'SOTR: reviewed'}
                            </span>
                            {c.page_number !== null && (
                              <span className="text-fg-muted text-[11px]">p. {c.page_number}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAccept(c)}
                          disabled={disabled}
                          aria-label={`Accept ${c.section_identifier}`}
                          className={`flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50 ${buttonSecondary}`}
                        >
                          <Plus size={12} />
                          Accept
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view && view.skipped > 0 && (
        <p className={`px-4 py-2.5 text-fg-muted text-[11px] border-t ${rowBorder}`}>
          {view.skipped} parsed item{view.skipped === 1 ? '' : 's'} not proposed (no procedures, or an
          unrecognised shape).
        </p>
      )}
    </section>
  );
}
