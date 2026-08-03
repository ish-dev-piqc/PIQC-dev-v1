import { useState } from 'react';
import { FolderOpen, Loader2, Lock, Sparkles } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useProtocol } from '../../../context/ProtocolContext';
import { useDeliverableEntitlement } from '../../../hooks/useDeliverableEntitlement';
import { canUseProtocolIntelligence } from '../../../lib/entitlements';
import {
  ARTIFACT_TYPE_LABELS,
  type DeliverableArtifactType,
} from '../../../types/deliverables';
import DeliverablePanel from '../../deliverables/DeliverablePanel';
import { DeliverablesOverview } from '../../deliverables/DeliverablesOverview';
import { DELIVERABLE_CONFIGS } from '../../deliverables/deliverableConfigs';
import { ActionCardRail } from '../../actions/ActionCardRail';
import { CRA_ARTIFACT_ORDER } from './craDeliverables';
import SponsorAskPanel from '../sponsor/deliverables/SponsorAskPanel';
import SponsorPortfolio from '../sponsor/SponsorPortfolio';

// =============================================================================
// CraWorkspaceShell — the merged Protocol Intelligence workspace (2026-08-02:
// CRA Mode and Sponsor Mode merged into one). Both were already the same
// system underneath — one entitlement (`deliverable_engine`), one
// DeliverablePanel, one deliverable engine — differing only in which artifact
// types were offered, the accent color, and copy. This shell now carries the
// full deliverable set (previously Sponsor's ProtocolIntelligenceTab, now
// deleted) plus the Sponsor-only cross-site Portfolio view as a second
// internal tab (previously SponsorPage, now deleted), so nothing from either
// surface was lost.
//
// Internal tabs:
//   1. "Workspace" (default) — protocol scope + deliverable picker (all five
//      types) + DeliverablePanel + ActionCardRail + protocol-grounded Ask.
//   2. "Portfolio" — SponsorPortfolio, unchanged, read-only cross-site view.
//
// Gate order mirrors the pre-merge ProtocolIntelligenceTab, top to bottom:
//   1. Entitlement — canUseProtocolIntelligence(hasEntitlement), read from the
//      org's real 'deliverable_engine' capability via
//      useDeliverableEntitlement(). The rail icon itself is never gated: the
//      mode is discoverable, the capability is gated. Not allowed → calm gate
//      card.
//   2. Protocol scope — ProtocolContext supplies the list; the workspace
//      defaults to the app-wide activeProtocol and offers a local <select> so
//      a user can switch protocols without moving the global selection.
//   3. A five-chip deliverable picker (checklist default) mounts
//      <DeliverablePanel/> with that type's shared section config, plus the
//      warm-handoff rail and protocol-grounded Ask.
//
// Draft-only vocabulary throughout: PIQC drafts; the user reviews and
// decides. SENSITIVE: block text / notes live inside the panel, never here.
// =============================================================================

/** Purple accent — carried over from Sponsor's Protocol Intelligence branding
 *  (the surviving name/identity after the merge). */
const ACCENT_FG_LIGHT = '#3C3489';
const ACCENT_FG_DARK = '#A29CE6';

type InternalTab = 'workspace' | 'portfolio';

