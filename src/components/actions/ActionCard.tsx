import {
  Database,
  ExternalLink,
  FileText,
  GraduationCap,
  Plane,
  X,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import {
  DESTINATION_LABELS,
  type ActionCardRecord,
  type ActionDestinationType,
} from '../../types/actions';

// =============================================================================
// ActionCard — the warm-handoff pattern rendered calmly: where this goes
// (destination chip) → what to do (title) → why now (fact-derived rationale)
// → next action → out. PIQC suggests and links out; execution happens in the
// external system.
//
//   - Dismiss is one-click and reversible by design (Decision 4): the card is
//     preserved server-side and can be resurfaced later, so no confirm step.
//   - Evidence renders as a quiet "N protocol sources" count only — evidence
//     drilldown is a follow-up, and implying a link that goes nowhere is
//     worse than an honest count.
//   - The link-out renders ONLY when a destination URL actually exists
//     (Decision 2: no third-party URL hardcoded). Otherwise a neutral text
//     line names the *category* of system — never a vendor, never a fake
//     button.
//   - Following the link fires onFollowLink so the rail can record 'acted' —
//     a click record, not workflow state (Decision 5); the navigation itself
//     is never blocked.
//   - The disclaimer always renders. Planning-support framing throughout.
//
// Generic actions component (non-mode, Decision 6): pure presentation over
// the frozen types contract — no data access; the rail owns fetching.
// SENSITIVE: rationale and disclaimer bodies are never logged.
// =============================================================================

const DESTINATION_ICONS: Record<ActionDestinationType, typeof Plane> = {
  travel: Plane,
  lms: GraduationCap,
  ctms: Database,
  none: ExternalLink,
};

/** Link-out label when a destination URL exists — names a system category,
 *  never a vendor. */
const LINK_LABELS: Record<ActionDestinationType, string> = {
  travel: 'Open in your travel tool',
  lms: 'Open in your training system',
  ctms: 'Open in your CTMS',
  none: 'Open external link',
};

/** Neutral next-action guidance when no destination URL is configured (the
 *  v1 default) — plain text, no link, no fake button. */
const NO_LINK_GUIDANCE: Record<ActionDestinationType, string> = {
  travel: 'Next action: plan in your organization’s preferred travel system.',
  lms: 'Next action: plan in your organization’s preferred training system.',
  ctms: 'Next action: continue in your organization’s CTMS.',
  none: 'Next action: continue in your organization’s preferred system.',
};

interface Props {
  card: ActionCardRecord;
  /** One-click, reversible (Decision 4) — the rail records 'dismissed'. */
  onDismiss: (card: ActionCardRecord) => void;
  /** Fired when the user follows the link-out — the rail records 'acted'
   *  fire-and-forget; this must never block the navigation. */
  onFollowLink: (card: ActionCardRecord) => void;
}

export function ActionCard({ card, onDismiss, onFollowLink }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const DestinationIcon = DESTINATION_ICONS[card.external_destination_type];
  const evidenceCount = card.protocol_evidence_ids.length;

  return (
    <div
      data-testid="action-card"
      data-trigger={card.trigger_context}
      className={`rounded-xl border px-4 py-4 ${
        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
      }`}
    >
      {/* Header: destination chip + title + one-click dismiss */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span
            title="Where this suggestion hands off to — PIQC links out; the action itself happens in your organization’s own system."
            className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 text-fg-sub bg-transparent flex-shrink-0 ${
              isLight ? 'border-[#CBD5E1]' : 'border-white/15'
            }`}
          >
            <DestinationIcon size={10} aria-hidden />
            {DESTINATION_LABELS[card.external_destination_type]}
          </span>
          <h3 className="text-fg-heading text-sm font-semibold">{card.title}</h3>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(card)}
          aria-label="Dismiss suggestion"
          title="Hides this suggestion. It is preserved and can be resurfaced later."
          data-testid="action-card-dismiss"
          className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
            isLight
              ? 'hover:bg-[#E2E8F0] hover:text-fg-body'
              : 'hover:bg-white/[0.06] hover:text-fg-body'
          }`}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* Why now — deterministic prose assembled from real facts only */}
      <p className="text-fg-body text-sm leading-relaxed mt-2">{card.rationale}</p>

      {/* Quiet evidence count — no link; drilldown is a follow-up */}
      {evidenceCount > 0 && (
        <p
          title={`Derived from ${evidenceCount} cited protocol ${
            evidenceCount === 1 ? 'fact' : 'facts'
          }`}
          className="flex items-center gap-1 text-fg-sub text-xs mt-2"
        >
          <FileText size={11} aria-hidden />
          {evidenceCount} protocol {evidenceCount === 1 ? 'source' : 'sources'}
        </p>
      )}

      {/* v1 sync always writes NULL (Decision 1) — keep the branch tiny */}
      {card.suggested_window !== null && (
        <p className="text-fg-sub text-xs mt-2">
          Suggested window: {formatWindowEdge(card.suggested_window.start_iso)} –{' '}
          {formatWindowEdge(card.suggested_window.end_iso)}
        </p>
      )}

      {/* Next action: real link-out, or neutral guidance when none configured */}
      <div className="mt-3">
        {card.external_url_or_template ? (
          <a
            href={card.external_url_or_template}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onFollowLink(card)}
            data-testid="action-card-link"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border ${
              isLight
                ? 'border-[#CBD5E1] text-fg-body hover:bg-[#F8FAFC]'
                : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
            }`}
          >
            {LINK_LABELS[card.external_destination_type]}
            <ExternalLink size={11} aria-hidden />
          </a>
        ) : (
          <p className="text-fg-sub text-xs leading-relaxed">
            {NO_LINK_GUIDANCE[card.external_destination_type]}
          </p>
        )}
      </div>

      {/* Always rendered — planning-support framing, never mandate/booking */}
      <p className="text-fg-muted text-[11px] leading-relaxed mt-3">{card.disclaimer}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Date-only formatter for the (future) suggested window — NaN guard falls
// back to the raw string rather than rendering "Invalid Date".
// ---------------------------------------------------------------------------

function formatWindowEdge(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
