import { useEffect, useMemo, useRef, useState } from 'react';
import { X, GitBranch, History, Search } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import type { AuditWithContext } from '../../../context/AuditContext';
import { useOverlay } from '../../../hooks/useOverlay';
import { fetchAuditLineage } from '../../../lib/audit/lineageApi';
import {
  nodeDepth,
  type LineageEntityType,
  type LineageGraph,
  type LineageNode,
} from '../../../lib/audit/lineageAdapter';
import HistoryDrawer from './HistoryDrawer';

// =============================================================================
// TraceabilityDrawer — the audit's seed→tree lineage, in one surface.
//
// Answers "where did this record come from, and what does it feed?" without
// leaving the workspace: an SVG mini-map (structure at a glance) above an
// indented tree (the detail), every node carrying status, an origin line that
// teaches provenance, cross-link chips (mapping→risk, finding→risk/mapping,
// PIQC-prefill→source), and one-click state history via the existing
// HistoryDrawer. Read-only — this surface never mutates.
//
// Fetches on open via lineageApi (same pattern as RiskSummaryPanel): the
// drawer must reflect the DB truth regardless of which stages have hydrated
// AuditDataContext this session.
// =============================================================================

interface Props {
  audit: AuditWithContext;
  onClose: () => void;
}

const ENTITY_LABELS: Record<LineageEntityType, string> = {
  AUDITEE: 'Auditee',
  AUDIT: 'Audit',
  PROTOCOL_RISK: 'Protocol risk',
  VENDOR_SERVICE: 'Vendor service',
  SERVICE_MAPPING: 'Service mapping',
  TRUST_ASSESSMENT: 'Trust assessment',
  QUESTIONNAIRE: 'Questionnaire',
  RISK_SUMMARY: 'Risk summary',
  CONFIRMATION_LETTER: 'Confirmation letter',
  AGENDA: 'Agenda',
  CHECKLIST: 'Checklist',
  WORKSPACE_ENTRY: 'Finding / observation',
  REPORT: 'Report',
};

// Filter groups keep the select scannable — 13 raw entity types would be noise.
const FILTER_GROUPS: Array<{ value: string; label: string; types: LineageEntityType[] }> = [
  { value: 'ALL', label: 'All records', types: [] },
  { value: 'RISKS', label: 'Protocol risks', types: ['PROTOCOL_RISK'] },
  {
    value: 'VENDOR',
    label: 'Service & trust',
    types: ['VENDOR_SERVICE', 'SERVICE_MAPPING', 'TRUST_ASSESSMENT'],
  },
  {
    value: 'DELIVERABLES',
    label: 'Deliverables',
    types: ['QUESTIONNAIRE', 'RISK_SUMMARY', 'CONFIRMATION_LETTER', 'AGENDA', 'CHECKLIST', 'REPORT'],
  },
  { value: 'FINDINGS', label: 'Findings & observations', types: ['WORKSPACE_ENTRY'] },
];

// Node fill colors for the SVG mini-map. Hex constants from the brand palette
// (tailwind.config.js) — SVG attributes can't use Tailwind classes. The seed is
// PIQC blue (the suite's sibling anchor) so the lineage root reads as "before
// the audit"; audit-scoped nodes are Audit-Mode teal.
const SVG_COLORS = {
  seed: '#1595D1',      // blue-500 — PIQC primary anchor
  approved: '#02BBB8',  // teal-600 — Audit Mode CTA
  attention: '#F59E0B', // amber-500 — semantic warning
  neutral: '#94A3B8',   // slate-400
};

