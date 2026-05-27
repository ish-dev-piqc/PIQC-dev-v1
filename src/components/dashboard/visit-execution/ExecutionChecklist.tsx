import { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  GitFork,
  MoreHorizontal,
  User,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  EXECUTION_PHASE_ORDER,
  PHASE_LABELS_DOSING,
  PHASE_LABELS_NON_DOSING,
  defaultExpandedPhases,
  type ExecutionPhase,
  type ExecutionReviewStatus,
  type RoleFilter,
  type VisitExecutionItem,
  type VisitExecutionWorkspace,
} from '../../../types/visit-execution';
import { itemMatchesRoleFilter } from '../../../lib/visit-execution/parseRoleHint';
import ExecutionItemClassificationBadge from './ExecutionItemClassificationBadge';
import ExecutionReviewStatusBadge from './ExecutionReviewStatusBadge';
import VisitConfidenceBadge from './VisitConfidenceBadge';

// =============================================================================
// ExecutionChecklist — the main surface. Renders all items grouped by
// ExecutionPhase, in EXECUTION_PHASE_ORDER. Phases with zero items are
// hidden entirely (no empty section headers). 1-2 phases auto-expand on
// mount via defaultExpandedPhases(); the rest start collapsed.
//
// Per item:
//   - Single click on the row toggles review_status not_reviewed ↔ reviewed
//   - ⋯ overflow menu opens flag / note / clarification actions
//   - Conditional rules render INLINE as collapsed amber callouts beneath
//     the item label — not in a separate section
//   - Source field count + timing render inline if non-empty
//   - Traceability link button (§) opens the drawer scoped to that item
// =============================================================================

/**
 * Per-item menu actions Sprint 4b plumbs distinctly.
 * - flag_for_review / mark_needs_clarification: both set review_status to
 *   'needs_review' at the DB layer, but the audit log distinguishes them
 *   via action enum, so the menu needs to surface them separately.
 * - open_edit / open_note: open the text-input drawer in the matching mode.
 */
export type ChecklistItemAction =
  | 'flag_for_review'
  | 'mark_needs_clarification'
  | 'open_edit'
  | 'open_note'
  /** Sprint 4c: opens the read-only edit-log timeline drawer for the row. */
  | 'view_history';

interface Props {
  workspace: VisitExecutionWorkspace;
  /** Map of itemId → review status (client-local optimistic override). */
  reviewStatus: Map<string, ExecutionReviewStatus>;
  onToggleReviewed: (itemId: string) => void;
  /** Sprint 4b: replaces the old onSetStatus(itemId, status) with an action
   * discriminator. Parent (VisitExecutionTab) dispatches each action to the
   * matching mutation API call or drawer-open handler. */
  onItemAction: (item: VisitExecutionItem, action: ChecklistItemAction) => void;
  onOpenTraceability: (item: VisitExecutionItem) => void;
  /**
   * Sprint 6: role-filter lens. `'all'` is the no-op default; selecting a
   * specific role narrows the visible checklist to items matching that role
   * (or unscoped — see itemMatchesRoleFilter for the safety default).
   * Defaults to `'all'` so existing callers without role-awareness keep
   * their current behavior.
   */
  roleFilter?: RoleFilter;
}

