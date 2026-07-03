import { useState } from 'react';
import { FolderOpen, Loader2, Lock, Sparkles } from 'lucide-react';
import { useTheme } from '../../../../context/ThemeContext';
import { useProtocol } from '../../../../context/ProtocolContext';
import { useSubscription } from '../../../../hooks/useSubscription';
import { canUseSponsorMode } from '../../../../lib/entitlements';
import MonitoringChecklistPanel from './MonitoringChecklistPanel';

// =============================================================================
// ProtocolIntelligenceTab — the Sponsor page's "Protocol Intelligence" sub-tab
// (Protocol Deliverable Engine, Phase 1).
//
// Order of gates, top to bottom:
//   1. Entitlement — canUseSponsorMode(subscription) (its first consumer).
//      Subscription comes from useSubscription(), the same hook Dashboard
//      uses; there is no billing context to share, so the tab owns its own
//      fetch. Not allowed → calm gate card with the decision's reason.
//   2. Protocol scope — ProtocolContext supplies the workspace's protocol
//      list; the tab defaults to the app-wide activeProtocol and offers a
//      local <select> so a reviewer can switch protocols without leaving
//      the tab (the override never writes back to the global selection).
//   3. A selected protocol mounts <MonitoringChecklistPanel/>; no selection
//      renders an empty-state prompt instead.
//
// Draft-only vocabulary throughout: PIQC drafts; humans review.
// =============================================================================

export default function ProtocolIntelligenceTab() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const { subscription, loading: subscriptionLoading } = useSubscription();
  const { protocols, isLoading: protocolsLoading, activeProtocol } = useProtocol();

  // Local protocol override — scoped to this tab. null = follow the app-wide
  // activeProtocol. If the override id vanishes from the list (protocol
  // removed), the fallback chain quietly returns to activeProtocol.
  const [overrideProtocolId, setOverrideProtocolId] = useState<string | null>(null);

  // Full-screen spinner ONLY while there is nothing to show yet. Protocol
  // realtime events re-run ProtocolContext's load() (isLoading flips true)
  // — swapping to a spinner then would unmount the panel and any open
  // drawer, destroying in-progress reviewer text. With data on screen,
  // background reloads render through.
  if (subscriptionLoading || (protocolsLoading && protocols.length === 0)) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2
          size={20}
          className={isLight ? 'text-[#534AB7] animate-spin' : 'text-[#7F77DD] animate-spin'}
          aria-label="Loading Protocol Intelligence"
        />
      </div>
    );
  }

  const decision = canUseSponsorMode(subscription);
  if (!decision.allowed) {
    return (
      <div
        data-testid="protocol-intelligence-gate"
        className={`max-w-xl rounded-xl border p-6 ${
          isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{
              backgroundColor: isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)',
              color: isLight ? '#3C3489' : '#A29CE6',
            }}
          >
            <Lock size={16} aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 className="text-fg-heading text-sm font-semibold">
              Protocol Intelligence is an enterprise capability
            </h2>
            <p className="text-fg-sub text-sm mt-1 leading-relaxed">{decision.reason}</p>
            <p className="text-fg-muted text-xs mt-3 leading-relaxed">
              With the enterprise tier, PIQC drafts evidence-linked monitoring
              preparation checklists from your parsed protocols — every draft
              traceable to its protocol source and requiring human review.
            </p>
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
    <div className="space-y-5">
      {/* Tab header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)',
            color: isLight ? '#3C3489' : '#A29CE6',
          }}
        >
          <Sparkles size={20} aria-hidden />
        </div>
        <div className="min-w-0">
          <h1 className="text-fg-heading text-2xl font-semibold">Protocol Intelligence</h1>
          <p className="text-fg-sub text-sm mt-1 leading-relaxed">
            PIQC-drafted deliverables derived from the parsed protocol. Every
            draft is evidence-linked and requires human review.
          </p>
        </div>
      </div>

      {/* Protocol scope selector */}
      {protocols.length === 0 ? (
        <div
          data-testid="protocol-intelligence-no-protocols"
          className={`rounded-xl border px-4 py-8 text-center ${
            isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
          }`}
        >
          <FolderOpen size={18} className="text-fg-muted mx-auto mb-2" aria-hidden />
          <p className="text-fg-body text-sm">No protocols in this workspace yet.</p>
          <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
            Upload and parse a protocol first — PIQC drafts deliverables from
            the facts it extracts.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <label
              htmlFor="protocol-intelligence-protocol"
              className="text-fg-label text-[10px] uppercase tracking-wider font-semibold flex-shrink-0"
            >
              Protocol
            </label>
            <select
              id="protocol-intelligence-protocol"
              data-testid="protocol-intelligence-protocol-select"
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
            <MonitoringChecklistPanel protocolId={selectedProtocol.id} />
          ) : (
            <div
              data-testid="protocol-intelligence-no-selection"
              className={`rounded-xl border px-4 py-8 text-center ${
                isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
              }`}
            >
              <p className="text-fg-body text-sm">Select a protocol to begin.</p>
              <p className="text-fg-sub text-[11px] mt-1 leading-relaxed">
                PIQC drafts the monitoring preparation checklist for the
                protocol you choose above.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
