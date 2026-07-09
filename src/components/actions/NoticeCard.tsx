import {
  CalendarClock,
  Eye,
  FileText,
  GitPullRequestArrow,
  HelpCircle,
  Target,
  X,
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import type { NoticeRecord, NoticeType } from '../../types/actions';

// =============================================================================
// NoticeCard — "what PIQC noticed" rendered as a calm observation, NOT a
// handoff. The Action Layer's sibling: headline (what I saw) → detail (the
// deterministic one-sentence observation) → quiet evidence count → dismiss.
//
// Deliberately narrower than ActionCard: no destination chip, no link-out, no
// suggested window, no 'acted' record. A notice is an observation of current
// truth — there is nowhere to "go" and nothing to follow. The only affordance
// beyond reading is one-click dismiss (reversible: the row is preserved
// server-side while its predicate holds).
//
//   - The type icon + "Noticed" label replace the destination chip: it signals
//     provenance ("PIQC observed this"), not a place to act.
//   - Evidence renders as a quiet "N protocol sources" count only — honest
//     count, no link that goes nowhere (same discipline as ActionCard).
//
// Generic actions component (non-mode): pure presentation over the frozen
// NoticeRecord contract — no data access; NoticeRail owns fetching.
// SENSITIVE: detail bodies are never logged.
// =============================================================================

/** Per-type icon. Falls back to the neutral eye when the server emits a kind
 *  this client build predates (taxonomy is server-owned — a new notice_type
 *  must still render, never blank). */
const NOTICE_ICONS: Record<NoticeType, typeof Eye> = {
  tight_visit_window: CalendarClock,
  amendment_in_force: GitPullRequestArrow,
  endpoint_sdv: Target,
  low_confidence_extraction: HelpCircle,
};

function iconFor(noticeType: string): typeof Eye {
  return (NOTICE_ICONS as Record<string, typeof Eye>)[noticeType] ?? Eye;
}

interface Props {
  notice: NoticeRecord;
  /** One-click, reversible — the rail records 'dismissed'. */
  onDismiss: (notice: NoticeRecord) => void;
}

export function NoticeCard({ notice, onDismiss }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const TypeIcon = iconFor(notice.notice_type);
  const evidenceCount = notice.protocol_evidence_ids.length;

  return (
    <div
      data-testid="notice-card"
      data-notice-type={notice.notice_type}
      className={`rounded-xl border px-4 py-4 ${
        isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
      }`}
    >
      {/* Header: provenance chip + headline + one-click dismiss */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
          <span
            title="Something PIQC observed in this protocol — an observation, not an instruction. Nothing has been changed."
            className={`inline-flex items-center gap-1 font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 text-fg-sub bg-transparent flex-shrink-0 ${
              isLight ? 'border-[#CBD5E1]' : 'border-white/15'
            }`}
          >
            <TypeIcon size={10} aria-hidden />
            Noticed
          </span>
          <h3 className="text-fg-heading text-sm font-semibold">{notice.headline}</h3>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(notice)}
          aria-label="Dismiss notice"
          title="Hides this notice. It is preserved and resurfaces if the underlying facts change."
          data-testid="notice-card-dismiss"
          className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md text-fg-sub ${
            isLight
              ? 'hover:bg-[#E2E8F0] hover:text-fg-body'
              : 'hover:bg-white/[0.06] hover:text-fg-body'
          }`}
        >
          <X size={14} aria-hidden />
        </button>
      </div>

      {/* The observation — deterministic prose from real counts only */}
      <p className="text-fg-body text-sm leading-relaxed mt-2">{notice.detail}</p>

      {/* Quiet evidence count — no link; drilldown is a follow-up */}
      {evidenceCount > 0 && (
        <p
          title={`Observed from ${evidenceCount} cited protocol ${
            evidenceCount === 1 ? 'fact' : 'facts'
          }`}
          className="flex items-center gap-1 text-fg-sub text-xs mt-2"
        >
          <FileText size={11} aria-hidden />
          {evidenceCount} protocol {evidenceCount === 1 ? 'source' : 'sources'}
        </p>
      )}
    </div>
  );
}
