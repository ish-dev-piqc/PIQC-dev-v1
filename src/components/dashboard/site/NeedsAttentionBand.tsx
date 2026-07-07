import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown } from 'lucide-react';
import type { SiteVisit } from '../../../lib/site/types';
import { statusIcon, protoCode } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Needs Attention band
// ────────────────────────────────────────────────────────────────────────────

export interface NeedsAttentionBandProps {
  items: SiteVisit[];
  isLight: boolean;
  isHome: boolean;
  protocols: { id: string; code: string }[];
  onItemClick: (v: SiteVisit) => void;
}

const NEEDS_ATTENTION_ORDER: Record<string, number> = {
  overdue: 0,
  closing_soon: 1,
};

function sortNeedsAttention(items: SiteVisit[]): SiteVisit[] {
  return [...items].sort((a, b) => {
    const sev = (NEEDS_ATTENTION_ORDER[a.status] ?? 99) - (NEEDS_ATTENTION_ORDER[b.status] ?? 99);
    if (sev !== 0) return sev;
    // Within severity, soonest-closing first
    const ac = a.windowCloses ? new Date(a.windowCloses).getTime() : Infinity;
    const bc = b.windowCloses ? new Date(b.windowCloses).getTime() : Infinity;
    return ac - bc;
  });
}

const INLINE_CAP = 2;

