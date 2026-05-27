import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Loader2, History, AlertTriangle, ArrowRight } from 'lucide-react';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import { useTheme } from '../../../context/ThemeContext';
import { fetchHumanEditLog } from '../../../lib/visit-execution/visitExecutionApi';
import type {
  VisitExecutionItem,
  VisitRequirementHumanEditAction,
  VisitRequirementHumanEditEvent,
} from '../../../types/visit-execution';

// =============================================================================
// EditLogDrawer — Sprint 4c.
//
// Read-only right-edge drawer showing the chronological human-edit history
// for one visit_requirements row. Reuses the useOverlay + max-w-md panel
// pattern from RequirementTextDrawer (Sprint 4b) and TraceabilityDrawer
// (Sprint 1).
//
// Data source: visit_execution_get_human_edit_log RPC (existed since
// Sprint 2.5; Sprint 4c is the first frontend consumer). Loads on open.
//
// Event rendering, per action:
//
//   edit_text           — shows previous_text → new_text with an arrow.
//                          Most informative for the audit story.
//   add_site_note       — shows the reviewer_note as the body.
//   mark_reviewed       \
//   unmark_reviewed      \  Single-line status change. Reviewer_note shown
//   flag_for_review      /  on a second line when present.
//   mark_needs_clarif…  /
//
// All events show actor (reviewer_id placeholder), timestamp, and the
// requirement_version at the time of the action so coordinators can map
// events to a specific edit_text bump in the row's history.
// =============================================================================

interface Props {
  item: VisitExecutionItem | null;
  /**
   * The currently-authenticated user's id. Used solely to render "You" on
   * an event's reviewer line instead of the raw UUID. Null is acceptable
   * (e.g. demo / signed-out states) — the reviewer line is omitted in that
   * case rather than showing a meaningless hex. Display-name lookup for
   * non-self reviewers is a future enhancement.
   */
  currentUserId: string | null;
  onClose: () => void;
}

function actionLabel(a: VisitRequirementHumanEditAction): string {
  switch (a) {
    case 'mark_reviewed':            return 'Marked reviewed';
    case 'unmark_reviewed':          return 'Unmarked reviewed';
    case 'edit_text':                return 'Edited text';
    case 'add_site_note':            return 'Added site note';
    case 'flag_for_review':          return 'Flagged for review';
    case 'mark_needs_clarification': return 'Marked needs clarification';
  }
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    // Catch is the belt-and-suspenders fallback; the NaN check above is the
    // primary guard. Either way, don't surface a raw broken ISO to the user.
    return '—';
  }
}

