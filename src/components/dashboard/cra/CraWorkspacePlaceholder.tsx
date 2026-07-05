import { Loader2, Lock, SearchCheck } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { useSubscription } from '../../../hooks/useSubscription';
import { canUseCraMode } from '../../../lib/entitlements';

// =============================================================================
// CraWorkspacePlaceholder — the content-free surface behind the CRA rail icon
// (mode plumbing PR-A). PR-B replaces this file's internals with the real
// CraWorkspaceShell — protocol picker, Monitoring Focus deliverable,
// checklist, ActionCard rail, amendment banner — consuming existing packets
// only. Everything outside src/components/dashboard/cra/ stays untouched in
// PR-B; that is the point of the split.
//
// Gate order mirrors ProtocolIntelligenceTab: entitlement first
// (canUseCraMode — enterprise), then the surface. The rail icon itself is
// never gated (sponsor precedent): the mode is discoverable, the capability
// is gated.
//
// Draft-only vocabulary: PIQC drafts; monitors review and decide.
// =============================================================================

export default function CraWorkspacePlaceholder() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const { subscription, loading } = useSubscription();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[30vh]">
        <Loader2
          size={20}
          className={isLight ? 'text-[#8A4B0F] animate-spin' : 'text-[#E8B27D] animate-spin'}
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
              style={{
                backgroundColor: isLight ? '#FDF3E7' : 'rgba(138, 75, 15, 0.2)',
                color: isLight ? '#8A4B0F' : '#E8B27D',
              }}
            >
              <Lock size={16} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-fg-heading text-sm font-semibold">
                CRA Mode is an enterprise capability
              </h2>
              <p className="text-fg-sub text-sm mt-1 leading-relaxed">{decision.reason}</p>
              <p className="text-fg-muted text-xs mt-3 leading-relaxed">
                With the enterprise tier, monitors get a dedicated workspace
                over the same protocol intelligence — PIQC-drafted monitoring
                focus, checklists, and next-action context, every item
                traceable to its protocol source.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div
        data-testid="cra-workspace-placeholder"
        className={`rounded-xl border px-6 py-10 text-center ${
          isLight ? 'bg-white border-[#E2E8F0]' : 'bg-[#0F172A] border-white/5'
        }`}
      >
        <SearchCheck size={20} className="text-fg-muted mx-auto mb-3" aria-hidden />
        <h1 className="text-fg-heading text-base font-semibold">
          CRA Monitoring Workspace
        </h1>
        <p className="text-fg-sub text-sm mt-2 leading-relaxed max-w-lg mx-auto">
          The mode is live; the workspace lands in the next release. It will
          bring together, for one selected protocol: the PIQC-drafted
          Monitoring Focus (where limited on-site attention should go first),
          the monitoring preparation checklist, travel-planning context, and
          the what-changed view after amendments — all draft, all
          evidence-linked, all requiring a monitor's review.
        </p>
        <p className="text-fg-muted text-xs mt-4">
          Until then, these deliverables are available today in the Sponsor
          surface under Protocol Intelligence.
        </p>
      </div>
    </div>
  );
}
