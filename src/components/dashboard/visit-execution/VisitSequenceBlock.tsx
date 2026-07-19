import { useState } from 'react';
import {
  ChevronRight,
  Clock,
  FileText,
  GitFork,
  ListOrdered,
  Quote,
  User,
} from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import {
  EXECUTION_PHASE_ORDER,
  PHASE_LABELS_DOSING,
  PHASE_LABELS_NON_DOSING,
  type VisitExecutionItem,
  type VisitExecutionWorkspace,
} from '../../../types/visit-execution';
import { formatBriefWhere } from '../../../lib/visit-execution/visitBriefModel';
import ExecutionItemClassificationBadge from './ExecutionItemClassificationBadge';

// =============================================================================
// VisitSequenceBlock — "The visit, in order". The reading presentation of the
// day: every requirement as a timeline node in phase order, gates and hard
// timing marked at rest, full narrative one click deep (description, if/then
// rules, timing, source fields, the protocol's verbatim words).
//
// This is a READING surface — no checkboxes, no menus, no mutations. The
// acting surface (ExecutionChecklist) lives in the "Work the visit" section
// below it, unchanged. Two presentations of the same rows, deliberately:
// presentation-not-subtraction. The sequence always renders the FULL item
// set — the role lens narrows the acting checklist only.
// =============================================================================

interface Props {
  workspace: VisitExecutionWorkspace;
  /** Opens the existing TraceabilityDrawer scoped to the item. */
  onOpenTraceability: (item: VisitExecutionItem) => void;
  /** Verbatim grid labels carrying a narrative↔grid divergence. */
  divergentLabels?: ReadonlySet<string>;
}

