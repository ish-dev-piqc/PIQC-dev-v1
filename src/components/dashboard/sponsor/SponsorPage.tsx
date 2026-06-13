import { useEffect, useState } from 'react';
import { Building2, ExternalLink, Loader2, Users } from 'lucide-react';
import { useTheme } from '../../../context/ThemeContext';
import { listMySponsorPortfolio } from '../../../lib/sponsor/sponsorApi';
import type { SponsorPortfolioEntry } from '../../../types/sponsor';
import SponsorComingSoonPage from '../SponsorComingSoonPage';

// =============================================================================
// SponsorPage — read-only portfolio view for Sponsor Mode.
//
// Loads the user's sponsor portfolio via list_my_sponsor_portfolio(). If
// the RPC returns zero rows (the user isn't yet a sponsor in any
// relationship), the page falls through to the existing
// SponsorComingSoonPage so prospects still see the marketing surface +
// notify-me form.
//
// Cards are read-only in v1. "View details" is a stub — the drill-in
// drawer lands in v2.
// =============================================================================

export default function SponsorPage() {
  const { theme } = useTheme();
  const isLight = theme === 'light';

  const [entries, setEntries] = useState<SponsorPortfolioEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await listMySponsorPortfolio();
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setEntries([]);
        return;
      }
      setEntries(res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Loading — full-page spinner while we decide which surface to render.
  if (entries === null) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Loader2
          size={20}
          className={isLight ? 'text-[#534AB7] animate-spin' : 'text-[#7F77DD] animate-spin'}
        />
      </div>
    );
  }

  // Empty — fall through to the existing coming-soon page so users who
  // aren't yet sponsoring anything see the marketing surface unchanged.
  if (entries.length === 0) {
    return <SponsorComingSoonPage />;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{
            backgroundColor: isLight ? '#EEEDFE' : 'rgba(83, 74, 183, 0.2)',
            color: isLight ? '#3C3489' : '#A29CE6',
          }}
        >
          <Building2 size={20} />
        </div>
        <div>
          <h1 className="text-fg-heading text-2xl font-semibold">
            Sponsor portfolio
          </h1>
          <p className="text-fg-sub text-sm mt-1">
            Read-only oversight of the {entries.length} protocol
            {entries.length === 1 ? '' : 's'} you sponsor across partner sites.
          </p>
        </div>
      </div>

      {error && (
        <div
          className={`px-3 py-2 rounded-md text-xs ${
            isLight ? 'bg-rose-50 text-rose-700' : 'bg-rose-500/[0.06] text-rose-300'
          }`}
        >
          {error}
        </div>
      )}

      {/* Cards grid — 1 col mobile, 2 col lg, 3 col xl */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
        {entries.map((entry) => (
          <PortfolioCard key={entry.protocolId} entry={entry} isLight={isLight} />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PortfolioCard — single protocol summary tile.
// ---------------------------------------------------------------------------

interface PortfolioCardProps {
  entry: SponsorPortfolioEntry;
  isLight: boolean;
}

function PortfolioCard({ entry, isLight }: PortfolioCardProps) {
  const border = isLight ? 'border-[#E2E8F0]' : 'border-white/10';
  const bg = isLight ? 'bg-white' : 'bg-[#0F172A]';
  const subColor = isLight ? 'text-[#334155]/70' : 'text-[#CBD5E1]/55';
  const labelColor = isLight ? 'text-[#334155]/55' : 'text-[#CBD5E1]/45';

  const lastVisitLabel = entry.lastVisitAt
    ? new Date(entry.lastVisitAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'No activity yet';

  return (
    <div className={`rounded-md border ${border} ${bg} p-4 flex flex-col gap-3`}>
      {/* Title block */}
      <div>
        <p
          className="text-[10px] uppercase tracking-wider font-semibold mb-1"
          style={{ color: isLight ? '#3C3489' : '#A29CE6' }}
        >
          {entry.protocolCode ?? 'Unassigned code'}
        </p>
        <p className="text-fg-heading text-sm font-semibold leading-snug line-clamp-2">
          {entry.protocolTitle}
        </p>
      </div>

      {/* Metadata row — site org */}
      <div className={`text-[11px] ${subColor} flex items-center gap-1.5`}>
        <Building2 size={11} className={labelColor} />
        <span className="truncate">{entry.siteOrgName}</span>
      </div>

      {/* Stats — participant count + last visit */}
      <div className={`grid grid-cols-2 gap-3 pt-3 border-t ${border}`}>
        <div>
          <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
            Participants
          </p>
          <p className="text-fg-heading text-base font-semibold flex items-center gap-1 mt-0.5">
            <Users size={13} className={labelColor} />
            {entry.participantCount}
          </p>
        </div>
        <div>
          <p className={`${labelColor} text-[10px] uppercase tracking-wider font-semibold`}>
            Last visit
          </p>
          <p
            className={`text-sm font-medium mt-0.5 ${
              entry.lastVisitAt ? 'text-fg-heading' : subColor
            }`}
          >
            {lastVisitLabel}
          </p>
        </div>
      </div>

      {/* Action footer — stubbed in v1 */}
      <div className={`pt-3 border-t ${border} -mb-1`}>
        <button
          type="button"
          disabled
          title="Detailed protocol view ships in Sponsor v2."
          className={`w-full inline-flex items-center justify-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md border ${border} ${labelColor} cursor-not-allowed`}
        >
          <ExternalLink size={11} />
          View details (coming soon)
        </button>
      </div>
    </div>
  );
}