export default function EditLogDrawer({ item, currentUserId, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [events, setEvents] = useState<VisitRequirementHumanEditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Stable close — useOverlay has onClose in its deps; an inline arrow
  // would churn the focus-trap setup. Sprint 4b's lesson is durable.
  const guardedClose = useCallback(() => onClose(), [onClose]);

  useOverlay({
    isOpen: item !== null,
    onClose: guardedClose,
    containerRef: panelRef,
  });
  const swipe = useSwipeDismiss({ onClose: guardedClose });

  // Load on open; clear on close. cancelled-flag pattern from
  // VisitExecutionTab.useEffect → fetchVisitExecutionWorkspaces.
  useEffect(() => {
    if (!item) {
      setEvents([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setEvents([]);
    fetchHumanEditLog(item.id).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setLoadError(r.error);
        return;
      }
      setEvents(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  if (!item) return null;

  return (
    <div
      data-testid="vew-edit-log-drawer"
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit history for ${item.label}`}
    >
      <div
        data-testid="vew-edit-log-backdrop"
        className="absolute inset-0 bg-black/40"
        onClick={guardedClose}
      />

      <div
        ref={panelRef}
        {...swipe}
        className={`relative w-full max-w-md h-full flex flex-col shadow-xl border-l ${
          isLight ? 'bg-[#f5f7fa] border-[#e2e8ee]' : 'bg-[#0d1118] border-white/5'
        }`}
      >
        {/* Header */}
        <div
          className={`sticky top-0 z-10 backdrop-blur px-5 py-3.5 border-b flex items-start justify-between gap-3 ${
            isLight
              ? 'bg-[#f5f7fa]/95 border-[#e2e8ee]'
              : 'bg-[#0d1118]/95 border-white/5'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex items-center gap-1.5">
              <History size={11} aria-hidden />
              Edit history
            </p>
            <h2 className="text-fg-heading text-sm font-semibold truncate mt-0.5">
              {item.label}
            </h2>
          </div>
          <button
            type="button"
            onClick={guardedClose}
            aria-label="Close drawer"
            className={`flex items-center justify-center w-7 h-7 rounded-md flex-shrink-0 ${
              isLight
                ? 'text-fg-sub hover:bg-[#e2e8ee] hover:text-fg-body'
                : 'text-fg-sub hover:bg-white/[0.06] hover:text-fg-body'
            }`}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-fg-sub text-xs">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Loading edit history…
            </div>
          )}

          {loadError && (
            <div
              role="alert"
              data-testid="vew-edit-log-error"
              className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
                isLight
                  ? 'bg-[#fdecec] border-[#f3c7c7] text-[#742a2a]'
                  : 'bg-[#3b1f1f] border-[#5a2e2e] text-[#f5b8b8]'
              }`}
            >
              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
              <span className="flex-1 leading-relaxed">
                Couldn't load edit history: {loadError}
              </span>
            </div>
          )}

          {!loading && !loadError && events.length === 0 && (
            <p className="text-fg-sub text-xs leading-relaxed">
              No edits yet. Once someone marks this requirement reviewed,
              flags it, or rewrites the text, those actions will appear here
              with timestamps for the audit trail.
            </p>
          )}

          {events.length > 0 && (
            <ol className="space-y-3" role="list">
              {events.map((event) => {
                // 'You' tag — only when the current user matches. We deliberately
                // do NOT show truncated UUIDs for other reviewers: a hex hash
                // tells coordinators nothing they can act on, and reads as a
                // leak of an internal token. Display-name lookup is a future
                // follow-up that joins auth.users + a profile table.
                const isSelf =
                  currentUserId !== null && event.reviewer_id === currentUserId;
                // Version is only meaningful on edit_text — the column increments
                // on that action only, so rendering "v1" on a mark_reviewed row
                // is misleading noise.
                const showVersion = event.action === 'edit_text';

                return (
                <li
                  key={event.id}
                  data-testid="vew-edit-log-event"
                  data-action={event.action}
                  className={`rounded-md border px-3 py-2.5 ${
                    isLight
                      ? 'bg-white border-[#e2e8ee]'
                      : 'bg-white/[0.02] border-white/5'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-fg-heading text-xs font-semibold leading-tight">
                      {actionLabel(event.action)}
                    </p>
                    {showVersion && (
                      <span
                        className="text-fg-muted text-[10px] flex-shrink-0"
                        data-testid="vew-edit-log-version"
                      >
                        v{event.requirement_version}
                      </span>
                    )}
                  </div>
                  <p className="text-fg-muted text-[10px] mt-0.5">
                    {formatTimestamp(event.created_at)}
                    {isSelf && (
                      <>
                        {' · '}
                        <span data-testid="vew-edit-log-self">You</span>
                      </>
                    )}
                  </p>

                  {event.action === 'edit_text' &&
                    event.previous_text !== null &&
                    event.new_text !== null && (
                      <div className="mt-2 space-y-1.5">
                        <div>
                          <p className="text-fg-label text-[9px] uppercase tracking-wider font-semibold mb-0.5">
                            Before
                          </p>
                          <p className="text-fg-sub text-xs leading-snug line-through">
                            {event.previous_text}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 text-fg-muted text-[10px]">
                          <ArrowRight size={9} aria-hidden />
                          <span className="text-fg-label text-[9px] uppercase tracking-wider font-semibold">
                            After
                          </span>
                        </div>
                        <p className="text-fg-body text-xs leading-snug">
                          {event.new_text}
                        </p>
                      </div>
                    )}

                  {event.action === 'add_site_note' && event.reviewer_note && (
                    <div className="mt-2">
                      <p className="text-fg-label text-[9px] uppercase tracking-wider font-semibold mb-0.5">
                        Note
                      </p>
                      <p className="text-fg-body text-xs leading-snug whitespace-pre-wrap">
                        {event.reviewer_note}
                      </p>
                    </div>
                  )}

                  {event.action !== 'add_site_note' &&
                    event.action !== 'edit_text' &&
                    event.reviewer_note && (
                      <p className="text-fg-sub text-xs italic mt-1.5 leading-snug">
                        “{event.reviewer_note}”
                      </p>
                    )}

                  {event.amendment_version && (
                    <p className="text-fg-muted text-[10px] mt-1.5">
                      During {event.amendment_version}
                    </p>
                  )}
                </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
