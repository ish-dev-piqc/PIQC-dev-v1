import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { getObjectHistory } from '../../../lib/audit/stateHistory';
import { useOverlay } from '../../../hooks/useOverlay';
import { useSwipeDismiss } from '../../../hooks/useSwipeDismiss';
import type { HistoryEntry, TrackedObjectType } from '../../../types/audit';

// =============================================================================
// HistoryDrawer — per-object change history surfaced from state_history_deltas.
//
// Calls audit_mode_get_object_history via getObjectHistory, renders newest-first.
// Wraps useOverlay (ESC, scroll lock, focus trap) and useSwipeDismiss (mobile).
//
// Props:
//   objectType — TrackedObjectType discriminator (e.g. 'PROTOCOL_RISK_OBJECT')
//   objectId   — UUID of the tracked object
//   title      — drawer heading (e.g. 'Protocol risk')
//   subTitle   — optional secondary label above the heading
//   onClose    — called on ESC, backdrop click, X, or swipe-right
// =============================================================================

interface HistoryDrawerProps {
  objectType: TrackedObjectType;
  objectId: string;
  title: string;
  subTitle?: string;
  onClose: () => void;
}

export default function HistoryDrawer({
  objectType,
  objectId,
  title,
  subTitle,
  onClose,
}: HistoryDrawerProps) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  useOverlay({ isOpen: true, onClose, containerRef: panelRef });
  const swipe = useSwipeDismiss({ onClose });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getObjectHistory(objectType, objectId)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message ?? 'Failed to load history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [objectType, objectId]);

  // ---------------------------------------------------------------------------
  // Theme tokens
  // ---------------------------------------------------------------------------
  const overlay = isLight ? 'bg-black/30' : 'bg-black/50';
  const panelBg = isLight ? 'bg-white border-[#e2e8ee]' : 'bg-[#131a22] border-white/5';
  const headerBorder = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const headingColor = isLight ? 'text-[#1a1f28]' : 'text-white';
  const subColor = isLight ? 'text-[#374152]/55' : 'text-[#d2d7e0]/45';
  const mutedColor = isLight ? 'text-[#374152]/40' : 'text-[#d2d7e0]/35';
  const dividerColor = isLight ? 'border-[#e2e8ee]' : 'border-white/5';
  const fieldFromColor = isLight ? 'text-rose-500/70' : 'text-rose-400/70';
  const fieldToColor = isLight ? 'text-emerald-600' : 'text-emerald-400';
  const skeletonBg = isLight ? 'bg-[#e2e8ee]' : 'bg-white/[0.06]';
  const errorColor = isLight ? 'text-rose-600' : 'text-rose-400';

  return (
    <div
      className={`fixed inset-0 z-50 ${overlay} flex justify-end animate-fade-in`}
      onClick={onClose}
      role="presentation"
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Change history — ${title}`}
        className={`w-full max-w-md h-full ${panelBg} border-l shadow-xl flex flex-col animate-slide-in-right`}
        onClick={(e) => e.stopPropagation()}
        {...swipe}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-4 border-b ${headerBorder} flex-shrink-0`}>
          <div>
            <p className={`text-[11px] uppercase tracking-wider font-semibold ${subColor}`}>
              {subTitle ?? 'Change history'}
            </p>
            <h3 className={`${headingColor} font-semibold text-base mt-0.5`}>{title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={`${subColor} hover:opacity-75 transition-opacity`}
            aria-label="Close history"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading && <LoadingSkeleton skeletonBg={skeletonBg} />}

          {!loading && error && (
            <p className={`text-sm ${errorColor}`}>{error}</p>
          )}

          {!loading && !error && entries.length === 0 && (
            <p className={`text-sm italic ${mutedColor}`}>
              No history recorded yet. Edits, approvals, and stage transitions will appear here.
            </p>
          )}

          {!loading && !error && entries.length > 0 && (
            <ol className="space-y-0">
              {entries.map((entry, i) => (
                <li key={entry.id}>
                  <HistoryEntryRow
                    entry={entry}
                    isLight={isLight}
                    headingColor={headingColor}
                    subColor={subColor}
                    mutedColor={mutedColor}
                    fieldFromColor={fieldFromColor}
                    fieldToColor={fieldToColor}
                  />
                  {i < entries.length - 1 && (
                    <div className={`border-b ${dividerColor} mx-0 my-0`} />
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// HistoryEntryRow
// ============================================================================

interface EntryRowProps {
  entry: HistoryEntry;
  isLight: boolean;
  headingColor: string;
  subColor: string;
  mutedColor: string;
  fieldFromColor: string;
  fieldToColor: string;
}

function HistoryEntryRow({
  entry,
  headingColor,
  subColor,
  mutedColor,
  fieldFromColor,
  fieldToColor,
}: EntryRowProps) {
  const fields = Object.entries(entry.changed_fields);

  return (
    <div className="py-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className={`text-xs font-semibold ${headingColor}`}>{entry.actor_name}</span>
        <span className={`text-[11px] flex-shrink-0 ${mutedColor}`}>
          {formatTimestamp(entry.created_at)}
        </span>
      </div>

      {entry.reason && (
        <p className={`text-[11px] italic mb-2 ${subColor}`}>{entry.reason}</p>
      )}

      {fields.length > 0 && (
        <ul className="space-y-1 mt-1.5">
          {fields.map(([key, delta]) => (
            <li key={key} className="text-[11px] leading-snug">
              <span className={`font-medium ${subColor}`}>{formatFieldName(key)}</span>
              {' '}
              <span className={fieldFromColor}>{formatValue(delta.from)}</span>
              {' → '}
              <span className={fieldToColor}>{formatValue(delta.to)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================================
// LoadingSkeleton
// ============================================================================

function LoadingSkeleton({ skeletonBg }: { skeletonBg: string }) {
  return (
    <div className="space-y-5 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-2">
          <div className="flex justify-between">
            <div className={`h-3 w-24 rounded ${skeletonBg}`} />
            <div className={`h-3 w-16 rounded ${skeletonBg}`} />
          </div>
          <div className={`h-2.5 w-3/4 rounded ${skeletonBg}`} />
          <div className={`h-2.5 w-1/2 rounded ${skeletonBg}`} />
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFieldName(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') return v.length > 60 ? v.slice(0, 57) + '…' : v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
