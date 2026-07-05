import { useState } from 'react';
import { FolderOpen, Loader2, Lock, SearchCheck } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useSubscription } from '../../../hooks/useSubscription';
import { canUseCraMode } from '../../../lib/entitlements';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../types/deliverables';
import DeliverablePanel from '../../deliverables/DeliverablePanel';
import { DELIVERABLE_CONFIGS } from '../../deliverables/deliverableConfigs';
import { ActionCardRail } from '../../actions/ActionCardRail';
import { CRA_ARTIFACT_ORDER } from './craDeliverables';

// =============================================================================
// CraWorkspaceShell — the CRA/Monitor mode's workspace (PR-B). The first
// role-lens surface that is NOT hosted inside Sponsor: monitors get their own
// mode + navigation (handover §6.2), but the deliverables underneath are the
// SAME Protocol Deliverable Engine the Sponsor tab uses. This surface is a
// config over Layer B, never a fork of it — proof: it mounts the shared
// <DeliverablePanel/> and <ActionCardRail/> unchanged and differs from the
// Sponsor tab by exactly three things:
//   1. the entitlement gate (canUseCraMode, not canUseSponsorMode);
//   2. the amber accent (the rail's CRA color, not Sponsor purple);
//   3. the monitor register + a focus-first TWO-deliverable picker — the
//      monitor's operational pair (Monitoring Focus, Prep Checklist), not the
//      sponsor's full four (risk overview / SIV are sponsor-facing).
//
// Gate order mirrors ProtocolIntelligenceTab, top to bottom:
//   1. Entitlement — canUseCraMode(subscription). The rail icon itself is
//      never gated (sponsor precedent): the mode is discoverable, the
//      capability is gated. Not allowed → calm amber gate card.
//   2. Protocol scope — ProtocolContext supplies the list; the workspace
//      defaults to the app-wide activeProtocol and offers a local <select> so
//      a monitor can switch protocols without moving the global selection.
//   3. A two-chip deliverable picker (focus default) mounts <DeliverablePanel/>
//      with that type's shared section config, plus the warm-handoff rail.
//
// Draft-only vocabulary throughout: PIQC drafts; the monitor reviews and
// decides. SENSITIVE: block text / notes live inside the panel, never here.
// =============================================================================

/** Amber accent — the CRA rail color (LeftRail PALETTE.cra). */
const CRA_ACCENT_FG_LIGHT = '#8A4B0F';
const CRA_ACCENT_FG_DARK = '#E8B27D';