export default function TraceabilityDrawer({ audit, onClose }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';
  const panelRef = useRef<HTMLDivElement>(null);

  const [graph, setGraph] = useState<LineageGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('ALL');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyNode, setHistoryNode] = useState<LineageNode | null>(null);

  // Suspend this drawer's ESC/focus-trap while the stacked HistoryDrawer is
  // open — useOverlay tears its document listener down when isOpen is false,
  // so ESC dismisses only the topmost layer (history first, traceability
  // second) instead of collapsing the whole stack in one press.
  useOverlay({ isOpen: historyNode === null, onClose, containerRef: panelRef });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchAuditLineage(audit);
      if (cancelled) return;
      if (result.ok) {
        setGraph(result.data);
        // Auto-select the seed: its origin line ("every record below traces
        // back here") teaches BOTH the seed concept and the row-select
        // interaction on first open — no extra chrome needed.
        setSelectedId(result.data.seedId);
      } else {
        setError(result.error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [audit]);

  // ---- Filtering: keep matching nodes PLUS their ancestor path to the seed,
  // so lineage is always visible (a filtered node never floats context-free).
  const visibleIds = useMemo(() => {
    if (!graph) return new Set<string>();
    const groupTypes = FILTER_GROUPS.find((g) => g.value === filter)?.types ?? [];
    const q = query.trim().toLowerCase();
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const matches = graph.nodes.filter((n) => {
      if (groupTypes.length > 0 && !groupTypes.includes(n.entityType)) return false;
      if (q && !n.title.toLowerCase().includes(q)) return false;
      return true;
    });
    const keep = new Set<string>();
    for (const m of matches) {
      let cur: LineageNode | undefined = m;
      while (cur && !keep.has(cur.id)) {
        keep.add(cur.id);
        cur = cur.parentId ? byId.get(cur.parentId) : undefined;
      }
    }
    return keep;
  }, [graph, filter, query]);

  const headingColor = 'text-fg-heading';
  const subColor = 'text-fg-sub';
  const mutedColor = 'text-fg-muted';
  const sectionHeader = 'text-fg-label';
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const inputStyles = isLight
    ? 'bg-white border-[#CBD5E1] focus:border-brand-600'
    : 'bg-[#0F172A] border-white/15 focus:border-brand-300';

  const statusChip = (tone: LineageNode['statusTone']): string => {
    switch (tone) {
      case 'approved':
        return isLight
          ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
          : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
      case 'attention':
        return isLight
          ? 'bg-amber-50 border-amber-200 text-amber-700'
          : 'bg-amber-500/15 border-amber-500/30 text-amber-300';
      default:
        return isLight
          ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/65'
          : 'bg-white/[0.06] border-white/10 text-[#CBD5E1]/55';
    }
  };

  return (
    <div
      data-testid="traceability-drawer"
      className="fixed inset-0 z-40 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Audit traceability"
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        ref={panelRef}
        className={`relative w-full max-w-2xl h-full overflow-y-auto shadow-xl border-l ${
          isLight ? 'bg-[#F8FAFC] border-[#E2E8F0]' : 'bg-[#020617] border-white/5'
        }`}
      >
        {/* Header */}
        <div
          className={`sticky top-0 z-10 px-5 py-3.5 border-b backdrop-blur ${
            isLight ? 'bg-[#F8FAFC]/95 border-[#E2E8F0]' : 'bg-[#020617]/95 border-white/5'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className={`${sectionHeader} text-[10px] uppercase tracking-wider font-semibold`}>
                Traceability
              </p>
              <h2 className={`${headingColor} text-sm font-semibold mt-0.5 truncate`}>
                {audit.audit_name}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className={`inline-flex items-center justify-center w-7 h-7 rounded-md ${mutedColor} hover:bg-[#E2E8F0] dark:hover:bg-white/[0.06]`}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className={`${subColor} text-xs`}>
            Every record in this audit, traced back to its seed. Reference links show what a
            record cites; provenance links show what PIQC drafted it from.
          </p>

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by record type"
              className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${inputStyles} ${headingColor} focus:outline-none`}
            >
              {FILTER_GROUPS.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
            <div className="relative flex-1 min-w-[140px]">
              <Search size={12} className={`absolute left-2.5 top-1/2 -translate-y-1/2 ${mutedColor}`} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search records…"
                aria-label="Search records"
                className={`w-full rounded-md border pl-7 pr-2.5 py-1.5 text-xs ${inputStyles} ${headingColor} focus:outline-none`}
              />
            </div>
          </div>

          {/* Body */}
          {error && (
            <div
              role="alert"
              className={`rounded-md border px-3 py-2 text-sm ${
                isLight
                  ? 'bg-rose-50 border-rose-200 text-rose-700'
                  : 'bg-rose-500/[0.08] border-rose-500/30 text-rose-300'
              }`}
            >
              {error}
            </div>
          )}

          {!graph && !error && (
            <div className="flex items-center justify-center py-16">
              <div className="w-5 h-5 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {graph && (
            <>
              <LineageMiniMap
                graph={graph}
                visibleIds={visibleIds}
                selectedId={selectedId}
                onSelect={setSelectedId}
                isLight={isLight}
              />

              <div className={`${cardBg} border rounded-xl px-3 py-2`}>
                <LineageTree
                  graph={graph}
                  parentId={null}
                  visibleIds={visibleIds}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onHistory={setHistoryNode}
                  statusChip={statusChip}
                  isLight={isLight}
                  depth={0}
                />
                {graph.nodes.length === 2 && (
                  <p className={`${subColor} text-xs px-2 py-3`}>
                    Just the seed and the audit so far — records appear here as each stage
                    produces them.
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Per-node state history — reuses the existing drawer + RLS-scoped RPC. */}
      {historyNode?.trackedObjectType && (
        <HistoryDrawer
          objectType={historyNode.trackedObjectType}
          objectId={historyNode.objectId}
          title={`History — ${historyNode.title}`}
          subTitle={ENTITY_LABELS[historyNode.entityType]}
          onClose={() => setHistoryNode(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// LineageTree — recursive indented tree. Only renders nodes in visibleIds
// (matches + their ancestor paths), so filters prune without orphaning.
// =============================================================================
interface TreeProps {
  graph: LineageGraph;
  parentId: string | null;
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHistory: (node: LineageNode) => void;
  statusChip: (tone: LineageNode['statusTone']) => string;
  isLight: boolean;
  depth: number;
}

function LineageTree({
  graph, parentId, visibleIds, selectedId, onSelect, onHistory, statusChip, isLight, depth,
}: TreeProps) {
  const nodes = graph.nodes.filter((n) => n.parentId === parentId && visibleIds.has(n.id));
  if (nodes.length === 0) return null;

  return (
    <ul className={depth > 0 ? `ml-4 pl-3 border-l ${isLight ? 'border-[#E2E8F0]' : 'border-white/10'}` : ''}>
      {nodes.map((node) => {
        const outbound = graph.edges.filter((e) => e.fromId === node.id);
        const isSeed = node.entityType === 'AUDITEE';
        const isSelected = node.id === selectedId;
        return (
          <li key={node.id} className="py-1">
            <div
              className={`group rounded-md px-2 py-1.5 transition-colors ${
                isSelected
                  ? isLight ? 'bg-brand-600/10' : 'bg-brand-600/15'
                  : isLight ? 'hover:bg-[#0F172A]/[0.03]' : 'hover:bg-white/[0.03]'
              }`}
            >
              {/* Select and history are SIBLING buttons — interactive content
                  may not nest inside a <button>, and screen readers flatten
                  nested controls. */}
              <div className="flex items-center gap-2 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect(node.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    {/* Node dot — seed is PIQC blue, everything else teal-family */}
                    <span
                      aria-hidden
                      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: isSeed
                          ? SVG_COLORS.seed
                          : SVG_COLORS[node.statusTone],
                      }}
                    />
                    <span className={`text-[10px] uppercase tracking-wider font-semibold flex-shrink-0 ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/40'}`}>
                      {node.stage ? `Stage ${node.stage}` : ENTITY_LABELS[node.entityType]}
                    </span>
                    <span className="text-fg-heading text-xs font-medium truncate">
                      {node.title}
                    </span>
                    {node.status && (
                      <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0 ${statusChip(node.statusTone)}`}>
                        {node.status}
                      </span>
                    )}
                    {/* Link-count hint — always visible so the provenance layer
                        is discoverable before the row is ever selected. */}
                    {outbound.length > 0 && (
                      <span className={`text-[10px] flex-shrink-0 ${isLight ? 'text-[#334155]/45' : 'text-[#CBD5E1]/40'}`}>
                        {outbound.length} link{outbound.length > 1 ? 's' : ''}
                      </span>
                    )}
                  </span>
                </button>
                {node.trackedObjectType && (
                  <button
                    type="button"
                    aria-label={`History for ${node.title}`}
                    title="State history"
                    onClick={() => onHistory(node)}
                    className="opacity-40 group-hover:opacity-100 focus:opacity-100 inline-flex items-center justify-center w-5 h-5 rounded flex-shrink-0 text-fg-muted hover:bg-[#E2E8F0] dark:hover:bg-white/[0.08] transition-opacity"
                  >
                    <History size={11} />
                  </button>
                )}
              </div>
              {/* Origin + cross-link chips — the provenance teaching layer */}
              {isSelected && (
                <div className="mt-1 ml-4 space-y-1">
                  <p className="text-fg-sub text-[11px]">{node.origin}</p>
                  {outbound.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {outbound.map((edge) => {
                        const target = graph.nodes.find((n) => n.id === edge.toId);
                        if (!target) return null;
                        return (
                          <button
                            key={`${edge.fromId}-${edge.toId}-${edge.label}`}
                            type="button"
                            onClick={() => onSelect(target.id)}
                            className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border transition-colors ${
                              edge.kind === 'provenance'
                                ? isLight
                                  ? 'bg-brand-600/10 border-brand-600/25 text-brand-600 hover:border-brand-600/50'
                                  : 'bg-brand-600/15 border-brand-300/30 text-brand-300 hover:border-brand-300/50'
                                : isLight
                                  ? 'bg-[#F2F2F2] border-[#CBD5E1] text-[#334155]/70 hover:border-[#94A3B8]'
                                  : 'bg-white/[0.05] border-white/10 text-[#CBD5E1]/60 hover:border-white/25'
                            }`}
                          >
                            <GitBranch size={9} />
                            {edge.label}: {target.title.length > 32 ? `${target.title.slice(0, 32)}…` : target.title}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
            <LineageTree
              graph={graph}
              parentId={node.id}
              visibleIds={visibleIds}
              selectedId={selectedId}
              onSelect={onSelect}
              onHistory={onHistory}
              statusChip={statusChip}
              isLight={isLight}
              depth={depth + 1}
            />
          </li>
        );
      })}
    </ul>
  );
}

