import { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { getProtocolColorsById } from '../../../lib/site/protocolColors';
import type { FilterState } from './todayCalendarShared';

// ────────────────────────────────────────────────────────────────────────────
// Filter panel (Google Calendar style)
// ────────────────────────────────────────────────────────────────────────────

export interface CalendarFiltersProps {
  isLight: boolean;
  isHome: boolean;
  protocols: { id: string; code: string }[];
  activeProtocolId: string | null;
  filters: FilterState;
  participantsByProtocol: Map<string, string[]>;
  onToggleProtocol: (id: string) => void;
  onToggleParticipant: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export function CalendarFilters({
  isLight,
  isHome,
  protocols,
  activeProtocolId,
  filters,
  participantsByProtocol,
  onToggleProtocol,
  onToggleParticipant,
  open,
  onClose,
}: CalendarFiltersProps) {
  const cardBg = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';
  const sectionHeader = 'text-fg-label';
  const textColor = 'text-fg-heading';
  const mutedColor = 'text-fg-muted';

  const shownProtocols = isHome ? protocols : protocols.filter((p) => p.id === activeProtocolId);

  const [expandedProtocols, setExpandedProtocols] = useState<Set<string>>(
    () => new Set(shownProtocols.map((p) => p.id)),
  );

  const toggleExpand = (id: string) => {
    setExpandedProtocols((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hiddenProtos = new Set(filters.hiddenProtocols);
  const hiddenParts = new Set(filters.hiddenParticipants);

  return (
    <aside
      className={`${
        open ? 'block' : 'hidden'
      } md:block w-44 flex-shrink-0 ${cardBg} border rounded-xl overflow-y-auto`}
    >
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className={`${sectionHeader} text-[11px] uppercase tracking-wider font-semibold`}>
            Filters
          </h3>
          <button
            type="button"
            onClick={onClose}
            className={`md:hidden ${mutedColor} hover:opacity-75`}
            aria-label="Close filters"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-1">
          {shownProtocols.map((p) => {
            const colors = getProtocolColorsById(p.id, protocols);
            const dotCls = isLight ? colors.dotLight : colors.dotDark;
            const expanded = expandedProtocols.has(p.id);
            const protoHidden = hiddenProtos.has(p.id);
            const participants = participantsByProtocol.get(p.id) ?? [];

            return (
              <div key={p.id}>
                <div className="flex items-center gap-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => onToggleProtocol(p.id)}
                    className="flex-shrink-0"
                    aria-label={`Toggle ${p.code}`}
                  >
                    <span
                      className={`inline-block w-3.5 h-3.5 rounded-sm ${
                        protoHidden
                          ? isLight
                            ? 'bg-white border border-[#CBD5E1]'
                            : 'bg-[#020617] border border-white/15'
                          : dotCls
                      }`}
                    />
                  </button>
                  {isHome && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(p.id)}
                      className={`flex-shrink-0 ${mutedColor} hover:opacity-75`}
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      <ChevronDown
                        size={12}
                        className={`transition-transform ${expanded ? '' : '-rotate-90'}`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onToggleProtocol(p.id)}
                    className={`flex-1 text-left text-xs font-medium truncate ${
                      protoHidden ? mutedColor : textColor
                    }`}
                  >
                    {p.code}
                  </button>
                </div>

                {expanded && participants.length > 0 && (
                  <div className="ml-6 pl-2 border-l border-dashed space-y-0.5 mb-1"
                       style={{ borderColor: isLight ? 'rgba(51,65,85,0.12)' : 'rgba(203,213,225,0.1)' }}>
                    {participants.map((pid) => {
                      const partHidden = hiddenParts.has(pid);
                      return (
                        <button
                          key={pid}
                          type="button"
                          onClick={() => onToggleParticipant(pid)}
                          className={`w-full flex items-center gap-2 py-1 text-left text-xs ${
                            partHidden ? mutedColor : textColor
                          } hover:opacity-80`}
                        >
                          <span
                            className={`inline-block w-3 h-3 rounded-sm border ${
                              partHidden
                                ? isLight
                                  ? 'bg-white border-[#CBD5E1]'
                                  : 'bg-[#020617] border-white/15'
                                : isLight
                                ? 'bg-brand-600/60 border-brand-600/60'
                                : 'bg-brand-300/50 border-brand-300/50'
                            }`}
                          />
                          <span className="truncate">{pid}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
