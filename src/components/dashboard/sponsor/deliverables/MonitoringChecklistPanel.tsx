import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardList,
  Download,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import {
  MONITORING_SECTION_LABELS,
  type DeliverablePacket,
  type DeliverablePacketBlock,
  type DeliverablesResult,
  type MonitoringChecklistSectionKey,
} from '../../../../types/deliverables';
import {
  fetchDeliverablePacket,
  generateDeliverable,
} from '../../../../lib/deliverables/deliverablesApi';
import {
  addBlock,
  addBlockNote,
  deleteBlock,
  editBlockText,
  flagBlock,
  markBlockReviewed,
  rejectBlock,
  unmarkBlockReviewed,
} from '../../../../lib/deliverables/deliverablesMutationsApi';
import { downloadDeliverable } from '../../../../lib/deliverables/deliverablesExportApi';
import { DeliverableBlockList } from '../../../deliverables/DeliverableBlockList';
import {
  DeliverableTextDrawer,
  type DeliverableTextDrawerSubject,
} from '../../../deliverables/DeliverableTextDrawer';
import { DeliverableTraceabilityDrawer } from '../../../deliverables/DeliverableTraceabilityDrawer';

// =============================================================================
// MonitoringChecklistPanel — the orchestrator for one protocol's monitoring
// preparation checklist. This is where data flows: fetch/generate/mutate via
// the src/lib/deliverables API layers, then hand the typed packet to the pure
// components in src/components/deliverables (which never fetch).
//
// State discipline:
//   - fetchTokenRef guards rapid protocol switches (SiteDataContext pattern):
//     only the latest fetch applies its result.
//   - protocolIdRef guards mutation → refetch chains: a mutation that
//     resolves after the user switched protocols must not trigger a stale
//     refetch that could clobber the new protocol's packet.
//   - No optimistic updates anywhere — every mutation refetches the packet
//     so the UI always shows the server's truth (VEW precedent).
//
// SENSITIVE: block text, source quotes, and reviewer notes are never logged.
// Draft-only vocabulary: PIQC drafted; humans review; nothing is "approved".
// =============================================================================

const ARTIFACT_TYPE = 'monitoring_prep_checklist' as const;

interface Props {
  protocolId: string;
}

/** Which text-input flow the DeliverableTextDrawer is currently serving. */
type TextDrawerTarget =
  | { mode: 'edit'; block: DeliverablePacketBlock }
  | { mode: 'note'; block: DeliverablePacketBlock }
  | { mode: 'add'; sectionKey: MonitoringChecklistSectionKey };

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

