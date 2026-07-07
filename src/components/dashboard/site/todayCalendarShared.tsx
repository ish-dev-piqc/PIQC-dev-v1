import {
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  FileWarning,
} from 'lucide-react';
import type { SiteVisit, VisitStatus } from '../../../lib/site/types';

// ────────────────────────────────────────────────────────────────────────────
// Shared helpers for the Today calendar (TodayTab + extracted components) —
// date utilities live in src/lib/site/dateUtils.ts
// ────────────────────────────────────────────────────────────────────────────

export type ViewMode = 'week' | 'month';

export interface FilterState {
  hiddenProtocols: string[];
  hiddenParticipants: string[];
}

export interface ViewProps {
  isLight: boolean;
  isHome: boolean;
  anchorDate: Date;
  today: Date;
  visitsByDate: Map<string, SiteVisit[]>;
  protocols: { id: string; code: string }[];
  onVisitClick: (v: SiteVisit) => void;
  onDayClick: (d: Date) => void;
}

// ────────────────────────────────────────────────────────────────────────────
// Status display helpers
// ────────────────────────────────────────────────────────────────────────────

export function statusIcon(status: VisitStatus, size = 13) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={size} className="text-emerald-500" />;
    case 'missed':
      return <XCircle size={size} className="text-red-500" />;
    case 'deviation':
      return <FileWarning size={size} className="text-amber-500" />;
    case 'overdue':
      return <AlertCircle size={size} className="text-red-500" />;
    case 'closing_soon':
      return <Clock size={size} className="text-amber-500" />;
    case 'cancelled':
      return <XCircle size={size} className="text-fg-muted" />;
    default:
      return null;
  }
}

export function protoCode(id: string, protocols: { id: string; code: string }[]): string {
  return protocols.find((p) => p.id === id)?.code ?? id;
}