// =============================================================================
// LineageMiniMap — the whole graph at a glance. Columns = depth from seed,
// rows = order within a column. Solid lines = lineage (parent→child); dashed
// = reference/provenance edges. Click a node to select it in the tree.
// =============================================================================
interface MiniMapProps {
  graph: LineageGraph;
  visibleIds: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLight: boolean;
}

const COL_W = 118;
const ROW_H = 30;
const NODE_R = 6;

function LineageMiniMap({ graph, visibleIds, selectedId, onSelect, isLight }: MiniMapProps) {
  const layout = useMemo(() => {
    const visible = graph.nodes.filter((n) => visibleIds.has(n.id));
    const cols = new Map<number, LineageNode[]>();
    for (const n of visible) {
      const d = nodeDepth(graph, n);
      const col = cols.get(d) ?? [];
      col.push(n);
      cols.set(d, col);
    }
    const pos = new Map<string, { x: number; y: number }>();
    const maxRows = Math.max(1, ...[...cols.values()].map((c) => c.length));
    for (const [depth, colNodes] of cols) {
      colNodes.forEach((n, i) => {
        pos.set(n.id, {
          x: depth * COL_W + NODE_R + 4,
          // Center sparse columns vertically against the tallest column.
          y: (i + 0.5) * ROW_H + ((maxRows - colNodes.length) * ROW_H) / 2 + 4,
        });
      });
    }
    const width = (Math.max(0, ...[...cols.keys()]) + 1) * COL_W + 8;
    const height = maxRows * ROW_H + 8;
    return { pos, width, height, visible };
  }, [graph, visibleIds]);

  const lineColor = isLight ? '#CBD5E1' : 'rgba(255,255,255,0.18)'; // slate-300 / white-18
  const refColor = isLight ? '#94A3B8' : 'rgba(255,255,255,0.30)';  // slate-400

  return (
    <div
      className={`border rounded-xl ${isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'}`}
      aria-label="Lineage graph"
    >
      {/* Height-capped scroll area — a deep audit (dozens of risks/findings)
          must never push the tree below the fold; the map is orientation,
          the tree is the content. */}
      <div className="overflow-auto max-h-52">
      <svg
        width={layout.width}
        height={layout.height}
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        className="block"
        role="img"
        aria-label="Seed to tree lineage graph — solid lines are lineage, dashed lines are references"
      >
        {/* Lineage edges (parent → child) */}
        {layout.visible.map((n) => {
          if (!n.parentId) return null;
          const from = layout.pos.get(n.parentId);
          const to = layout.pos.get(n.id);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={`t-${n.id}`}
              d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
              fill="none"
              stroke={lineColor}
              strokeWidth={1.2}
            />
          );
        })}
        {/* Reference / provenance edges */}
        {graph.edges.map((e) => {
          const from = layout.pos.get(e.fromId);
          const to = layout.pos.get(e.toId);
          if (!from || !to) return null;
          const midX = (from.x + to.x) / 2;
          return (
            <path
              key={`e-${e.fromId}-${e.toId}-${e.label}`}
              d={`M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`}
              fill="none"
              stroke={refColor}
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          );
        })}
        {/* Nodes */}
        {layout.visible.map((n) => {
          const p = layout.pos.get(n.id);
          if (!p) return null;
          const fill = n.entityType === 'AUDITEE' ? SVG_COLORS.seed : SVG_COLORS[n.statusTone];
          return (
            /* Pointer-click is a bonus affordance; the tree below is the
               keyboard-accessible path, so these stay out of the tab order. */
            <g key={n.id} onClick={() => onSelect(n.id)} className="cursor-pointer">
              <circle
                cx={p.x}
                cy={p.y}
                r={n.id === selectedId ? NODE_R + 2 : NODE_R}
                fill={fill}
                stroke={n.id === selectedId ? fill : 'transparent'}
                strokeOpacity={0.35}
                strokeWidth={4}
              />
              <text
                x={p.x + NODE_R + 5}
                y={p.y + 3.5}
                fontSize={9}
                fill={isLight ? '#475569' : '#94A3B8'} // slate-600 / slate-400
              >
                {n.title.length > 14 ? `${n.title.slice(0, 14)}…` : n.title}
              </text>
              <title>{`${ENTITY_LABELS[n.entityType]} — ${n.title}`}</title>
            </g>
          );
        })}
      </svg>
      </div>
      {/* Legend — teaches the encoding so the map is orientation, not decoration. */}
      <div className={`flex items-center gap-3 flex-wrap px-3 py-1.5 border-t text-[10px] ${
        isLight ? 'border-[#F2F2F2] text-[#334155]/55' : 'border-white/[0.04] text-[#CBD5E1]/45'
      }`}>
        <LegendDot color={SVG_COLORS.seed} label="Seed (auditee)" />
        <LegendDot color={SVG_COLORS.approved} label="Approved" />
        <LegendDot color={SVG_COLORS.attention} label="Needs attention" />
        <LegendDot color={SVG_COLORS.neutral} label="In progress" />
        <span className="inline-flex items-center gap-1">
          <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="1.2" /></svg>
          lineage
        </span>
        <span className="inline-flex items-center gap-1">
          <svg width="18" height="6" aria-hidden><line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="1" strokeDasharray="3 3" /></svg>
          reference / prefill
        </span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span aria-hidden className="inline-block w-2 h-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