export default function MonitoringChecklistPanel({ protocolId }: Props) {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [packet, setPacket] = useState<DeliverablePacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [textDrawerTarget, setTextDrawerTarget] = useState<TextDrawerTarget | null>(null);
  const [traceabilityBlock, setTraceabilityBlock] = useState<DeliverablePacketBlock | null>(
    null,
  );

  // Monotonic token: only the latest fetch applies its result (copied from
  // SiteDataContext — protects against rapid protocol switches).
  const fetchTokenRef = useRef(0);

  // Current protocol, readable from stale closures: a mutation resolving
  // after a protocol switch checks this before firing its refetch.
  const protocolIdRef = useRef(protocolId);
  useEffect(() => {
    protocolIdRef.current = protocolId;
  }, [protocolId]);

  const refresh = useCallback(async () => {
    const token = ++fetchTokenRef.current;
    const result = await fetchDeliverablePacket(protocolId, ARTIFACT_TYPE);
    if (token !== fetchTokenRef.current) return;
    if (!result.ok) {
      setLoadError(result.error);
      setPacket(null);
    } else {
      setLoadError(null);
      setPacket(result.data);
    }
    setLoading(false);
  }, [protocolId]);

  // On mount + protocol switch: drop the previous protocol's packet and any
  // transient UI (open drawers, banners) before fetching the new one.
  useEffect(() => {
    setPacket(null);
    setLoading(true);
    setLoadError(null);
    setActionError(null);
    setGenerating(false);
    setTextDrawerTarget(null);
    setTraceabilityBlock(null);
    void refresh();
  }, [refresh]);

  // One-click row mutations: run the RPC, then refetch (no optimistic
  // updates). Failures surface in the action banner; a stale resolve (user
  // switched protocols mid-flight) is dropped silently.
  const runRowAction = useCallback(
    async (mutate: () => Promise<DeliverablesResult<unknown>>) => {
      const pid = protocolId;
      setActionError(null);
      const result = await mutate();
      if (protocolIdRef.current !== pid) return;
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      await refresh();
    },
    [protocolId, refresh],
  );

  const handleGenerate = async () => {
    if (generating) return;
    const pid = protocolId;
    setGenerating(true);
    setActionError(null);
    const result = await generateDeliverable(protocolId, ARTIFACT_TYPE);
    if (protocolIdRef.current !== pid) return; // switch effect already reset UI
    if (!result.ok) {
      setActionError(result.error);
      setGenerating(false);
      return;
    }
    await refresh();
    setGenerating(false);
  };

  // Shared save handler for the three DeliverableTextDrawer flows. Resolves
  // ok → close the drawer + refetch; not-ok → the drawer stays open and
  // shows the error inline (its contract).
  const handleTextDrawerSave = async (
    text: string,
    note?: string,
  ): Promise<DeliverablesResult<unknown>> => {
    // Programmer-error guards: the drawer only opens with a target, and the
    // 'add' affordance only renders inside a loaded packet.
    if (!textDrawerTarget) return { ok: false, error: 'No drawer target' };

    let result: DeliverablesResult<unknown>;
    if (textDrawerTarget.mode === 'edit') {
      result = await editBlockText(textDrawerTarget.block.id, text, note);
    } else if (textDrawerTarget.mode === 'note') {
      result = await addBlockNote(textDrawerTarget.block.id, text);
    } else {
      if (!packet) return { ok: false, error: 'No deliverable loaded' };
      result = await addBlock(packet.deliverable_id, textDrawerTarget.sectionKey, text);
    }

    if (result.ok) {
      setTextDrawerTarget(null);
      if (protocolIdRef.current === protocolId) await refresh();
    }
    return result;
  };

  const textDrawerSubject: DeliverableTextDrawerSubject | null = (() => {
    if (!textDrawerTarget) return null;
    if (textDrawerTarget.mode === 'add') {
      return {
        title: MONITORING_SECTION_LABELS[textDrawerTarget.sectionKey],
        initialText: '',
        driftFromText: null,
      };
    }
    if (textDrawerTarget.mode === 'note') {
      return {
        title: textDrawerTarget.block.display_text,
        initialText: textDrawerTarget.block.review_note ?? '',
        driftFromText: null,
      };
    }
    // 'edit' — seed with the display text; the drawer shows the frozen PIQC
    // draft as drift context only when current_text has diverged from it.
    return {
      title: textDrawerTarget.block.display_text,
      initialText: textDrawerTarget.block.display_text,
      driftFromText: textDrawerTarget.block.derived_text,
    };
  })();

  const cardChrome = isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5';

  // ---- Initial load ---------------------------------------------------------
  if (loading && packet === null) {
    return (
      <div
        data-testid="monitoring-checklist-loading"
        className={`rounded-xl border px-4 py-10 flex items-center justify-center gap-2 ${cardChrome}`}
      >
        <Loader2
          size={16}
          className={isLight ? 'text-[#534AB7] animate-spin' : 'text-[#7F77DD] animate-spin'}
          aria-hidden
        />
        <span className="text-fg-sub text-sm">Loading draft checklist…</span>
      </div>
    );
  }

  // ---- Load error -----------------------------------------------------------
  if (loadError && packet === null) {
    return (
      <div
        role="alert"
        data-testid="monitoring-checklist-load-error"
        className={`rounded-xl border px-4 py-6 ${cardChrome}`}
      >
        <div className="flex items-start gap-2">
          <AlertTriangle
            size={15}
            className={`mt-0.5 flex-shrink-0 ${isLight ? 'text-rose-700' : 'text-rose-400'}`}
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-fg-body text-sm">Couldn't load the checklist: {loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setLoadError(null);
                void refresh();
              }}
              className={`mt-2 px-3 py-1.5 rounded-md text-xs font-medium border ${
                isLight
                  ? 'border-[#CBD5E1] text-fg-body hover:bg-[#F8FAFC]'
                  : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
              }`}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Empty state — no deliverable yet -------------------------------------
  if (packet === null) {
    return (
      <div
        data-testid="monitoring-checklist-empty"
        className={`rounded-xl border px-6 py-10 text-center ${cardChrome}`}
      >
        <ClipboardList size={20} className="text-fg-muted mx-auto mb-3" aria-hidden />
        <h2 className="text-fg-heading text-sm font-semibold">
          No draft checklist for this protocol yet
        </h2>
        <p className="text-fg-sub text-xs mt-2 leading-relaxed max-w-md mx-auto">
          PIQC drafts a monitoring preparation checklist from the facts already
          extracted from this protocol. Every protocol-fact item links back to
          its source quote, page, and extraction confidence — and the whole
          checklist stays a draft that requires human review.
        </p>
        {actionError && (
          <p
            role="alert"
            data-testid="monitoring-checklist-generate-error"
            className={`text-xs mt-3 ${isLight ? 'text-rose-700' : 'text-rose-400'}`}
          >
            Couldn't generate the checklist: {actionError}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={generating}
          data-testid="monitoring-checklist-generate"
          className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-md text-xs font-semibold ${
            generating
              ? isLight
                ? 'bg-[#CBD5E1] text-white cursor-wait'
                : 'bg-white/10 text-fg-muted cursor-wait'
              : isLight
                ? 'bg-[#1E293B] text-white hover:bg-[#0F172A]'
                : 'bg-white text-[#020617] hover:bg-[#E2E8F0]'
          }`}
        >
          {generating ? (
            <Loader2 size={12} className="animate-spin" aria-hidden />
          ) : (
            <ClipboardList size={12} aria-hidden />
          )}
          {generating ? 'Drafting…' : 'Generate draft checklist'}
        </button>
      </div>
    );
  }

  // ---- Loaded packet --------------------------------------------------------
  return (
    <div data-testid="monitoring-checklist-panel" className="space-y-3">
      {/* Header card */}
      <div className={`rounded-xl border px-4 py-4 ${cardChrome}`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-fg-heading text-base font-semibold">{packet.title}</h2>
              <span
                data-testid="monitoring-checklist-draft-chip"
                className={`inline-flex items-center font-semibold uppercase tracking-wider rounded-md border text-[10px] px-1.5 py-0.5 ${
                  isLight
                    ? 'text-amber-700 bg-amber-50 border-amber-200'
                    : 'text-amber-400 bg-amber-400/10 border-amber-400/20'
                }`}
              >
                Draft
              </span>
            </div>
            <p className="text-fg-sub text-xs mt-1">
              PIQC drafted · requires human review
              {packet.protocol_version
                ? ` · Protocol version ${packet.protocol_version}`
                : ''}
            </p>
            <p className="text-fg-muted text-[11px] mt-0.5">
              Generated {formatTimestamp(packet.generated_at)}
              {packet.regenerated_at
                ? ` · Regenerated ${formatTimestamp(packet.regenerated_at)}`
                : ''}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating}
              title="Redrafts the checklist from the protocol. Your edits, added items, and removed items are preserved."
              data-testid="monitoring-checklist-regenerate"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border ${
                generating
                  ? 'opacity-50 cursor-wait border-transparent text-fg-muted'
                  : isLight
                    ? 'border-[#CBD5E1] text-fg-body hover:bg-[#F8FAFC]'
                    : 'border-white/10 text-fg-body hover:bg-white/[0.04]'
              }`}
            >
              <RefreshCw
                size={12}
                className={generating ? 'animate-spin' : ''}
                aria-hidden
              />
              {generating ? 'Regenerating…' : 'Regenerate'}
            </button>
            <ExportChecklistButton deliverableId={packet.deliverable_id} isLight={isLight} />
          </div>
        </div>
      </div>

      {/* Action-failure banner (row mutations / regenerate) */}
      {actionError && (
        <div
          role="alert"
          data-testid="monitoring-checklist-action-error"
          className={`flex items-start gap-2 px-3 py-2 rounded-md border text-xs ${
            isLight
              ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
              : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
          }`}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" aria-hidden />
          <span className="flex-1 leading-relaxed">{actionError}</span>
        </div>
      )}

      {/* Sectioned block list — pure component; every mutation round-trips */}
      <DeliverableBlockList
        blocks={packet.blocks}
        onMarkReviewed={(b) => void runRowAction(() => markBlockReviewed(b.id))}
        onUnmarkReviewed={(b) => void runRowAction(() => unmarkBlockReviewed(b.id))}
        onFlag={(b) => void runRowAction(() => flagBlock(b.id))}
        onReject={(b) => void runRowAction(() => rejectBlock(b.id))}
        onEdit={(b) => setTextDrawerTarget({ mode: 'edit', block: b })}
        onAddNote={(b) => setTextDrawerTarget({ mode: 'note', block: b })}
        onShowSource={(b) => setTraceabilityBlock(b)}
        onDelete={(b) => void runRowAction(() => deleteBlock(b.id))}
        onAddBlock={(sectionKey) => setTextDrawerTarget({ mode: 'add', sectionKey })}
      />

      {/* Drawers */}
      <DeliverableTextDrawer
        open={textDrawerTarget !== null}
        onClose={() => setTextDrawerTarget(null)}
        mode={textDrawerTarget?.mode ?? 'edit'}
        subject={textDrawerSubject}
        onSave={handleTextDrawerSave}
      />
      <DeliverableTraceabilityDrawer
        open={traceabilityBlock !== null}
        onClose={() => setTraceabilityBlock(null)}
        block={traceabilityBlock}
        protocolVersion={packet.protocol_version}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExportChecklistButton — idle → loading → success ('Exported ✓', ~2s revert)
// → error state machine, copied from the VEW ExportWorksheetButton (copy,
// don't import — mode isolation). Calls downloadDeliverable(), which fetches
// the server-stamped export packet and saves the DRAFT-watermarked PDF.
// ---------------------------------------------------------------------------

type ExportButtonState = 'idle' | 'loading' | 'success' | 'error';

const SUCCESS_RESET_MS = 2000;

function ExportChecklistButton({
  deliverableId,
  isLight,
}: {
  deliverableId: string;
  isLight: boolean;
}) {
  const [state, setState] = useState<ExportButtonState>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Track the success-revert timeout so it's cleared on unmount or on a new
  // click — prevents setState firing after the panel unmounts mid-success.
  const revertTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (revertTimeoutRef.current !== null) {
        clearTimeout(revertTimeoutRef.current);
        revertTimeoutRef.current = null;
      }
    };
  }, []);

  async function handleClick() {
    if (state === 'loading') return; // dedupe rapid double-clicks
    if (revertTimeoutRef.current !== null) {
      clearTimeout(revertTimeoutRef.current);
      revertTimeoutRef.current = null;
    }

    setState('loading');
    setErrorMessage(null);

    const result = await downloadDeliverable(deliverableId);

    if (!result.ok) {
      // Error message only — never block content or notes.
      console.error('[deliverables] export_failed', {
        deliverableId,
        error: result.error,
      });
      setErrorMessage(result.error);
      setState('error');
      return;
    }

    setState('success');
    revertTimeoutRef.current = setTimeout(() => {
      revertTimeoutRef.current = null;
      setState('idle');
    }, SUCCESS_RESET_MS);
  }

  const enabledClass = isLight
    ? 'bg-[#1E293B] text-white hover:bg-[#0F172A]'
    : 'bg-white text-[#020617] hover:bg-[#E2E8F0]';
  const disabledClass = isLight
    ? 'bg-[#CBD5E1] text-white cursor-wait'
    : 'bg-white/10 text-fg-muted cursor-wait';

  const icon = (() => {
    switch (state) {
      case 'loading':
        return <Loader2 size={12} className="animate-spin" aria-hidden />;
      case 'success':
        return <Check size={12} aria-hidden />;
      case 'error':
        return <AlertTriangle size={12} aria-hidden />;
      case 'idle':
      default:
        return <Download size={12} aria-hidden />;
    }
  })();

  const label = (() => {
    switch (state) {
      case 'loading':
        return 'Exporting…';
      case 'success':
        return 'Exported ✓';
      // The button stays clickable in the error state — the click IS the
      // retry; the tooltip below carries the detail (VEW precedent).
      case 'error':
        return 'Export failed';
      case 'idle':
      default:
        return 'Export';
    }
  })();

  return (
    <div className="inline-block group relative">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={state === 'loading'}
        aria-label="Export the draft checklist as PDF"
        data-testid="monitoring-checklist-export"
        data-state={state}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
          state === 'loading' ? disabledClass : enabledClass
        }`}
      >
        {icon}
        {label}
      </button>

      {state === 'error' && errorMessage && (
        <span
          role="tooltip"
          data-testid="monitoring-checklist-export-error"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg z-20 ${
            isLight
              ? 'bg-[#FFF1F2] border-[#FECDD3] text-[#881337]'
              : 'bg-[#4C0519] border-[#881337] text-[#FECDD3]'
          }`}
        >
          Couldn't export the checklist: {errorMessage}. Try again or refresh the page.
        </span>
      )}

      {state === 'idle' && (
        <span
          role="tooltip"
          className={`pointer-events-none absolute right-0 top-full mt-2 w-72 text-[11px] leading-relaxed px-3 py-2 rounded-md border shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-20 ${
            isLight
              ? 'bg-white border-[#E2E8F0] text-[#334155]'
              : 'bg-[#0F172A] border-white/10 text-[#CBD5E1]'
          }`}
        >
          PIQC-drafted checklist (PDF) with DRAFT watermark and source
          traceability appendix. Final verification happens outside PIQC.
        </span>
      )}
    </div>
  );
}
