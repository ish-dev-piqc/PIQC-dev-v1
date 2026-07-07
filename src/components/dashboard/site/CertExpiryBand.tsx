import { ShieldAlert } from 'lucide-react';
import type { SiteTeamMember } from '../../../lib/site/types';
import { isCertExpired, isCertExpiringSoon } from '../../../lib/site/dateUtils';

// ────────────────────────────────────────────────────────────────────────────
// Cert-expiry band — surfaces TeamTab's cert warning on the dashboard so
// coordinators don't have to open Team to know who's about to lapse.
// ────────────────────────────────────────────────────────────────────────────

export interface CertExpiryBandProps {
  items: SiteTeamMember[];
  isLight: boolean;
  onClick?: () => void;
}

export function CertExpiryBand({ items, isLight, onClick }: CertExpiryBandProps) {
  const expired = items.filter((m) => isCertExpired(m.certified_through));
  const expiring = items.filter(
    (m) => !isCertExpired(m.certified_through) && isCertExpiringSoon(m.certified_through),
  );
  const severe = expired.length > 0;

  const tone = severe
    ? isLight
      ? 'bg-[#fff1f1] border-[#f3c4c4] text-[#7a1a1a]'
      : 'bg-[#2a1414] border-[#a4423d]/40 text-[#f3c4c4]'
    : isLight
      ? 'bg-[#fff6e8] border-[#f0d49a] text-[#7a4a14]'
      : 'bg-[#2a2014] border-[#c89548]/40 text-[#f0d49a]';

  const Summary = () => {
    const parts: string[] = [];
    if (expired.length > 0) {
      parts.push(`${expired.length} expired`);
    }
    if (expiring.length > 0) {
      parts.push(`${expiring.length} expiring within 30 days`);
    }
    return <>Team certifications — {parts.join(', ')}.</>;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`mx-6 mt-3 mb-2 rounded-lg border px-4 py-3 text-left text-sm flex items-start gap-3 transition-colors ${tone} ${
        onClick ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'
      }`}
    >
      <ShieldAlert size={18} className="flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold mb-0.5">
          <Summary />
        </div>
        <div className="text-[12px] opacity-80 truncate">
          {items.slice(0, 4).map((m) => m.name).join(', ')}
          {items.length > 4 ? ` +${items.length - 4} more` : ''}
        </div>
      </div>
      {onClick && (
        <span className="text-[11px] uppercase tracking-wider font-semibold opacity-80 flex-shrink-0">
          Open team
        </span>
      )}
    </button>
  );
}
