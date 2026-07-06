import { useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '../../../../context/ThemeContext';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverablePortfolioEntry,
} from '../../../../types/deliverables';
import { fetchDeliverablePortfolio } from '../../../../lib/deliverables/deliverablesApi';

// =============================================================================
// DeliverablePortfolioGrid — the Sponsor Protocol Intelligence tab's protocol
// picker, upgraded into a portfolio digest: one card per protocol showing its
// deliverable coverage (X/5 drafted) + open-review backlog + last activity, so
// a sponsor sees where attention is needed across protocols before drilling in.
// Clicking a card selects that protocol (same selection the old <select> drove).
//
// The protocol LIST (id/code/name) comes from the caller (ProtocolContext); the
// per-protocol deliverable STATS come from deliverable_portfolio_summary, which
// only returns protocols that have deliverables — the rest read "Not started".
//
// Data flow (ActionCardRail precedent): self-fetch on mount, token-guarded,
// SILENT degrade. The stats are a pure enhancement — every card still renders
// and still selects even if the RPC errors or isn't deployed, so the grid never
// stops being a working picker.
//
// Sponsor-only (portfolio oversight is a sponsor concept); the CRA workspace
// keeps its simple protocol picker. Accent is the Sponsor purple.
// =============================================================================

interface Props {
  /** The workspace's protocols (from ProtocolContext). */
  protocols: ReadonlyArray<{ id: string; code: string | null; name: string }>;
  activeProtocolId: string | null;
  onSelect: (protocolId: string) => void;
}

/** Total artifact types (denominator for "X/5 drafted"). Derived from the label
 *  map so it stays correct if a sixth type lands. */
const TOTAL_ARTIFACT_TYPES = Object.keys(ARTIFACT_TYPE_LABELS).length;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function DeliverablePortfolioGrid({ protocols, activeProtocolId, onSelect }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const accentFg = isLight ? '#534AB7' : '#7F77DD';

  const [entries, setEntries] = useState<DeliverablePortfolioEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const fetchTokenRef = useRef(0);

  const load = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const result = await fetchDeliverablePortfolio();
    if (token !== fetchTokenRef.current) return;
    if (!result.ok) {
      // Degrade silently: the grid stays a working picker without the stats.
      setStatus('error');
      return;
    }
    setEntries(result.data);
    setStatus('ready');
  }, []);

  useEffect(() => {
    setStatus('loading');
    void load();
  }, [load]);

  const byProtocol = new Map<string, DeliverablePortfolioEntry>();
  for (const e of entries) byProtocol.set(e.protocol_id, e);

  const cardBase = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10';

  return (
    <div>
      <p className="text-fg-label text-[10px] uppercase tracking-wider font-semibold mb-2">
        Protocol
      </p>
      <div
        role="tablist"
        aria-label="Protocols"
        data-testid="protocol-intelligence-portfolio"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
      >
        {protocols.map((p) => {
          const entry = byProtocol.get(p.id);
          const active = p.id === activeProtocolId;
          const drafted = entry?.deliverable_count ?? 0;
          const needsReview = entry?.needs_review_blocks ?? 0;

          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(p.id)}
              data-testid={`portfolio-card-${p.id}`}
              className={`text-left rounded-xl border p-3 transition-colors focus:outline-none focus:ring-2 ${cardBase} ${
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
                  {p.code ?? p.name}
                </span>
                {active && (
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: accentFg }}
                    aria-hidden
                  />
                )}
              </div>
              {p.code && (
                <p className="text-fg-sub text-[11px] mt-0.5 truncate">{p.name}</p>
              )}

              {entry ? (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span className="text-fg-sub text-[11px]">
                    {drafted}/{TOTAL_ARTIFACT_TYPES} drafted
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
                  {entry.last_generated_at && (
                    <span className="text-fg-muted text-[10px]">
                      Updated {formatDate(entry.last_generated_at)}
                    </span>
                  )}
                </div>
              ) : (
                <p className="text-fg-muted text-[11px] mt-2">
                  {status === 'ready' ? 'Not started' : ' '}
                </p>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