export function NeedsAttentionBand({ items, isLight, isHome, protocols, onItemClick }: NeedsAttentionBandProps) {
  const [popoverMode, setPopoverMode] = useState<'all' | 'overflow' | null>(null);
  const popoverOpen = popoverMode !== null;
  const popoverRef = useRef<HTMLDivElement>(null);
  const wideToggleRef = useRef<HTMLButtonElement>(null);
  const narrowToggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inPopover = popoverRef.current?.contains(target) ?? false;
      const onWide = wideToggleRef.current?.contains(target) ?? false;
      const onNarrow = narrowToggleRef.current?.contains(target) ?? false;
      if (!inPopover && !onWide && !onNarrow) setPopoverMode(null);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopoverMode(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [popoverOpen]);

  const sorted = sortNeedsAttention(items);
  const inline = sorted.slice(0, INLINE_CAP);
  const overflow = sorted.slice(INLINE_CAP);
  const popoverItems = popoverMode === 'all' ? sorted : overflow;

  const overdueCount = sorted.filter((v) => v.status === 'overdue').length;
  const closingCount = sorted.filter((v) => v.status === 'closing_soon').length;
  const summaryParts: string[] = [];
  if (overdueCount > 0) summaryParts.push(`${overdueCount} overdue`);
  if (closingCount > 0) summaryParts.push(`${closingCount} closing soon`);
  const summary = summaryParts.join(' · ');

  const bandBg = isLight
    ? 'bg-amber-50 border-amber-200/80'
    : 'bg-amber-500/[0.04] border-amber-500/15';
  const labelColor = isLight ? 'text-amber-700' : 'text-amber-400';
  const textColor = isLight ? 'text-[#0F172A]/85' : 'text-[#CBD5E1]/85';
  const mutedColor = 'text-fg-muted';
  const popoverBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const rowHover = isLight ? 'hover:bg-[#F8FAFC]' : 'hover:bg-white/[0.03]';
  const moreChip = isLight
    ? 'bg-amber-100/60 border-amber-300/60 text-amber-800 hover:bg-amber-100'
    : 'bg-amber-500/[0.08] border-amber-500/25 text-amber-300 hover:bg-amber-500/[0.12]';

  const renderItemInline = (v: SiteVisit) => (
    <button
      key={v.id}
      type="button"
      onClick={() => onItemClick(v)}
      className={`flex-shrink-0 inline-flex items-center gap-2 text-xs ${textColor} hover:underline min-w-0`}
    >
      {statusIcon(v.status, 12)}
      {isHome && (
        <span className={`${mutedColor} font-medium`}>{protoCode(v.protocolId, protocols)}</span>
      )}
      <span className="font-medium">{v.participantId}</span>
      <span className={mutedColor}>·</span>
      <span className="truncate max-w-[180px]">{v.visitName}</span>
      {v.windowCloses && (
        <span className={v.status === 'closing_soon' ? 'text-amber-600 font-medium' : mutedColor}>
          · closes {relativeClose(v.windowCloses)}
        </span>
      )}
    </button>
  );

  const renderItemPopover = (v: SiteVisit) => (
    <button
      key={v.id}
      type="button"
      onClick={() => {
        setPopoverMode(null);
        onItemClick(v);
      }}
      className={`w-full text-left px-3 py-2.5 ${rowHover} flex items-start gap-2 transition-colors`}
    >
      <span className="flex-shrink-0 mt-0.5">{statusIcon(v.status, 12)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isHome && (
            <span className={`${mutedColor} text-[11px] font-medium`}>{protoCode(v.protocolId, protocols)}</span>
          )}
          <span className={`text-xs font-semibold ${textColor}`}>{v.participantId}</span>
          <span className={`${mutedColor} text-xs`}>·</span>
          <span className={`text-xs ${textColor}`}>{v.visitName}</span>
        </div>
        {v.windowCloses && (
          <div
            className={`text-[11px] mt-0.5 ${
              v.status === 'closing_soon' ? 'text-amber-600 font-medium' : mutedColor
            }`}
          >
            Closes {relativeClose(v.windowCloses)}
          </div>
        )}
      </div>
    </button>
  );

  return (
    <div className={`mx-6 mb-1 border rounded-lg ${bandBg} flex-shrink-0 relative`}>
      {/* Narrow layout: label + count summary (collapses all items) */}
      <button
        ref={narrowToggleRef}
        type="button"
        onClick={() => setPopoverMode((m) => (m === 'all' ? null : 'all'))}
        aria-expanded={popoverMode === 'all'}
        className={`md:hidden w-full px-3 py-2 flex items-center gap-2 text-left`}
      >
        <span className={`inline-flex items-center gap-1.5 ${labelColor} flex-shrink-0`}>
          <AlertCircle size={13} />
          <span className="text-[11px] uppercase tracking-wider font-semibold">Needs attention</span>
        </span>
        <span className={`text-xs font-medium ${textColor} truncate flex-1`}>{summary}</span>
        <ChevronDown
          size={13}
          className={`flex-shrink-0 ${labelColor} transition-transform ${
            popoverMode === 'all' ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Wide layout: inline top N + +more chip */}
      <div className="hidden md:flex px-3 py-2 items-center gap-3 min-w-0">
        <div className={`flex-shrink-0 inline-flex items-center gap-1.5 ${labelColor}`}>
          <AlertCircle size={13} />
          <span className="text-[11px] uppercase tracking-wider font-semibold">Needs attention</span>
        </div>
        <div className="flex-1 flex items-center gap-4 min-w-0">{inline.map(renderItemInline)}</div>
        {overflow.length > 0 && (
          <button
            ref={wideToggleRef}
            type="button"
            onClick={() => setPopoverMode((m) => (m === 'overflow' ? null : 'overflow'))}
            className={`flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md border ${moreChip} transition-colors`}
            aria-expanded={popoverMode === 'overflow'}
          >
            +{overflow.length} more
            <ChevronDown
              size={11}
              className={`transition-transform ${popoverMode === 'overflow' ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {popoverOpen && popoverItems.length > 0 && (
        <div
          ref={popoverRef}
          className={`absolute right-3 left-3 md:left-auto top-full mt-1 md:w-80 max-w-[calc(100vw-2rem)] z-30 border rounded-lg shadow-lg ${popoverBg} overflow-hidden`}
        >
          <div className={`px-3 py-2 border-b ${isLight ? 'border-[#F2F2F2]' : 'border-white/5'}`}>
            <div className={`text-[11px] uppercase tracking-wider font-semibold ${labelColor}`}>
              {popoverMode === 'all'
                ? `${popoverItems.length} ${popoverItems.length === 1 ? 'item' : 'items'}`
                : `${popoverItems.length} more ${popoverItems.length === 1 ? 'item' : 'items'}`}
            </div>
          </div>
          <div className={`max-h-80 overflow-y-auto divide-y ${isLight ? 'divide-[#F2F2F2]' : 'divide-white/[0.03]'}`}>
            {popoverItems.map(renderItemPopover)}
          </div>
        </div>
      )}
    </div>
  );
}

function relativeClose(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMin = Math.round((target.getTime() - now.getTime()) / 60000);
  if (diffMin < 0) return `${Math.abs(Math.round(diffMin / 60))}h ago`;
  if (diffMin < 60) return `in ${diffMin}m`;
  const hours = Math.round(diffMin / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}