export default function CraWorkspaceShell() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [internalTab, setInternalTab] = useState<InternalTab>('workspace');

  const { hasEntitlement, loading: entitlementLoading } = useDeliverableEntitlement();
  const { protocols, isLoading: protocolsLoading, activeProtocol } = useProtocol();

  // Local protocol override — scoped to this workspace. null = follow the
  // app-wide activeProtocol. If the override id vanishes (protocol removed),
  // the fallback chain quietly returns to activeProtocol.
  const [overrideProtocolId, setOverrideProtocolId] = useState<string | null>(null);

  // Which deliverable the picker shows. Checklist first; protocol-independent,
  // so it is deliberately NOT reset on protocol switches.
  const [artifactType, setArtifactType] = useState<DeliverableArtifactType>(
    'monitoring_prep_checklist',
  );

  // Bumped on any panel mutation so the overview board re-syncs its counts even
  // when the active type never changes (generate-then-work-in-place).
  const [refreshTick, setRefreshTick] = useState(0);

  const accentFg = isLight ? ACCENT_FG_LIGHT : ACCENT_FG_DARK;
  const accentBg = isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)';

  // Full-screen spinner ONLY while there is nothing to show yet (the prior
  // ProtocolIntelligenceTab discipline: a background protocol reload must not
  // unmount the panel and destroy in-progress reviewer text).
  if (entitlementLoading || (protocolsLoading && protocols.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2
          size={20}
          className="animate-spin"
          style={{ color: accentFg }}
          aria-label="Loading Protocol Intelligence"
        />
      </div>
    );
  }

  const decision = canUseProtocolIntelligence(hasEntitlement);
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
                Protocol Intelligence isn’t enabled yet
              </h2>
              <p className="text-fg-sub text-sm mt-1 leading-relaxed">{decision.reason}</p>
              <p className="text-fg-muted text-xs mt-3 leading-relaxed">
                Once enabled, PIQC drafts evidence-linked monitoring focus, preparation
                checklists, risk overviews, and SIV packages from your parsed
                protocols — every draft traceable to its protocol source and
                requiring human review.
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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6">
      {/* Internal tab strip — Workspace (deliverable engine) | Portfolio
          (cross-site oversight, formerly SponsorPage's default tab). */}
      <div
        role="tablist"
        aria-label="Protocol Intelligence views"
        className={`inline-flex items-center gap-1 rounded-lg border p-1 mb-5 ${
          isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/10'
        }`}
      >
        {(
          [
            ['workspace', 'Workspace'],
            ['portfolio', 'Portfolio'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={internalTab === key}
            onClick={() => setInternalTab(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold ${
              internalTab === key
                ? isLight
                  ? 'bg-[#534AB7] text-white'
                  : 'bg-[#7F77DD] text-white'
                : 'text-fg-sub hover:text-fg-body'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {internalTab === 'portfolio' ? (
        <SponsorPortfolio />
      ) : (
        <div className="space-y-5 pb-8">
          {/* Workspace header */}
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: accentBg, color: accentFg }}
            >
              <Sparkles size={20} aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-fg-heading text-2xl font-semibold">Protocol Intelligence</h1>
              <p className="text-fg-sub text-sm mt-1 leading-relaxed">
                PIQC-drafted deliverables derived from the parsed protocol —
                monitoring focus, preparation checklists, risk overviews, and
                more. Every draft is evidence-linked and requires human review.
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
                Upload and parse a protocol first — PIQC drafts the workspace
                from the facts it extracts.
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

              {selectedProtocol ? (
                <>
                  {/* Status board = the deliverable selector: one card per
                      type, showing generated state + review progress;
                      clicking selects it. refreshKey is the active type, so
                      generate-then-switch re-syncs the counts. */}
                  <DeliverablesOverview
                    protocolId={selectedProtocol.id}
                    artifactTypes={CRA_ARTIFACT_ORDER}
                    activeType={artifactType}
                    onSelectType={setArtifactType}
                    accentFg={accentFg}
                    refreshKey={`${artifactType}:${refreshTick}`}
                  />
                  <DeliverablePanel
                    protocolId={selectedProtocol.id}
                    artifactType={artifactType}
                    sectionOrder={DELIVERABLE_CONFIGS[artifactType].sectionOrder}
                    sectionLabels={DELIVERABLE_CONFIGS[artifactType].sectionLabels}
                    exportEnabled={DELIVERABLE_CONFIGS[artifactType].exportEnabled}
                    onMutated={() => setRefreshTick((t) => t + 1)}
                  />
                  {/* Warm-handoff rail — self-hiding when the protocol has no
                      suggested cards. refreshKey re-syncs on chip switches so a
                      freshly generated deliverable surfaces its Travel-Bridge
                      card without a panel callback. */}
                  <ActionCardRail protocolId={selectedProtocol.id} refreshKey={artifactType} />
                  {/* Protocol-grounded Ask (the AskTab pattern: DashboardChat
                      WITH protocolId — never the org chat's unscoped
                      doc-picker mode). Inherits this workspace's entitlement
                      gate + protocol selection. Carried over from the
                      pre-merge Sponsor tab. */}
                  <SponsorAskPanel protocol={selectedProtocol} />
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
      )}
    </div>
  );
}