export default function CraWorkspaceShell() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const { subscription, loading: subscriptionLoading } = useSubscription();
  const { protocols, isLoading: protocolsLoading, activeProtocol } = useProtocol();

  // Local protocol override — scoped to this workspace. null = follow the
  // app-wide activeProtocol. If the override id vanishes (protocol removed),
  // the fallback chain quietly returns to activeProtocol.
  const [overrideProtocolId, setOverrideProtocolId] = useState<string | null>(null);

  // Which deliverable the picker shows. Focus first; protocol-independent, so
  // it is deliberately NOT reset on protocol switches.
  const [artifactType, setArtifactType] = useState<DeliverableArtifactType>(
    'cra_monitoring_focus',
  );

  const accentFg = isLight ? CRA_ACCENT_FG_LIGHT : CRA_ACCENT_FG_DARK;
  const accentBg = isLight ? '#FDF3E7' : 'rgba(138, 75, 15, 0.2)';

  // Selected picker chip — a saturated amber SURFACE with a contrasting label.
  // Deliberately NOT accentFg (the icon foreground): in dark mode accentFg is a
  // pale amber (#E8B27D), and white-on-pale fails WCAG contrast. So the chip
  // pairs deep-amber + white in light mode (6.8:1) and pale-amber + dark ink in
  // dark mode (~8:1) — both clear AA for the small bold label.
  const chipSelectedBg = isLight ? '#8A4B0F' : '#E8B27D';
  const chipSelectedFg = isLight ? '#FFFFFF' : '#3A1E05';

  // Full-screen spinner ONLY while there is nothing to show yet (the
  // ProtocolIntelligenceTab discipline: a background protocol reload must not
  // unmount the panel and destroy in-progress reviewer text).
  if (subscriptionLoading || (protocolsLoading && protocols.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2
          size={20}
          className="animate-spin"
          style={{ color: accentFg }}
          aria-label="Loading CRA workspace"
        />
      </div>
    );
  }

  const decision = canUseCraMode(subscription);
  if (!decision.allowed) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <div
          data-testid="cra-workspace-gate"
          className={`max-w-xl rounded-xl border p-6 ${
            isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
          }`}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: accentBg, color: accentFg }}
            >
              <Lock size={16} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-fg-heading text-sm font-semibold">
                CRA Mode is an enterprise capability
              </h2>
              <p className="text-fg-sub text-sm mt-1 leading-relaxed">{decision.reason}</p>
              <p className="text-fg-muted text-xs mt-3 leading-relaxed">
                With the enterprise tier, monitors get a dedicated workspace over
                the same protocol intelligence — PIQC-drafted monitoring focus,
                preparation checklists, and next-action context, every item
                traceable to its protocol source.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const selectedProtocol =
    (overrideProtocolId !== null
      ? (protocols.find((p) => p.id === overrideProtocolId) ?? null)
      : null) ?? activeProtocol;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="space-y-5">
        {/* Workspace header — monitor register */}
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: accentBg, color: accentFg }}
          >
            <SearchCheck size={20} aria-hidden />
          </div>
          <div className="min-w-0">
            <h1 className="text-fg-heading text-2xl font-semibold">CRA Monitoring Workspace</h1>
            <p className="text-fg-sub text-sm mt-1 leading-relaxed">
              PIQC-drafted intelligence for the monitor — where your limited
              on-site attention should go first, and what to verify before the
              visit. Every draft is evidence-linked and requires your review.
            </p>
          </div>
        </div>

        {/* Protocol scope selector */}
        {protocols.length === 0 ? (
          <div
            data-testid="cra-workspace-no-protocols"
            className={`rounded-xl border px-4 py-8 text-center ${
              isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
            }`}
          >
            <FolderOpen size={18} className="text-fg-muted mx-auto mb-2" aria-hidden />
            <p className="text-fg-body text-sm">No protocols in this workspace yet.</p>
            <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
              Upload and parse a protocol first — PIQC drafts the monitoring
              workspace from the facts it extracts.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <label
                htmlFor="cra-workspace-protocol"
                className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex-shrink-0"
              >
                Protocol
              </label>
              <select
                id="cra-workspace-protocol"
                data-testid="cra-workspace-protocol-select"
                value={selectedProtocol?.id ?? ''}
                onChange={(e) =>
                  setOverrideProtocolId(e.target.value === '' ? null : e.target.value)
                }
                className={`max-w-md w-full px-3 py-1.5 rounded-md border text-sm focus:outline-none focus:ring-2 ${
                  isLight
                    ? 'bg-white border-[#CBD5E1] text-fg-body focus:ring-[#94A3B8]'
                    : 'bg-[#1a2029] border-white/10 text-fg-body focus:ring-white/20'
                }`}
              >
                {!selectedProtocol && <option value="">Select a protocol…</option>}
                {protocols.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.code ? `${p.code} — ${p.name}` : p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Deliverable picker — the monitor's operational pair, focus
                first. Artifact choice is protocol-independent. */}
            <div
              role="tablist"
              aria-label="Deliverable type"
              data-testid="cra-workspace-deliverable-picker"
              className={`inline-flex flex-wrap items-center gap-1 rounded-lg border p-1 ${
                isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
              }`}
            >
              {CRA_ARTIFACT_ORDER.map((key) => {
                const selected = artifactType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setArtifactType(key)}
                    data-testid={`cra-deliverable-picker-${key}`}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
                      selected ? '' : 'text-fg-sub hover:text-fg-body'
                    }`}
                    style={
                      selected
                        ? { backgroundColor: chipSelectedBg, color: chipSelectedFg }
                        : undefined
                    }
                  >
                    {ARTIFACT_TYPE_LABELS[key]}
                  </button>
                );
              })}
            </div>

            {selectedProtocol ? (
              <>
                <DeliverablePanel
                  protocolId={selectedProtocol.id}
                  artifactType={artifactType}
                  sectionOrder={DELIVERABLE_CONFIGS[artifactType].sectionOrder}
                  sectionLabels={DELIVERABLE_CONFIGS[artifactType].sectionLabels}
                  exportEnabled={DELIVERABLE_CONFIGS[artifactType].exportEnabled}
                />
                {/* Warm-handoff rail — self-hiding when the protocol has no
                    suggested cards. refreshKey re-syncs on chip switches so a
                    freshly generated deliverable surfaces its Travel-Bridge
                    card without a panel callback. */}
                <ActionCardRail protocolId={selectedProtocol.id} refreshKey={artifactType} />
              </>
            ) : (
              <div
                data-testid="cra-workspace-no-selection"
                className={`rounded-xl border px-4 py-8 text-center ${
                  isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
                }`}
              >
                <p className="text-fg-body text-sm">Select a protocol to begin.</p>
                <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
                  PIQC drafts the {ARTIFACT_TYPE_LABELS[artifactType].toLowerCase()} for
                  the protocol you choose above.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