export default function VisitSequenceBlock({
  workspace,
  onOpenTraceability,
  divergentLabels,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const phaseLabels = workspace.snapshot.is_dosing_visit
    ? PHASE_LABELS_DOSING
    : PHASE_LABELS_NON_DOSING;

  if (workspace.items.length === 0) return null;

  return (
    <section
      data-testid="vew-sequence"
      aria-label="The visit, in order"
      className={`rounded-2xl border p-5 ${
        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <ListOrdered size={13} className="text-brand-500 flex-shrink-0" aria-hidden />
        <h3 className="text-fg-heading text-sm font-semibold">The visit, in order</h3>
        <span className="ml-auto text-fg-muted text-[11px]">
          All {workspace.items.length} requirements · open any step for its source
        </span>
      </div>

      <div className="mt-3">
        {EXECUTION_PHASE_ORDER.map((phase) => {
          const phaseItems = workspace.items.filter((i) => i.phase === phase);
          if (phaseItems.length === 0) return null;
          return (
            <div key={phase} data-testid={`vew-sequence-phase-${phase}`}>
              <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mt-3 first:mt-0 mb-1.5">
                {phaseLabels[phase]}
              </p>
              <ol
                className={`border-l-2 ml-1.5 pl-4 space-y-1.5 ${
                  isLight ? 'border-[#E2E8F0]' : 'border-white/10'
                }`}
              >
                {phaseItems.map((item) => (
                  <SequenceNode
                    key={item.id}
                    item={item}
                    divergent={divergentLabels?.has(item.label) ?? false}
                    onOpenTraceability={onOpenTraceability}
                  />
                ))}
              </ol>
            </div>
          );
        })}
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// One node — collapsed: the step at a glance; expanded: its full narrative.
// ---------------------------------------------------------------------------

function SequenceNode({
  item,
  divergent,
  onOpenTraceability,
}: {
  item: VisitExecutionItem;
  divergent: boolean;
  onOpenTraceability: (item: VisitExecutionItem) => void;
}) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const [open, setOpen] = useState(false);

  const gated = item.conditions.length > 0;
  const hardTimed = item.timing?.is_hard_constraint ?? false;
  const where = formatBriefWhere(
    item.traceability.protocol_section,
    item.traceability.protocol_page,
  );
  const hasNarrative = !!item.description || gated || !!item.timing;

  return (
    <li className="relative" data-testid="vew-sequence-node">
      {/* Timeline dot on the rail. Amber ring = a gate or hard constraint
          stands between this step and the next. */}
      <span
        aria-hidden
        className={`absolute -left-[23px] top-[9px] w-2.5 h-2.5 rounded-full border-2 ${
          gated || hardTimed
            ? 'border-amber-500 bg-amber-100 dark:bg-amber-500/20'
            : isLight
              ? 'border-[#CBD5E1] bg-white'
              : 'border-white/25 bg-[#0F172A]'
        }`}
      />
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className={`w-full text-left rounded-md px-2 py-1.5 -ml-2 flex items-start gap-2 ${
          isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.03]'
        }`}
      >
        <ChevronRight
          size={12}
          aria-hidden
          className={`mt-1 flex-shrink-0 text-fg-muted transition-transform ${
            open ? 'rotate-90' : ''
          }`}
        />
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-fg-body text-sm font-medium">{item.label}</span>
            {item.classification !== 'required' && (
              <ExecutionItemClassificationBadge classification={item.classification} />
            )}
            {gated && (
              <span
                className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                  isLight
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                }`}
              >
                <GitFork size={10} aria-hidden /> Gate
              </span>
            )}
            {divergent && (
              <span
                className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider rounded-md border px-1.5 py-0.5 ${
                  isLight
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                }`}
              >
                Readings differ
              </span>
            )}
          </span>
          <span className="flex items-center gap-x-3 gap-y-0.5 flex-wrap mt-0.5 text-[11px] text-fg-sub">
            {item.role_hint && (
              <span className="inline-flex items-center gap-1">
                <User size={10} aria-hidden /> {item.role_hint}
              </span>
            )}
            {item.timing && (
              <span
                className={`inline-flex items-center gap-1 ${
                  hardTimed ? 'text-amber-700 dark:text-amber-400 font-semibold' : ''
                }`}
              >
                <Clock size={10} aria-hidden /> {item.timing.label}
              </span>
            )}
          </span>
        </span>
      </button>

      {open && (
        <div
          data-testid="vew-sequence-detail"
          className={`ml-4 mt-1 mb-1.5 rounded-md border px-3 py-2.5 space-y-2 text-xs leading-relaxed ${
            isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-white/[0.02] border-white/[0.06]'
          }`}
        >
          {item.description ? (
            <p className="text-fg-body">{item.description}</p>
          ) : (
            !hasNarrative && (
              <p className="text-fg-muted italic">
                No narrative found for this step — showing the SoA entry only. Verify
                against the protocol source.
              </p>
            )
          )}

          {item.conditions.map((c, idx) => (
            <div
              key={`${item.id}-seq-cond-${idx}`}
              className={`rounded-md border-l-4 px-3 py-2 ${
                isLight
                  ? 'bg-amber-50/60 border-amber-400 text-amber-900'
                  : 'bg-amber-400/[0.06] border-amber-400/60 text-amber-200'
              }`}
            >
              <p>
                <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">If:</span>
                {c.condition_text}
              </p>
              <p className="mt-1">
                <span className="font-semibold uppercase tracking-wider text-[10px] mr-1.5">Then:</span>
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

          {item.source_fields.length > 0 && (
            <p className="flex items-center gap-1.5 flex-wrap text-fg-sub">
              <FileText size={11} aria-hidden />
              <span className="font-semibold">Capture:</span>
              {item.source_fields.map((f) => (
                <span
                  key={f.field_label}
                  className={`rounded border px-1.5 py-px text-[10px] ${
                    isLight
                      ? 'bg-white border-[#E2E8F0] text-fg-sub'
                      : 'bg-white/[0.03] border-white/10 text-fg-sub'
                  }`}
                >
                  {f.field_label}
                  {f.units ? ` (${f.units})` : ''}
                </span>
              ))}
            </p>
          )}

          {item.traceability.source_quote && (
            <blockquote
              data-testid="vew-sequence-quote"
              className={`border-l-2 pl-3 py-0.5 ${
                isLight ? 'border-brand-300' : 'border-brand-400/40'
              }`}
            >
              <p className="text-fg-body flex items-start gap-1.5">
                <Quote size={11} aria-hidden className="mt-0.5 flex-shrink-0 text-fg-muted" />
                <span>&ldquo;{item.traceability.source_quote}&rdquo;</span>
              </p>
              {where && (
                <p className="text-fg-muted font-mono text-[10px] mt-1">{where}</p>
              )}
            </blockquote>
          )}

          <button
            type="button"
            onClick={() => onOpenTraceability(item)}
            className="text-brand-600 dark:text-brand-400 hover:underline text-[11px] font-medium"
          >
            View full source →
          </button>
        </div>
      )}
    </li>
  );
}
