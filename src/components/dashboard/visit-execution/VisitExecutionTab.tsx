import { useEffect, useMemo, useState } from 'react';
import { Loader2, FlaskConical } from 'lucide-react';
import { useProtocol } from '../../../context/ProtocolContext';
import { useTheme } from '../../../context/ThemeContext';
import { fetchVisitExecutionWorkspaces, isMockEnabled } from '../../../lib/visit-execution/visitExecutionApi';
import type {
  ExecutionReviewStatus,
  VisitExecutionItem,
  VisitExecutionWorkspace,
} from '../../../types/visit-execution';
import VisitNavigator from './VisitNavigator';
import VisitSnapshotCard from './VisitSnapshotCard';
import ExecutionChecklist from './ExecutionChecklist';
import TraceabilityDrawer from './TraceabilityDrawer';
import ExportPlaceholderButton from './ExportPlaceholderButton';

// =============================================================================
// VisitExecutionTab — root component for the new primary Site Mode surface.
//
// Layout:
//   - Left rail: VisitNavigator (visit list with indicator chips)
//   - Right pane: VisitSnapshotCard (above-fold summary + timing) +
//                 ExecutionChecklist (workflow-ordered grouped items) +
//                 ExportPlaceholderButton at the bottom
//   - Drawer overlay: TraceabilityDrawer (one instance, item-scoped)
//
// State owned here (client-local, not persisted — Sprint 1):
//   - workspaces[]   — loaded once per active protocol
//   - selectedVisitTemplateId
//   - reviewStatus Map<itemId, ExecutionReviewStatus>
//   - traceabilityItem (VisitExecutionItem | null)
//
// No context promotion in Sprint 1 — single consumer of this data so far.
// =============================================================================

export default function VisitExecutionTab() {
  const { activeProtocol } = useProtocol();
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [workspaces, setWorkspaces] = useState<VisitExecutionWorkspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewStatus, setReviewStatus] = useState<Map<string, ExecutionReviewStatus>>(new Map());
  const [traceabilityItem, setTraceabilityItem] = useState<VisitExecutionItem | null>(null);

  // Load workspaces when the active protocol changes.
  useEffect(() => {
    if (!activeProtocol) {
      setWorkspaces([]);
      setSelectedId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchVisitExecutionWorkspaces(activeProtocol.id).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (!r.ok) {
        setError(r.error);
        setWorkspaces([]);
        setSelectedId(null);
        return;
      }
      setWorkspaces(r.data);
      // Default to first visit (lowest study_day, set by adapter sort).
      if (r.data.length > 0) {
        setSelectedId(r.data[0].visit_template_id);
      } else {
        setSelectedId(null);
      }
      // Reset review state when protocol changes — review state isn't persisted yet.
      setReviewStatus(new Map());
      setTraceabilityItem(null);
    });
    return () => {
      cancelled = true;
    };
  }, [activeProtocol]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((w) => w.visit_template_id === selectedId) ?? null,
    [workspaces, selectedId],
  );

  const reviewedCountForSelected = useMemo(() => {
    if (!selectedWorkspace) return 0;
    return selectedWorkspace.items.filter(
      (i) => (reviewStatus.get(i.id) ?? i.review_status) === 'reviewed',
    ).length;
  }, [selectedWorkspace, reviewStatus]);

  const handleToggleReviewed = (itemId: string) => {
    setReviewStatus((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? 'not_reviewed';
      next.set(itemId, current === 'reviewed' ? 'not_reviewed' : 'reviewed');
      return next;
    });
  };

  const handleSetStatus = (itemId: string, nextStatus: ExecutionReviewStatus) => {
    setReviewStatus((prev) => {
      const next = new Map(prev);
      next.set(itemId, nextStatus);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-fg-sub text-sm gap-2">
        <Loader2 size={14} className="animate-spin" />
        Loading visit workspaces…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div>
          <p className="text-fg-heading text-sm font-semibold mb-1">Couldn't load visits</p>
          <p className="text-fg-sub text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!activeProtocol) {
    return null;
  }

  if (workspaces.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center">
        <div className="max-w-md">
          <FlaskConical size={20} className="mx-auto text-fg-muted mb-3" aria-hidden />
          <p className="text-fg-heading text-sm font-semibold mb-1">
            No visit templates yet for this protocol
          </p>
          <p className="text-fg-sub text-xs leading-relaxed">
            Upload a protocol PDF in the Protocol tab and the parsed Schedule
            of Events will appear here.{' '}
            {!isMockEnabled() && (
              <>
                To preview with sample data, enable the mock toggle:
                <code className={`ml-1 px-1 py-0.5 rounded text-[10px] ${
                  isLight ? 'bg-[#eef2f6]' : 'bg-white/[0.05]'
                }`}>
                  localStorage.setItem('piq-visit-execution-mock-v1', '1')
                </code>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <VisitNavigator
        workspaces={workspaces}
        selectedVisitTemplateId={selectedId}
        onSelect={setSelectedId}
        reviewStatusByItemId={reviewStatus}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-5 sm:px-8 py-6 space-y-5">
          {selectedWorkspace ? (
            <>
              <VisitSnapshotCard
                snapshot={selectedWorkspace.snapshot}
                reviewedCount={reviewedCountForSelected}
                totalItems={selectedWorkspace.items.length}
              />

              <ExecutionChecklist
                workspace={selectedWorkspace}
                reviewStatus={reviewStatus}
                onToggleReviewed={handleToggleReviewed}
                onSetStatus={handleSetStatus}
                onOpenTraceability={setTraceabilityItem}
              />

              <div className="flex items-center justify-between pt-2">
                <p className="text-fg-muted text-[11px] leading-relaxed max-w-md">
                  This workspace is a draft. Final source-document authoring and
                  approval are performed outside PIQC.
                </p>
                <ExportPlaceholderButton />
              </div>
            </>
          ) : (
            <p className="text-fg-sub text-sm">Select a visit on the left to begin.</p>
          )}
        </div>
      </div>

      <TraceabilityDrawer
        item={traceabilityItem}
        onClose={() => setTraceabilityItem(null)}
      />
    </div>
  );
}
