import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
  type DeliverableSummary,
} from '../../types/deliverables';
import { fetchDeliverableSummaries } from '../../lib/deliverables/deliverablesApi';

// =============================================================================
// DeliverablesOverview — the protocol's deliverable status board, and the
// selector for which deliverable the panel shows. One clickable card per
// configured artifact type: the card is a tab (onSelectType), and when the
// deliverable has been generated it overlays review status (generated date +
// a reviewed/total progress bar + a "N need review" chip). Ungenerated types
// read "Not generated yet"; clicking one selects it so the panel offers its
// Generate CTA.
//
// Shared, non-mode: both the Sponsor Protocol Intelligence tab and the CRA
// workspace mount this, each passing its own accent + artifact order (the same
// "config over Layer B" reuse as DeliverablePanel).
//
// Data flow (ActionCardRail precedent): the board owns its fetch — fetch on
// mount + whenever refreshKey changes (the parent passes the active type, so
// switching/generating re-syncs the counts), a monotonic token so only the
// latest fetch applies, and SILENT degrade. CRITICAL: the counts are a pure
// enhancement — if the summary RPC errors or isn't deployed yet, every card
// still renders and still selects, so the board never breaks the surface.
//
// SENSITIVE: the summary carries no block text — counts and timestamps only.
// =============================================================================

interface Props {
  protocolId: string;
  /** Artifact types to show, in display order (the surface's picker order). */
  artifactTypes: readonly DeliverableArtifactType[];
  activeType: DeliverableArtifactType;
  onSelectType: (type: DeliverableArtifactType) => void;
  /** Theme-resolved accent (active-card ring + progress fill). */
  accentFg: string;
  /** Opaque change token — any change re-runs the fetch (parent passes the
   *  active type, so a generate-then-switch refreshes the counts). */
  refreshKey: string | number;
}

type LoadStatus = 'loading' | 'ready' | 'error';

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function DeliverablesOverview({
  protocolId,
  artifactTypes,
  activeType,
  onSelectType,
  accentFg,
  refreshKey,
}: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [summaries, setSummaries] = useState<DeliverableSummary[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');

  // Monotonic token: only the latest fetch applies its result (SiteDataContext
  // pattern — guards rapid protocol/refreshKey changes).
  const fetchTokenRef = useRef(0);
  // Drop the previous protocol's summaries immediately on a protocol switch so
  // stale counts never bleed across protocols while the new fetch runs.
  const lastProtocolRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const result = await fetchDeliverableSummaries(protocolId);
    if (token !== fetchTokenRef.current) return;
    if (!result.ok) {
      // Degrade silently: keep the board a working selector, just without the
      // status overlay. Never surface an error banner on this ambient board.
      setStatus('error');
      return;
    }
    setSummaries(result.data);
    setStatus('ready');
  }, [protocolId]);

  useEffect(() => {
    if (lastProtocolRef.current !== protocolId) {
      lastProtocolRef.current = protocolId;
      setSummaries([]);
    }
    setStatus('loading');
    void load();
  }, [protocolId, refreshKey, load]);

  const byType = new Map<DeliverableArtifactType, DeliverableSummary>();
  for (const s of summaries) byType.set(s.artifact_type, s);

  const cardBase = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10';
  const trackBg = isLight ? 'bg-[#E2E8F0]' : 'bg-white/10';

  return (
    <div
      role="tablist"
      aria-label="Deliverables"
      data-testid="deliverables-overview"
      className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
    >
      {artifactTypes.map((type) => {
        const summary = byType.get(type);
        const active = type === activeType;
        const total = summary?.total_blocks ?? 0;
        const reviewed = summary?.reviewed_blocks ?? 0;
        const needsReview = summary?.needs_review_blocks ?? 0;
        const pct = total > 0 ? Math.round((reviewed / total) * 100) : 0;

        return (
          <button
            key={type}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelectType(type)}
            data-testid={`deliverables-overview-card-${type}`}
            className={`text-left rounded-xl border p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 ${cardBase} ${
              isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.03]'
            }`}
            style={
              active
                ? { borderColor: accentFg, boxShadow: `inset 0 0 0 1px ${accentFg}` }
                : undefined
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-fg-heading text-sm font-semibold truncate">
                {ARTIFACT_TYPE_LABELS[type]}
              </span>
              {active && (
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accentFg }}
                  aria-hidden
                />
              )}
            </div>

            {summary ? (
              <>
                <p className="text-fg-muted text-[11px] mt-0.5">
                  Generated {formatDate(summary.generated_at)}
                  {summary.protocol_version ? ` · v${summary.protocol_version}` : ''}
                </p>
                {/* Reviewed/total progress — the fill uses the surface accent. */}
                <div
                  className={`mt-2 h-1.5 w-full rounded-full overflow-hidden ${trackBg}`}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${reviewed} of ${total} reviewed`}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: accentFg }}
                  />
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="text-fg-sub text-[11px]">
                    {reviewed}/{total} reviewed
                  </span>
                  {needsReview > 0 && (
                    <span
                      className={`inline-flex items-center font-semibold rounded-md border text-[10px] px-1.5 py-0.5 ${
                        isLight
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                      }`}
                    >
                      {needsReview} need review
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-fg-muted text-[11px] mt-0.5">
                {status === 'ready' ? 'Not generated yet' : ' '}
              </p>
            )}
          </button>
        );
      })}
    </div>
  );
}