export default function ExecutionChecklist({
  workspace,
  reviewStatus,
  onToggleReviewed,
  onItemAction,
  onOpenTraceability,
  roleFilter = 'all',
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const phaseLabels = workspace.snapshot.is_dosing_visit
    ? PHASE_LABELS_DOSING
    : PHASE_LABELS_NON_DOSING;

  // Group items by phase once per workspace (and per role filter). Filter
  // applied BEFORE grouping so phases with no role-relevant items don't
  // render an empty phase card — same hide-empty-phases behavior as
  // before, just downstream of the role lens.
  const itemsByPhase = useMemo(() => {
    const map = new Map<ExecutionPhase, VisitExecutionItem[]>();
    for (const phase of EXECUTION_PHASE_ORDER) map.set(phase, []);
    for (const item of workspace.items) {
      if (!itemMatchesRoleFilter(item.role_hint, roleFilter)) continue;
      map.get(item.phase)?.push(item);
    }
    return map;
  }, [workspace, roleFilter]);

  const [expandedPhases, setExpandedPhases] = useState<Set<ExecutionPhase>>(
    () => new Set(defaultExpandedPhases(workspace.snapshot)),
  );

  const togglePhase = (phase: ExecutionPhase) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) next.delete(phase);
      else next.add(phase);
      return next;
    });
  };

  // Sprint 6: if the role filter zeroed out every phase, surface a soft
  // empty state rather than rendering nothing. Coordinator dropping into
  // an empty filtered view shouldn't see a blank workspace and wonder if
  // it broke.
  const filteredTotal = Array.from(itemsByPhase.values()).reduce(
    (sum, items) => sum + items.length,
    0,
  );
  const showEmptyFilteredState = roleFilter !== 'all' && filteredTotal === 0;

  return (
    <section
      data-testid="vew-checklist"
      aria-label="Workflow-ordered execution checklist"
      className="space-y-3"
    >
      {/* Polish-v2: dropped the "Workflow-ordered checklist" visible caption
          — the section itself IS the workflow-ordered list and the heading
          was restating the obvious. The aria-label on <section> preserves
          screen-reader context. */}
      {showEmptyFilteredState && (
        <div
          data-testid="vew-checklist-empty-for-role"
          className={`rounded-xl border px-4 py-6 text-center ${
            isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5'
          }`}
        >
          <p className="text-fg-body text-sm">
            No requirements scoped to this role for this visit.
          </p>
          <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
            Switch back to <span className="font-semibold">All</span> to see every
            requirement, or try a different role.
          </p>
        </div>
      )}

      {EXECUTION_PHASE_ORDER.map((phase) => {
        const phaseItems = itemsByPhase.get(phase) ?? [];
        if (phaseItems.length === 0) return null;

        const isOpen = expandedPhases.has(phase);
        const reviewedInPhase = phaseItems.filter(
          (i) => (reviewStatus.get(i.id) ?? i.review_status) === 'reviewed',
        ).length;

        return (
          <div
            key={phase}
            data-testid={`vew-phase-${phase}`}
            data-phase={phase}
            data-open={isOpen}
            className={`rounded-xl border overflow-hidden ${
              isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5'
            }`}
          >
            <button
              type="button"
              onClick={() => togglePhase(phase)}
              aria-expanded={isOpen}
              aria-controls={`vew-phase-items-${phase}`}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left ${
                isLight ? 'hover:bg-[#f5f7fa]' : 'hover:bg-white/[0.02]'
              }`}
            >
              <div className="flex items-center gap-2 min-w-0">
                {isOpen ? (
                  <ChevronDown size={14} className="text-fg-sub flex-shrink-0" aria-hidden />
                ) : (
                  <ChevronRight size={14} className="text-fg-sub flex-shrink-0" aria-hidden />
                )}
                {/* Polish-v2: stronger phase-title weight — earns the
                    "section title" role rather than reading at the same
                    weight as the item labels below. */}
                <span className="text-fg-heading text-[15px] font-semibold tracking-tight truncate">
                  {phaseLabels[phase]}
                </span>
              </div>
              {/* Polish-v2: counter restyled as "<reviewed>/<total>" with the
                  total quieted — the eye reads progress fraction without
                  the verbal redundancy of the word "reviewed". */}
              <span className="text-fg-sub text-xs font-medium tabular-nums flex-shrink-0">
                <span className={reviewedInPhase === phaseItems.length && phaseItems.length > 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-fg-body'}>
                  {reviewedInPhase}
                </span>
                <span className="text-fg-muted"> / {phaseItems.length}</span>
              </span>
            </button>

            {isOpen && (
              <ul
                id={`vew-phase-items-${phase}`}
                className={`divide-y ${
                  isLight ? 'divide-[#f0f3f6]' : 'divide-white/[0.04]'
                }`}
              >
                {phaseItems.map((item) => (
                  <ChecklistItemRow
                    key={item.id}
                    item={item}
                    status={reviewStatus.get(item.id) ?? item.review_status}
                    onToggleReviewed={onToggleReviewed}
                    onItemAction={onItemAction}
                    onOpenTraceability={onOpenTraceability}
                  />
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}


// ---------------------------------------------------------------------------
// One checklist row.
// ---------------------------------------------------------------------------

interface RowProps {
  item: VisitExecutionItem;
  status: ExecutionReviewStatus;
  onToggleReviewed: (itemId: string) => void;
  onItemAction: (item: VisitExecutionItem, action: ChecklistItemAction) => void;
  onOpenTraceability: (item: VisitExecutionItem) => void;
}

function ChecklistItemRow({
  item,
  status,
  onToggleReviewed,
  onItemAction,
  onOpenTraceability,
}: RowProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [conditionsOpen, setConditionsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [driftOpen, setDriftOpen] = useState(false);

  const hasConditions = item.conditions.length > 0;
  const isReviewed = status === 'reviewed';
  /**
   * Sprint 4b drift detection: label is COALESCE(current_text, derived_text)
   * from the v3 RPC. When current_text is set AND differs from derived_text,
   * label !== derived_text. Mock/thin-adapter rows have label === derived_text,
   * so the hint stays hidden in demo + Sprint 1 bridge paths.
   */
  const hasDrift =
    item.derived_text !== null &&
    item.derived_text !== undefined &&
    item.derived_text !== item.label;

  return (
    <li
      data-testid="vew-checklist-item"
      data-item-id={item.id}
      data-status={status}
      className={`px-4 py-3.5 ${
        isReviewed
          ? isLight
            ? 'bg-emerald-50/30'
            : 'bg-emerald-400/[0.04]'
          : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Click target for review toggle */}
        <button
          type="button"
          onClick={() => onToggleReviewed(item.id)}
          aria-label={`Mark ${item.label} as ${isReviewed ? 'not reviewed' : 'reviewed'}`}
          aria-pressed={isReviewed}
          className={`mt-0.5 flex-shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${
            isReviewed
              ? isLight
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'bg-emerald-500/80 border-emerald-500/80 text-white'
              : isLight
                ? 'border-[#cbd2db] hover:border-[#374152]'
                : 'border-white/15 hover:border-white/30'
          }`}
        >
          {isReviewed && (
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className="w-3 h-3"
              aria-hidden
            >
              <path
                d="M2 6.5 5 9.5 10 3.5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-fg-body text-sm font-medium flex-1 min-w-0">{item.label}</p>
            <ExecutionItemClassificationBadge classification={item.classification} />
            <ExecutionReviewStatusBadge status={status} />
            {/* Sprint 7: per-item confidence flag. Renders ONLY for 'low' /
                'needs_review' states (polish-v2 rare-loud discipline) — the
                expected 'high' / 'medium' baseline gets no chip. Tooltip
                copy is scoped to the per-requirement perspective (vs the
                visit-level tooltip on the snapshot chip). */}
            {item.confidence_state &&
              (item.confidence_state === 'low' ||
                item.confidence_state === 'needs_review') && (
                <VisitConfidenceBadge
                  confidence={item.confidence_state}
                  variant="inline"
                  titleOverride={
                    item.confidence_state === 'low'
                      ? "PIQC has low confidence in THIS requirement's extracted text. Verify against the protocol source before relying on it."
                      : "PIQC couldn't establish confidence on THIS requirement. Verify against the protocol source and edit liberally."
                  }
                />
              )}
          </div>

          {item.description && (
            <p className="text-fg-sub text-xs mt-1 leading-relaxed">{item.description}</p>
          )}

          {hasDrift && item.derived_text && (
            <div className="mt-2">
              {/* Polish-v2: drift chip shape aligned with conditional chip
                  below — same px-1.5 py-0.5 + uppercase tracking-wider
                  treatment, just different semantic tone (neutral vs amber).
                  Label = "Edited from PIQC" — keeps the agentic attribution
                  (per product_vew_workspace_vs_worksheet_model.md: "PIQC
                  ___" voice is product-bearing, never polish-strip). The
                  reveal block below shows the parser-original text in full.
                  Kept in sync with RequirementTextDrawer's drift block. */}
              <button
                type="button"
                onClick={() => setDriftOpen((p) => !p)}
                aria-expanded={driftOpen}
                data-testid="vew-drift-toggle"
                title="This requirement has been edited from PIQC's draft text"
                className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                  isLight
                    ? 'text-fg-sub bg-[#eef2f6] border-[#dde3ea] hover:bg-[#e2e8ee]'
                    : 'text-fg-sub bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'
                }`}
              >
                <FileText size={10} aria-hidden />
                Edited from PIQC
              </button>
              {driftOpen && (
                <div
                  data-testid="vew-drift-original"
                  className={`mt-2 rounded-md border-l-2 px-3 py-1.5 text-xs leading-relaxed ${
                    isLight
                      ? 'bg-[#eef2f6] border-[#9aa6b5] text-fg-sub'
                      : 'bg-white/[0.03] border-white/15 text-fg-sub'
                  }`}
                >
                  <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-0.5">
                    Original parser output
                  </p>
                  <p className="whitespace-pre-wrap">{item.derived_text}</p>
                </div>
              )}
            </div>
          )}

          {/* Polish-v2: metadata row uses gap-x-4 (was gap-3) for clearer
              separation between role / timing / source-field-count, and
              mt-2 for breathing after the title + drift row. */}
          <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-xs">
            {item.role_hint && (
              <span className="inline-flex items-center gap-1 text-fg-sub">
                <User size={11} aria-hidden />
                {item.role_hint}
              </span>
            )}
            {item.timing && (
              <span
                className={`inline-flex items-center gap-1 ${
                  item.timing.is_hard_constraint
                    ? 'text-amber-700 dark:text-amber-400 font-semibold'
                    : 'text-fg-sub'
                }`}
              >
                <Clock size={11} aria-hidden />
                {item.timing.label}
              </span>
            )}
            {item.source_fields.length > 0 && (
              <span className="inline-flex items-center gap-1 text-fg-sub">
                <FileText size={11} aria-hidden />
                {item.source_fields.length} source field
                {item.source_fields.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {hasConditions && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setConditionsOpen((p) => !p)}
                aria-expanded={conditionsOpen}
                className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                  isLight
                    ? 'text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100'
                    : 'text-amber-400 bg-amber-400/10 border-amber-400/20 hover:bg-amber-400/15'
                }`}
              >
                <GitFork size={10} aria-hidden />
                ↳ {item.conditions.length === 1 ? 'If' : `${item.conditions.length} conditions`}
              </button>
              {conditionsOpen && (
                <div className="mt-2 space-y-2">
                  {item.conditions.map((c, idx) => (
                    <div
                      key={`${item.id}-cond-${idx}`}
                      data-testid="vew-conditional-callout"
                      className={`rounded-md border-l-4 px-3 py-2 text-xs leading-relaxed ${
                        isLight
                          ? 'bg-amber-50/60 border-amber-400 text-amber-900'
                          : 'bg-amber-400/[0.06] border-amber-400/60 text-amber-200'
                      }`}
                    >
                      <p>
                        <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">
                          If:
                        </span>
                        {c.condition_text}
                      </p>
                      <p className="mt-1">
                        <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">
                          Then:
                        </span>
                        {c.consequence_text}
                      </p>
                      {c.source_section && (
                        <p className="mt-1.5 text-[10px] uppercase tracking-wider opacity-70">
                          {c.source_section}
                          {c.source_page !== null && ` · p.${c.source_page}`}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right-side action cluster */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={() => onOpenTraceability(item)}
            aria-label={`View protocol source for ${item.label}`}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
              isLight ? 'hover:bg-[#e2e8ee] hover:text-fg-body' : 'hover:bg-white/[0.06] hover:text-fg-body'
            }`}
            data-testid="vew-traceability-link"
          >
            <span aria-hidden className="text-sm font-serif font-semibold leading-none">§</span>
          </button>

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((p) => !p)}
              aria-label={`More actions for ${item.label}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
                isLight ? 'hover:bg-[#e2e8ee] hover:text-fg-body' : 'hover:bg-white/[0.06] hover:text-fg-body'
              }`}
            >
              <MoreHorizontal size={13} aria-hidden />
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-hidden
                  tabIndex={-1}
                  onClick={() => setMenuOpen(false)}
                  className="fixed inset-0 z-10 cursor-default"
                />
                <div
                  role="menu"
                  data-testid="vew-item-overflow-menu"
                  className={`absolute right-0 top-full mt-1 w-44 z-20 rounded-md border shadow-lg overflow-hidden ${
                    isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/10'
                  }`}
                >
                  {/*
                   * Sprint 4b: full menu restored. Each item dispatches via
                   * the action discriminator so the parent calls the right
                   * RPC variant (flag_for_review vs mark_needs_clarification
                   * both set review_status='needs_review' but the audit log
                   * distinguishes them). Edit + Note items open the
                   * RequirementTextDrawer in the matching mode.
                   */}
                  {([
                    { label: 'Edit text',                action: 'open_edit'                as ChecklistItemAction },
                    { label: 'Add site note',            action: 'open_note'                as ChecklistItemAction },
                    { label: 'Flag for review',          action: 'flag_for_review'          as ChecklistItemAction },
                    { label: 'Mark needs clarification', action: 'mark_needs_clarification' as ChecklistItemAction },
                    // Sprint 4c: read-only audit-log drawer. Last in the list
                    // since it's a "view" action, distinct from the four
                    // "do something" actions above.
                    { label: 'View edit history',        action: 'view_history'             as ChecklistItemAction },
                  ]).map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        onItemAction(item, opt.action);
                        setMenuOpen(false);
                      }}
                      className={`w-full text-left text-xs px-3 py-2 ${
                        isLight ? 'text-fg-body hover:bg-[#f5f7fa]' : 'text-fg-body hover:bg-white/[0.04]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
